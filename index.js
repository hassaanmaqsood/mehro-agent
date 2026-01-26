// task -> (input, state) --> LLM --> (output, state) -> executor;

require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

// Rate limiting trackers
const perMinuteModelRequestsLimit = 1;
let modelRequests = 0;
const perMinuteInputTokensLimit = 50e3;
let inputTokens = 0;
const perMinuteOutputTokensLimit = 50e3;
let outputTokens = 0;

// Reset limits every minute
setInterval(() => {
    modelRequests = 0;
    inputTokens = 0;
    outputTokens = 0;
}, 60000);

// Sleep/delay utility
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if we've hit any rate limits
function checkRateLimits(estimatedInputTokens = 0) {
    if (modelRequests >= perMinuteModelRequestsLimit) {
        return { limited: true, reason: "request count" };
    }
    if (inputTokens + estimatedInputTokens > perMinuteInputTokensLimit) {
        return { limited: true, reason: "input tokens" };
    }
    if (outputTokens >= perMinuteOutputTokensLimit) {
        return { limited: true, reason: "output tokens" };
    }
    return { limited: false };
}

// Task queue
const tasks = [];

// Initialize tasks from user prompts
[
    "What is the capital of Pakistan",
    "Write hello world program in javascript",
].forEach(userPrompt => {
    const id = "t_" + Date.now().toString(36) + Math.random().toString(36).substring(2);
    tasks.push({
        id,
        userPrompt,
        status: "pending",
        maxAttempts: 5,
        attempts: 0,
        response: "",
        error: null,
    });
});

// Available functions for the agent
const functions = {
    log: {
        function: async ({ message }) => {
            console.log(`[LOG] ${message}`);
            return { success: true, output: message };
        },
        name: "log",
        description: "Log a message to console",
        parameters: {
            message: {
                type: "string",
                description: "message to log"
            }
        },
        required: ["message"],
    }
};

// agent loop
// testing the concept with only "pending" tasks later would retries
// each loop must respect the limits
async function runAgentLoop() {
    while (tasks.filter(task => task.status == "pending").length > 0) {
        const pendingIndex = tasks.findIndex(task => task.status == "pending");
        if (pendingIndex === -1) continue;

        const task = tasks[pendingIndex];

        // Estimate tokens for rate limit check
        const prompt = buildModelPrompt(task);
        const estimatedInputTokens = Math.ceil(prompt.length / 4);

        // Check rate limits before processing
        const limitCheck = checkRateLimits(estimatedInputTokens);
        if (limitCheck.limited) {
            console.log(`[RATE LIMIT] Hit ${limitCheck.reason} limit. Waiting 60 seconds...`);
            await sleep(60000);
            continue; // Recheck after waiting
        }

        task.status = "ongoing";

        try {
            await new Promise((resolve, reject) => {
                model(prompt, (rawResponse) => {
                    const response = parseModelOutput(rawResponse);
                    if (response) {
                        try {
                            executeDAG(response);
                            task.response = rawResponse;
                            task.status = "success";
                        } catch (execError) {
                            console.error(`[EXEC ERROR] Task ${task.id}:`, execError.message);
                            task.error = execError.message;
                            task.attempts++;
                            task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
                        }
                    } else {
                        task.attempts++;
                        task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
                    }
                    resolve();
                }, (error) => {
                    reject(error);
                });
            });
        } catch (error) {
            task.error = error.message;
            task.attempts++;
            task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
            console.error(`[ERROR] Task ${task.id} failed:`, error.message);
        }

        // Small delay between tasks to avoid hammering the API
        await sleep(1000);
    }

    console.log("\n[DONE] All tasks processed:");
    tasks.forEach(task => {
        console.log(`  ${task.id}: ${task.status} - "${task.userPrompt}"`);
    });
}

// Start the agent loop
runAgentLoop().catch(err => console.error("[FATAL]", err));

// Templating function Ï†(x, p)
function buildModelPrompt(task) {
    const functionSchemas = Object.values(functions).map(fn => ({
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
        required: fn.required,
    }));

    const prompt = `You are an AI agent that generates execution plans as DAGs (Directed Acyclic Graphs).

User Request: ${task.userPrompt}

Available Functions:
${JSON.stringify(functionSchemas, null, 2)}

IMPORTANT: You MUST respond with ONLY valid JSON. No markdown, no explanations, no extra text.

If you cannot generate a proper DAG for the task, use the log function to output your response as a fallback.

Output JSON structure:
{
    "thought_process": "your reasoning here",
    "dag": [
        {
            "id": "1",
            "function": "function_name",
            "parameters": { "param": "value" },
            "dependencies": []
        }
    ]
}`;

    return prompt;
}

