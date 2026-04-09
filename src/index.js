require("dotenv").config();
const fs = require('fs');
const path = require('path');
const { z } = require("zod");
const tui = require("./tui");
const tools = require("./tools");
const { hasCircularDependency } = require("./core/dag_validator");

// Configuration
const config = {
    ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'tinyllama:1.1b',
    historyFile: path.join(__dirname, '..', 'history.json')
};

// State
let tasks = [];
let activeTaskId = null;
let modelRequests = 0;
let inputTokens = 0;
let outputTokens = 0;

// Load history on startup
try {
    if (fs.existsSync(config.historyFile)) {
        const data = fs.readFileSync(config.historyFile, 'utf8');
        tasks = JSON.parse(data);
    }
} catch (err) {
    console.error(`Failed to load history: ${err.message}`);
}

// Sync with TUI
tui.updateState({
    tasks,
    activeModel: config.ollamaModel,
    provider: 'OLLAMA'
});

// Override console.log to pipe to TUI with task context
console.log = (...args) => {
    const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    tui.logTask(activeTaskId, msg);
};

// Register TUI Callbacks
tui.on('addTask', (prompt) => {
    const newTask = {
        id: (tasks.length + 1).toString(),
        userPrompt: prompt,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        thoughtProcess: "",
        output: ""
    };
    tasks.push(newTask);
    tui.updateState({ tasks });
});

tui.on('runTask', (id) => {
    const task = tasks.find(t => t.id === id);
    if (task && task.status === 'pending') {
        task.status = 'run';
        tui.updateState({ tasks });
    }
});

tui.on('deleteTask', (id) => {
    const index = tasks.findIndex(t => t.id === id);
    if (index !== -1) {
        // Clear activeTaskId if we are deleting the running task
        if (activeTaskId === id) {
            activeTaskId = null;
        }
        tasks.splice(index, 1);
        tui.updateState({ tasks });
    }
});

tui.on('getTasks', () => tasks);

tui.on('updateTask', (id, newPrompt) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.userPrompt = newPrompt;
        tui.updateState({ tasks });
    }
});

tui.on('getCapabilities', () => {
    return Object.values(tools).map(tool => ({
        id: tool.name,
        description: tool.description
    }));
});

