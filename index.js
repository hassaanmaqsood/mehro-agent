// task -> (input, state) --> LLM --> (output, state) -> executor;
/**
 * future:
 * - model registery
 * - auto model change based on the token usage
 * - auto prompt compress/minimization based on the model context window
 * - add skills
 * - add tui
 * - add webhooks, and api
 */
require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");

// Rate limiting trackers
// System limits are set to <10% of API limits to stay safe
let perMinuteModelRequestsLimit = 1; // Will be updated from API
let modelRequests = 0;
let lastMinuteReset = Date.now();

let perMinuteInputTokensLimit = 50e3; // Will be updated from API
let inputTokens = 0;
let lastInputTokenReset = Date.now();

let perMinuteOutputTokensLimit = 50e3; // Will be updated from API
let outputTokens = 0;
let lastOutputTokenReset = Date.now();

let perDayRequestsLimit = 10; // Will be updated from API
let dailyRequests = 0;
let lastDayReset = Date.now();

// Track discovered API limits
const apiLimits = {
    perMinuteRequests: null,
    perDayRequests: null,
    perMinuteInputTokens: null,
    perMinuteOutputTokens: null,
};

/**
 * Update system limits based on API-imposed limits
 * System limits should be <10% of API limits for safety
 */
function updateSystemLimits(apiLimit, limitType) {
    const safetyMargin = 0.09; // Use 9% of API limit to stay well under 10%
    const systemLimit = Math.floor(apiLimit * safetyMargin);

    switch (limitType) {
        case 'per-minute-requests':
            if (!apiLimits.perMinuteRequests || apiLimit < apiLimits.perMinuteRequests) {
                apiLimits.perMinuteRequests = apiLimit;
                perMinuteModelRequestsLimit = Math.max(1, systemLimit);
                console.log(`[LIMITS] Updated per-minute requests: API=${apiLimit}, System=${perMinuteModelRequestsLimit}`);
            }
            break;
        case 'per-day-requests':
            if (!apiLimits.perDayRequests || apiLimit < apiLimits.perDayRequests) {
                apiLimits.perDayRequests = apiLimit;
                perDayRequestsLimit = Math.max(1, systemLimit);
                console.log(`[LIMITS] Updated per-day requests: API=${apiLimit}, System=${perDayRequestsLimit}`);
            }
            break;
        case 'per-minute-input-tokens':
            if (!apiLimits.perMinuteInputTokens || apiLimit < apiLimits.perMinuteInputTokens) {
                apiLimits.perMinuteInputTokens = apiLimit;
                perMinuteInputTokensLimit = Math.max(1000, systemLimit);
                console.log(`[LIMITS] Updated per-minute input tokens: API=${apiLimit}, System=${perMinuteInputTokensLimit}`);
            }
            break;
        case 'per-minute-output-tokens':
            if (!apiLimits.perMinuteOutputTokens || apiLimit < apiLimits.perMinuteOutputTokens) {
                apiLimits.perMinuteOutputTokens = apiLimit;
                perMinuteOutputTokensLimit = Math.max(1000, systemLimit);
                console.log(`[LIMITS] Updated per-minute output tokens: API=${apiLimit}, System=${perMinuteOutputTokensLimit}`);
            }
            break;
    }
}

// Reset limits based on time elapsed
function resetLimitsIfNeeded() {
    const now = Date.now();

    // Reset minute-based limits (60 seconds)
    if (now - lastMinuteReset >= 60000) {
        modelRequests = 0;
        lastMinuteReset = now;
    }

    if (now - lastInputTokenReset >= 60000) {
        inputTokens = 0;
        lastInputTokenReset = now;
    }

    if (now - lastOutputTokenReset >= 60000) {
        outputTokens = 0;
        lastOutputTokenReset = now;
    }

    // Reset daily limits (24 hours)
    if (now - lastDayReset >= 86400000) {
        dailyRequests = 0;
        lastDayReset = now;
    }
}

