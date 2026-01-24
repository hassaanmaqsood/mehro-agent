/**
 * LLM MODULE - Local Model Integration
 * Wrapper around node-llama-cpp with schema enforcement
 */

const { parseAndValidate, getSchemaPrompt } = require('./schema.js');

// Mock mode flag - set to true if no model is available
let MOCK_MODE = false;

/**
 * LLM Configuration
 */
class LLMConfig {
    constructor() {
        this.modelPath = null; // Will be set when model is loaded
        this.contextSize = 2048;
        this.threads = 4;
        this.gpuLayers = 0; // CPU only by default
    }
}

/**
 * Mock LLM responses for testing without model
 */
const mockResponses = {
    TaskClarification: (task) => {
        const wordCount = task.split(' ').length;
        return {
            original_task: task,
            is_clear: wordCount > 3 && !task.includes('something') && !task.includes('better'),
            clarified_task: wordCount > 3 ? task : `Create a specific plan to: ${task} with measurable objectives`,
            reasoning: wordCount > 3 ? "Task is sufficiently clear" : "Task needs more specificity"
        };
    },

    TaskDecomposition: (task) => {
        // Check if task genuinely needs decomposition
        const indicators = {
            hasMultipleVerbs: (task.match(/\b(and|then|after|before)\b/gi) || []).length > 0,
            hasMultipleSteps: task.split(',').length > 1 || task.split(';').length > 1,
            isTooComplex: task.split(' ').length > 15
        };

        const needsDecomposition = indicators.hasMultipleVerbs || indicators.hasMultipleSteps || indicators.isTooComplex;

        let subtasks = [];
        if (needsDecomposition) {
            // Only decompose if we can identify clear subtasks
            if (task.toLowerCase().includes('python') && task.toLowerCase().includes('save')) {
                subtasks = [
                    "Create Python code that prints 'Hello, World!'",
                    "Save the code to hello.py file"
                ];
            } else if (task.toLowerCase().includes('data') && task.toLowerCase().includes('report')) {
                subtasks = [
                    "Gather and analyze the data",
                    "Create visualizations",
                    "Write the summary"
                ];
            } else if (task.includes(' and ')) {
                // Split on 'and'
                const parts = task.split(' and ');
                subtasks = parts.length <= 3 ? parts : [];
            }
        }

        return {
            task_id: "task_1",
            is_atomic: !needsDecomposition || subtasks.length === 0,
            subtasks: subtasks,
            reasoning: needsDecomposition && subtasks.length > 0
                ? "Task has multiple distinct steps"
                : "Task is atomic and can be executed directly"
        };
    },

    TaskExecution: (task) => ({
        task_id: "task_1",
        status: "completed",
        result: `Executed: ${task}`,
        confidence: 0.85,
        verification_method: "mock execution completed"
    }),

    FunctionCall: (task) => {
        const lowerTask = task.toLowerCase();

        // Determine which function to call based on task
        if (lowerTask.includes('capital') || lowerTask.includes('what is')) {
            return {
                function_name: "search_knowledge",
                parameters: { query: task.replace(/what is |the /gi, '') },
                reasoning: "Task requires knowledge lookup"
            };
        } else if (lowerTask.includes('calculate') || /\d+\s*[\+\-\*\/]\s*\d+/.test(lowerTask)) {
            const match = task.match(/(\d+\s*[\+\-\*\/]\s*\d+)/);
            return {
                function_name: "calculate",
                parameters: { expression: match ? match[1] : "0" },
                reasoning: "Task requires mathematical calculation"
            };
        } else if (lowerTask.includes('time') || lowerTask.includes('date')) {
            return {
                function_name: "get_current_time",
                parameters: {},
                reasoning: "Task requires current time"
            };
        } else if (lowerTask.includes('save') && lowerTask.includes('file')) {
            // Extract filename if possible
            const filenameMatch = task.match(/([a-z_]+\.py)/i);
            return {
                function_name: "write_file",
                parameters: {
                    filepath: filenameMatch ? filenameMatch[1] : "output.txt",
                    content: "print('Hello, World!')"
                },
                reasoning: "Task requires writing to file"
            };
        } else if (lowerTask.includes('read') && lowerTask.includes('file')) {
            return {
                function_name: "read_file",
                parameters: { filepath: "input.txt" },
                reasoning: "Task requires reading file"
            };
        } else if (lowerTask.includes('add') && lowerTask.includes('knowledge')) {
            return {
                function_name: "add_knowledge",
                parameters: { key: "test", value: "test value" },
                reasoning: "Task requires adding knowledge"
            };
        } else {
            return {
                function_name: "none",
                parameters: {},
                reasoning: "No function needed, will execute directly"
            };
        }
    }
};