// Graceful Exit
function cleanup() {
    try {
        fs.writeFileSync(config.historyFile, JSON.stringify(tasks, null, 2));
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
tui.on('quit', cleanup);

// Utility
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// DAG Schema Generation
function generateSchema(availableTools) {
    const toolVariants = Object.values(availableTools).map(tool => ({
        type: "object",
        properties: {
            id: { type: "string", description: "Unique identifier for this step" },
            function: { type: "string", enum: [tool.name] },
            parameters: {
                type: "object",
                properties: tool.parameters,
                required: tool.required || [],
                additionalProperties: false
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
                items: { anyOf: toolVariants }
            }
        },
        required: ["thought_process", "dag"]
    };
}

// Agent Loop
async function runAgentLoop() {
    while (true) {
        const runnableTasks = tasks.filter(task => task.status === "run");
        if (runnableTasks.length === 0) {
            tui.updateState({ isWorking: false });
            await sleep(1000);
            continue;
        }

        const task = runnableTasks[0];
        activeTaskId = task.id;
        tui.updateState({ isWorking: true });

        const prompt = buildModelPrompt(task);
        const estimatedInputTokens = Math.ceil(prompt.length / 4);

        task.status = "ongoing";
        tui.updateState({ tasks });

        try {
            await new Promise((resolve, reject) => {
                model(prompt, estimatedInputTokens, async (rawResponse) => {
                    const response = parseModelOutput(rawResponse);
                    if (response) {
                        try {
                            task.thoughtProcess = response.thought_process || "";
                            task.dag = response.dag || [];

                            // CIRCULAR DEPENDENCY CHECK
                            if (hasCircularDependency(task.dag)) {
                                throw new Error("Generated DAG has circular dependencies.");
                            }

                            tui.updateState({ tasks });

                            await executeDAG(response, task);
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
                    tui.updateState({ tasks });
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

        activeTaskId = null;
        await sleep(1000);
    }
}

runAgentLoop().catch(err => console.error("[FATAL]", err));

// Templating
function buildModelPrompt(task) {
    const toolDescriptions = Object.values(tools).map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        required: tool.required,
    }));

    return `You are an AI agent that generates execution plans as DAGs (Directed Acyclic Graphs).

User Request: ${task.userPrompt}

Available Functions:
${JSON.stringify(toolDescriptions, null, 2)}

IMPORTANT GUIDELINES:
1. You MUST respond with ONLY valid JSON. No markdown, no explanations, no extra text.
2. For general knowledge questions or queries that don't require function calls:
   - Use the 'log' function to provide the answer directly
3. Steps can reference outputs from previous steps using {{stepId.output}}
4. Set dependencies array to show which steps must complete before this step runs

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
}

async function model(prompt, estimatedInputTokens, onComplete, onError) {
    try {
        const responseSchema = generateSchema(tools);
        const ollamaPrompt = prompt + "\n\nCRITICAL: You MUST output ONLY valid JSON that strictly matches this schema:\n" + JSON.stringify(responseSchema, null, 2) + "\nDo not include Markdown blocks. Output ONLY raw JSON.";

        const url = `${config.ollamaHost}/api/generate`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.ollamaModel,
                prompt: ollamaPrompt,
                stream: false,
                format: "json"
            })
        });

        if (!res.ok) throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);

        const data = await res.json();
        const responseText = data.response || "";

        modelRequests++;
        inputTokens += estimatedInputTokens;
        outputTokens += Math.ceil(responseText.length / 4);

        console.log(`[USAGE] Ollama complete. In: ~${estimatedInputTokens}, Out: ~${Math.ceil(responseText.length / 4)}`);

        onComplete(responseText);
    } catch (error) {
        console.error("[MODEL ERROR]", error.message);
        onError(error);
    }
}

function parseModelOutput(rawString) {
    try {
        let cleanStr = rawString.trim().replace(/^```(json)?|```$/g, "").trim();
        const parsed = JSON.parse(cleanStr);
        if (!parsed.dag || !Array.isArray(parsed.dag)) throw new Error("Missing 'dag' array.");
        return parsed;
    } catch (e) {
        console.error("Parsing Failed:", e.message);
        return null;
    }
}

async function executeDAG(llmOutput, task) {
    const dag = llmOutput.dag;
    const context = { results: {}, metadata: { startTime: Date.now(), executedSteps: [] } };

    for (const step of dag) {
        step.status = 'ongoing';
        tui.updateState({ tasks });

        const tool = tools[step.function];
        if (!tool) throw new Error(`${step.function} tool not available`);

        // Dependency Resolution
        for (const depId of step.dependencies || []) {
            if (!context.results[depId]) throw new Error(`Dependency ${depId} not met for ${step.id}`);
        }

        const resolvedParams = resolveParameterReferences(step.parameters, context);

        try {
            const validatedParams = tool.schema ? tool.schema.parse(resolvedParams) : resolvedParams;
            const result = await tool.function(validatedParams, context);

            context.results[step.id] = result;
            context.metadata.executedSteps.push(step.id);

            step.status = 'success';
            task.output += `\n[${step.id}] ${JSON.stringify(result.output || result)}`;
            tui.updateState({ tasks });
        } catch (error) {
            step.status = 'error';
            task.error = error.message;
            tui.logTask(task.id, `{red-fg}[FAILURE]{/red-fg} Node [${step.id}] failed: ${error.message}`);
            tui.updateState({ tasks });
            throw error;
        }
    }
    return context;
}

function resolveParameterReferences(parameters, context) {
    const resolved = {};
    for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'string' && value.includes('{{')) {
            const match = value.match(/\{\{([^.]+)\.([^}]+)\}\}/);
            if (match) {
                const [, stepId, property] = match;
                if (context.results[stepId] && context.results[stepId][property] !== undefined) {
                    resolved[key] = value.replace(match[0], context.results[stepId][property]);
                } else {
                    resolved[key] = value;
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