// Sleep/delay utility
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if we've hit any rate limits
function checkRateLimits(estimatedInputTokens = 0) {
    resetLimitsIfNeeded();

    if (dailyRequests >= perDayRequestsLimit) {
        return { limited: true, reason: "daily request count" };
    }
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

// Zod schemas for runtime parameter validation
const functionSchemas = {
    log: z.object({
        message: z.string()
    }),
    calculate: z.object({
        expression: z.string()
    }),
    read_file: z.object({
        filepath: z.string()
    }),
    write_file: z.object({
        filepath: z.string(),
        content: z.string()
    }),
    http_request: z.object({
        url: z.string(),
        method: z.string().optional()
    }),
    string_transform: z.object({
        text: z.string(),
        operation: z.enum(["uppercase", "lowercase", "reverse", "length"])
    }),
    delay: z.object({
        milliseconds: z.number()
    })
};

// Dynamically generate strict polymorphic schema from functions object
function generateSchema(functions) {
    // Create a specific schema definition for EACH tool
    const toolVariants = Object.values(functions).map(fn => ({
        type: "object",
        properties: {
            id: {
                type: "string",
                description: "Unique identifier for this step"
            },
            function: {
                type: "string",
                enum: [fn.name] // STRICTLY limits this branch to this specific function name
            },
            parameters: {
                type: "object",
                properties: fn.parameters, // Use the specific params for this tool
                required: fn.required || [],
                additionalProperties: false // STRICTLY forbids extra params
            },
            dependencies: {
                type: "array",
                items: { type: "string" }
            }
        },
        required: ["id", "function", "parameters", "dependencies"]
    }));

    return {
        type: "object",
        properties: {
            thought_process: { type: "string" },
            dag: {
                type: "array",
                items: {
                    // The magic happens here: The item must match one of the tool variants
                    anyOf: toolVariants
                }
            }
        },
        required: ["thought_process", "dag"]
    };
}

// Task queue
const tasks = [];

// Initialize tasks from user prompts
[
    "What is the capital of Pakistan",
    "Calculate 15 multiplied by 8",
    "Convert 'Hello World' to uppercase",
    "Write a hello world program to a file called hello.js",
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
        function: async ({ message }, context) => {
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
    },

    calculate: {
        function: async ({ expression }, context) => {
            try {
                // Simple eval for basic math (in production, use a safe math parser)
                const result = eval(expression);
                console.log(`[CALCULATE] ${expression} = ${result}`);
                return { success: true, output: result };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },
        name: "calculate",
        description: "Evaluate a mathematical expression",
        parameters: {
            expression: {
                type: "string",
                description: "Mathematical expression to evaluate (e.g., '2 + 2', '10 * 5')"
            }
        },
        required: ["expression"],
    },

    read_file: {
        function: async ({ filepath }, context) => {
            const fs = require('fs').promises;
            try {
                const content = await fs.readFile(filepath, 'utf-8');
                console.log(`[READ_FILE] Read ${filepath}`);
                return { success: true, output: content };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },
        name: "read_file",
        description: "Read contents of a file",
        parameters: {
            filepath: {
                type: "string",
                description: "Path to the file to read"
            }
        },
        required: ["filepath"],
    },

    write_file: {
        function: async ({ filepath, content }, context) => {
            const fs = require('fs').promises;
            try {
                await fs.writeFile(filepath, content, 'utf-8');
                console.log(`[WRITE_FILE] Wrote to ${filepath}`);
                return { success: true, output: `File written: ${filepath}` };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },
        name: "write_file",
        description: "Write content to a file",
        parameters: {
            filepath: {
                type: "string",
                description: "Path to the file to write"
            },
            content: {
                type: "string",
                description: "Content to write to the file"
            }
        },
        required: ["filepath", "content"],
    },

    http_request: {
        function: async ({ url, method = "GET" }, context) => {
            const https = require('https');
            const http = require('http');

            return new Promise((resolve, reject) => {
                const client = url.startsWith('https') ? https : http;

                client.get(url, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        console.log(`[HTTP_REQUEST] ${method} ${url} - Status: ${res.statusCode}`);
                        resolve({
                            success: true,
                            output: data,
                            statusCode: res.statusCode
                        });
                    });
                }).on('error', (error) => {
                    resolve({ success: false, error: error.message });
                });
            });
        },
        name: "http_request",
        description: "Make an HTTP request to a URL",
        parameters: {
            url: {
                type: "string",
                description: "URL to request"
            },
            method: {
                type: "string",
                description: "HTTP method (GET, POST, etc.)"
            }
        },
        required: ["url"],
    },

    string_transform: {
        function: async ({ text, operation }, context) => {
            let result;
            switch (operation) {
                case "uppercase":
                    result = text.toUpperCase();
                    break;
                case "lowercase":
                    result = text.toLowerCase();
                    break;
                case "reverse":
                    result = text.split('').reverse().join('');
                    break;
                case "length":
                    result = text.length;
                    break;
                default:
                    return { success: false, error: "Unknown operation" };
            }
            console.log(`[STRING_TRANSFORM] ${operation} applied`);
            return { success: true, output: result };
        },
        name: "string_transform",
        description: "Transform a string using various operations",
        parameters: {
            text: {
                type: "string",
                description: "Text to transform"
            },
            operation: {
                type: "string",
                description: "Operation to perform: uppercase, lowercase, reverse, length"
            }
        },
        required: ["text", "operation"],
    },

    delay: {
        function: async ({ milliseconds }, context) => {
            await new Promise(resolve => setTimeout(resolve, milliseconds));
            console.log(`[DELAY] Waited ${milliseconds}ms`);
            return { success: true, output: `Delayed ${milliseconds}ms` };
        },
        name: "delay",
        description: "Wait for specified milliseconds",
        parameters: {
            milliseconds: {
                type: "number",
                description: "Number of milliseconds to wait"
            }
        },
        required: ["milliseconds"],
    },
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
            const waitTime = limitCheck.reason.includes('daily') ? 86400000 : 60000;
            const waitMsg = limitCheck.reason.includes('daily') ? '24 hours' : '60 seconds';
            console.log(`[RATE LIMIT] Hit ${limitCheck.reason} limit. Waiting ${waitMsg}...`);
            await sleep(waitTime);
            continue; // Recheck after waiting
        }

        task.status = "ongoing";

        try {
            await new Promise((resolve, reject) => {
                model(prompt, async (rawResponse) => {
                    const response = parseModelOutput(rawResponse);
                    if (response) {
                        try {
                            await executeDAG(response);
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
            // Check if this is an API rate limit error
            if (error.rateLimitInfo) {
                const info = error.rateLimitInfo;

                console.log(`[API RATE LIMIT] ${info.limitType} limit exceeded`);
                console.log(`[API RATE LIMIT] Quota: ${info.quotaMetric}`);
                console.log(`[API RATE LIMIT] API Limit: ${info.quotaLimit}, waiting ${info.waitTime / 1000}s...`);

                // Update system limits based on discovered API limits
                if (info.quotaLimit) {
                    if (info.limitType === 'per-minute') {
                        // Determine which per-minute limit was hit
                        if (info.quotaMetric.includes('requests') || info.quotaId.includes('Requests')) {
                            updateSystemLimits(info.quotaLimit, 'per-minute-requests');
                        } else if (info.quotaMetric.includes('input') || info.quotaMetric.includes('prompt')) {
                            updateSystemLimits(info.quotaLimit, 'per-minute-input-tokens');
                        } else if (info.quotaMetric.includes('output') || info.quotaMetric.includes('candidates')) {
                            updateSystemLimits(info.quotaLimit, 'per-minute-output-tokens');
                        }
                    } else if (info.limitType === 'per-day') {
                        updateSystemLimits(info.quotaLimit, 'per-day-requests');
                    }
                }

                // Reset task to pending for retry
                task.status = "pending";
                task.attempts++; // Increment but allow retry

                // Wait for the appropriate time based on limit type
                await sleep(info.waitTime);
                continue;
            }

            // Handle other errors
            task.error = error.message;
            task.attempts++;
            task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
            console.error(`[ERROR] Task ${task.id} failed (attempt ${task.attempts}/${task.maxAttempts}):`, error.message);
        }

        // Small delay between tasks to avoid hammering the API
        await sleep(1000);
    }

    console.log("\n[DONE] All tasks processed:");
    tasks.forEach(task => {
        console.log(`  ${task.id}: ${task.status} - "${task.userPrompt}"`);
        if (task.error) {
            console.log(`    Error: ${task.error}`);
        }
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

IMPORTANT GUIDELINES:
1. You MUST respond with ONLY valid JSON. No markdown, no explanations, no extra text.
2. For general knowledge questions or queries that don't require function calls:
   - Use the 'log' function to provide the answer directly
   - Put your knowledge/answer in the message parameter
   - Example: For "What is the capital of Pakistan?", use log with message "The capital of Pakistan is Islamabad."
3. For tasks requiring computation or file operations, create appropriate DAG steps
4. Steps can reference outputs from previous steps using {{stepId.output}}
5. Set dependencies array to show which steps must complete before this step runs

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
        dailyRequests++;
        inputTokens += estimatedInputTokens;

        // Generate the strict polymorphic schema
        // distinct per function, preventing "parameter leakage"
        const responseSchema = generateSchema(functions);

        // Make API request with strict JSON mode and schema
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
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
        console.log(`[USAGE] Daily: ${dailyRequests}/${perDayRequestsLimit}, Requests: ${modelRequests}/${perMinuteModelRequestsLimit}, Input: ${inputTokens}/${perMinuteInputTokensLimit}, Output: ${outputTokens}/${perMinuteOutputTokensLimit}, Thoughts: ${thoughtTokens}`);

        onComplete(responseText);

    } catch (error) {
        // Parse API error for rate limiting info
        let rateLimitInfo = null;
        if (error.message && error.message.includes('RESOURCE_EXHAUSTED')) {
            rateLimitInfo = parseRateLimitError(error.message);
        }

        // Standardize error logging
        const errorMsg = {
            type: error.name || "UnknownError",
            message: error.message || "Unknown error occurred",
            timestamp: new Date().toISOString(),
            rateLimitInfo: rateLimitInfo
        };
        console.error("[MODEL ERROR]", JSON.stringify(errorMsg, null, 2));

        // Attach rate limit info to error for handling in main loop
        error.rateLimitInfo = rateLimitInfo;
        onError(error);
    }
}

/**
 * Parse rate limit error from API to extract quota limits and type
 */
function parseRateLimitError(errorMessage) {
    try {
        // Try to parse JSON from error message
        const jsonMatch = errorMessage.match(/\{.*\}/s);
        if (jsonMatch) {
            const errorData = JSON.parse(jsonMatch[0]);

            // Extract quota info from QuotaFailure
            const quotaInfo = errorData.error?.details?.find(
                d => d['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure'
            );

            if (quotaInfo && quotaInfo.violations && quotaInfo.violations.length > 0) {
                const violation = quotaInfo.violations[0];
                const quotaMetric = violation.quotaMetric || '';
                const quotaLimit = parseInt(violation.quotaValue) || null;
                const quotaId = violation.quotaId || '';

                // Determine if it's per-minute or per-day limit
                let limitType = 'unknown';
                let waitTime = 60000; // Default 60 seconds

                if (quotaId.includes('PerMinute') || quotaMetric.includes('per_minute')) {
                    limitType = 'per-minute';
                    waitTime = 60000; // Wait 1 minute
                } else if (quotaId.includes('PerDay') || quotaId.includes('Daily') || quotaMetric.includes('per_day')) {
                    limitType = 'per-day';
                    waitTime = 86400000; // Wait 24 hours
                }

                return {
                    limitType,
                    quotaMetric,
                    quotaLimit,
                    quotaId,
                    waitTime,
                    message: errorData.error?.message
                };
            }
        }
    } catch (e) {
        // If parsing fails, return null
    }
    return null;
}

/**
 * Parses the raw string from the LLM into a usable DAG object.
 * Schema validation is already done by the API, so we just parse JSON.
 */
function parseModelOutput(rawString) {
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
 * Uses context to share data between steps and resolve dependencies
 */
async function executeDAG(llmOutput) {
    const dag = llmOutput.dag;

    // Create execution context to store results from each step
    const context = {
        results: {}, // Store results by step ID
        metadata: {
            startTime: Date.now(),
            executedSteps: []
        }
    };

    // Validate and execute each step
    for (const step of dag) {
        // Check if function exists
        if (!functions[step.function]) {
            throw new Error(`${step.function} function not available`);
        }

        // Resolve dependencies - wait for dependent steps to complete
        if (step.dependencies && step.dependencies.length > 0) {
            for (const depId of step.dependencies) {
                if (!context.results[depId]) {
                    throw new Error(`Dependency ${depId} not found for step ${step.id}`);
                }
            }
        }

        // Resolve parameter references (e.g., "{{1.output}}" -> actual value from step 1)
        const resolvedParams = resolveParameterReferences(step.parameters, context);

        // Validate parameters using Zod schema for runtime type checking
        if (functionSchemas[step.function]) {
            try {
                const validatedParams = functionSchemas[step.function].parse(resolvedParams);
                // Execute with validated parameters and context
                const result = await functions[step.function].function(validatedParams, context);

                // Store result in context for later steps
                context.results[step.id] = result;
                context.metadata.executedSteps.push(step.id);

            } catch (error) {
                if (error instanceof z.ZodError) {
                    throw new Error(
                        `Parameter validation failed for ${step.function}: ${JSON.stringify(error.errors)}`
                    );
                }
                throw error;
            }
        } else {
            // If no schema, execute directly
            const result = await functions[step.function].function(resolvedParams, context);
            context.results[step.id] = result;
            context.metadata.executedSteps.push(step.id);
        }
    }

    return context;
}

/**
 * Resolve parameter references like {{stepId.output}} to actual values
 */
function resolveParameterReferences(parameters, context) {
    const resolved = {};

    for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'string' && value.includes('{{')) {
            // Match pattern like {{1.output}} or {{step1.output}}
            const match = value.match(/\{\{([^.]+)\.([^}]+)\}\}/);
            if (match) {
                const [, stepId, property] = match;
                if (context.results[stepId] && context.results[stepId][property] !== undefined) {
                    resolved[key] = value.replace(match[0], context.results[stepId][property]);
                } else {
                    resolved[key] = value; // Keep original if reference not found
                }
            } else {
                resolved[key] = value;
            }
        } else {
            resolved[key] = value;
        }
    }

    return resolved;
}

// Test the model function
function testModelFunction() {
    model(
        "briefly define agent in terms of computer science",
        (response) => console.log(JSON.stringify(response)),
        (err) => console.error(err)
    );
}