// Model wrapper function
async function model(prompt, onComplete, onError) {
    // Estimate input tokens (rough estimate: ~4 chars per token)
    const estimatedInputTokens = Math.ceil(prompt.length / 4);

    try {
        // Initialize GoogleGenAI client
        const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY
        });

        // Update limits before request
        modelRequests++;
        inputTokens += estimatedInputTokens;

        // Make API request with strict JSON mode
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseModalities: "TEXT",
                responseMimeType: "application/json",
            }
        });

        // Check for prompt feedback/blocking
        if (result.promptFeedback && result.promptFeedback.blockReasonMessage) {
            const blockError = new Error(result.promptFeedback.blockReasonMessage);
            blockError.name = "PromptBlocked";
            throw blockError;
        }

        // Extract text from response
        const responseText = result.text || "";

        // Use actual token counts from response metadata
        const actualInputTokens = result.usageMetadata?.promptTokenCount || estimatedInputTokens;
        const actualOutputTokens = result.usageMetadata?.candidatesTokenCount || 0;
        const thoughtTokens = result.usageMetadata?.thoughtsTokenCount || 0;

        // Update actual token usage (subtract estimate, add actual)
        inputTokens = inputTokens - estimatedInputTokens + actualInputTokens;
        outputTokens += actualOutputTokens;

        // Log usage
        console.log(`[USAGE] Requests: ${modelRequests}/${perMinuteModelRequestsLimit}, Input: ${inputTokens}/${perMinuteInputTokensLimit}, Output: ${outputTokens}/${perMinuteOutputTokensLimit}, Thoughts: ${thoughtTokens}`);

        onComplete(responseText);

    } catch (error) {
        // Standardize error logging
        const errorMsg = {
            type: error.name || "UnknownError",
            message: error.message || "Unknown error occurred",
            timestamp: new Date().toISOString(),
        };
        console.error("[MODEL ERROR]", JSON.stringify(errorMsg));
        onError(error);
    }
}

/**
 * Parses the raw string from the LLM into a usable DAG object.
 * Handles Markdown fences and basic JSON errors.
 */
function parseModelOutput(rawString) {
    /*
    Expected format:
    {
        thought_process: "reasoning string",
        dag: [
            {
                id: "1",
                function: "log",
                parameters: { message: "hello world" },
                dependencies: []
            }
        ]
    }
    */

    try {
        // Clean the string (remove ```json ... ``` wrappers if present)
        let cleanStr = rawString.trim();
        if (cleanStr.startsWith("```")) {
            cleanStr = cleanStr.replace(/^```(json)?|```$/g, "").trim();
        }

        // Parse JSON
        const parsed = JSON.parse(cleanStr);

        // Basic validation
        if (!parsed.dag || !Array.isArray(parsed.dag)) {
            throw new Error("Invalid format: Missing 'dag' array.");
        }

        return parsed;
    } catch (e) {
        console.error("Parsing Failed:", e.message);
        return null; // Signals the main loop to increment fail count
    }
}

/**
 * Validates and executes the DAG from LLM output
 */
function executeDAG(llmOutput) {
    const dag = llmOutput.dag;

    // Validate each step
    dag.forEach(step => {
        // Check if function exists
        if (!functions[step.function]) {
            throw new Error(`${step.function} function not available`);
        }

        // Check if parameters key exists
        if (!step.parameters) {
            throw new Error(`Parameters are not given for ${step.function}`);
        }

        // Validate each parameter
        Object.keys(step.parameters).forEach(param => {
            // Check if parameter is defined in function schema
            if (!functions[step.function].parameters[param]) {
                throw new Error(`Parameter ${param} is not available in ${step.function}`);
            }

            // Check parameter type
            const expectedType = functions[step.function].parameters[param].type;
            const actualType = typeof step.parameters[param];
            if (actualType !== expectedType) {
                throw new Error(
                    `Parameter ${param} has incorrect data type. Expected ${expectedType}, got ${actualType}`
                );
            }
        });

        // TODO: Check for cycles in DAG
    });

    // Execute the DAG
    dag.forEach(step => {
        const data = {};
        Object.keys(step.parameters).forEach(param => {
            data[param] = step.parameters[param];
        });

        try {
            functions[step.function].function(data);
        } catch (error) {
            throw error;
        }
    });
}

// Test the model function
function testModelFunction() {
    model(
        "briefly define agent in terms of computer science",
        (response) => console.log(JSON.stringify(response)),
        (err) => console.error(err)
    );
}