/**
 * LLM Instance
 */
class LLM {
    constructor(config = new LLMConfig()) {
        this.config = config;
        this.model = null;
        this.context = null;
        this.session = null;
        this.isLoaded = false;
    }

    /**
     * Load model from file
     */
    async load(modelPath) {
        console.log(`\n[LLM] 🔄 Loading model: ${modelPath}`);

        try {
            // Use dynamic import for ESM compatibility (node-llama-cpp v3+)
            const llamaModule = await import('node-llama-cpp');
            const { getLlama, LlamaChatSession } = llamaModule;

            const llama = await getLlama();
            this.model = await llama.loadModel({
                modelPath: modelPath
            });

            // Create context with MULTIPLE sequences to support voting
            this.context = await this.model.createContext({
                contextSize: this.config.contextSize,
                sequences: 4  // Allow up to 4 concurrent sequences (for voting)
            });

            console.log(`[LLM] Available sequences: 4`);

            // Store LlamaChatSession class for later use
            this.LlamaChatSession = LlamaChatSession;

            // CRITICAL FIX: Create ONE persistent session and reuse it
            // This avoids sequence exhaustion from creating/disposing sessions repeatedly
            this.session = new LlamaChatSession({
                contextSequence: this.context.getSequence()
            });

            this.config.modelPath = modelPath;
            this.isLoaded = true;
            MOCK_MODE = false;

            console.log(`[LLM] ✅ Model loaded successfully`);
            console.log(`[LLM] Context size: ${this.config.contextSize}`);
            console.log(`[LLM] ✅ Persistent session created`);

        } catch (error) {
            console.log(`[LLM] ⚠️  Could not load model: ${error.message}`);
            console.log(`[LLM] 🎭 Enabling MOCK MODE for testing`);
            MOCK_MODE = true;
            this.isLoaded = false;
        }
    }

    /**
     * Generate completion with schema validation
     */
    async complete(prompt, schemaName, options = {}) {
        const temperature = options.temperature || 0.7;
        const maxTokens = options.maxTokens || 512;
        const resetContext = options.resetContext || false; // New option

        console.log(`\n[LLM] 📝 Generating completion...`);
        console.log(`[LLM] Schema: ${schemaName}`);
        console.log(`[LLM] Temperature: ${temperature}`);

        let rawOutput;

        // Check if we should use mock mode
        const useMock = MOCK_MODE || !this.isLoaded;

        if (useMock) {
            // Mock mode for testing
            console.log(`[LLM] 🎭 MOCK MODE: Generating fake response`);
            await new Promise(resolve => setTimeout(resolve, 300)); // Simulate delay

            const mockData = mockResponses[schemaName]
                ? mockResponses[schemaName](prompt)
                : { error: "Unknown schema" };
            rawOutput = JSON.stringify(mockData, null, 2);

        } else {
            // Real model inference using PERSISTENT SESSION
            console.log(`[LLM] 🤖 Using persistent session`);

            // Optional: Reset context for independent tasks
            if (resetContext && this.session.resetContext) {
                await this.session.resetContext();
                console.log(`[LLM] 🔄 Context reset`);
            }

            // Build full prompt with schema
            const schemaPrompt = getSchemaPrompt(schemaName);
            const fullPrompt = `${schemaPrompt}\n\nTask: ${prompt}\n\nJSON Response:`;

            try {
                // Use the PERSISTENT session - no create/dispose overhead!
                rawOutput = await this.session.prompt(fullPrompt, {
                    temperature: temperature,
                    maxTokens: maxTokens,
                });

                // No disposal needed - session persists across calls

            } catch (error) {
                console.log(`[LLM] ❌ Generation error: ${error.message}`);
                return {
                    success: false,
                    error: error.message,
                    raw: ''
                };
            }
        }

        console.log(`[LLM] Raw output length: ${rawOutput.length} chars`);

        // Validate against schema
        const validated = parseAndValidate(rawOutput, schemaName);

        return validated;
    }

    /**
     * Unload model
     */
    async unload() {
        if (this.session) {
            console.log(`[LLM] 🔄 Unloading model...`);

            // Dispose persistent session
            if (this.session.dispose) {
                await this.session.dispose();
            }

            // Dispose context
            if (this.context && this.context.dispose) {
                this.context.dispose();
            }

            this.model = null;
            this.context = null;
            this.session = null;
            this.isLoaded = false;
            console.log(`[LLM] ✅ Model unloaded`);
        }
    }
}

module.exports = {
    LLM,
    LLMConfig,
    MOCK_MODE
};