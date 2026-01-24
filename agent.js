/**
 * MAIN AGENT - SSV Framework Orchestrator
 * Coordinates State, Schema, and Voting for task execution
 */

const AgentState = require('./state.js');
const { LLM } = require('./llm.js');
const { executeFunction, getAvailableFunctions } = require('./functions.js');
const { performVote, quickVote, VoteConfig } = require('./voting.js');
const { TaskStatus } = require('./schema.js');

/**
 * SSV Agent Configuration
 */
class AgentConfig {
    constructor() {
        this.useVoting = true; // Enable consensus voting
        this.voteConfig = new VoteConfig();
        this.maxDecompositionDepth = 3; // Prevent infinite decomposition
        this.clarifyUnclearTasks = true;
        this.verboseLogging = true;
    }
}

/**
 * Main SSV Agent
 */
class SSVAgent {
    constructor(config = new AgentConfig()) {
        this.config = config;
        this.state = null;
        this.llm = new LLM();
    }

    /**
     * Initialize agent with model
     */
    async initialize(modelPath = null) {
        console.log('\n' + '='.repeat(60));
        console.log('SSV AGENT INITIALIZATION');
        console.log('='.repeat(60));

        if (modelPath) {
            await this.llm.load(modelPath);
        } else {
            console.log('[AGENT] No model path provided - using MOCK MODE');
        }

        console.log('[AGENT] ✅ Agent initialized');
        console.log('[AGENT] Voting enabled:', this.config.useVoting);
        console.log('[AGENT] Vote samples:', this.config.voteConfig.samplesPerVote);
    }

    /**
     * Execute a list of tasks
     */
    async executeTasks(taskList) {
        console.log('\n' + '='.repeat(60));
        console.log('TASK EXECUTION START');
        console.log('='.repeat(60));
        console.log(`[AGENT] Total tasks: ${taskList.length}`);

        // Initialize state
        this.state = new AgentState(taskList);

        // Process each task
        for (let i = 0; i < taskList.length; i++) {
            this.state.currentTaskIndex = i;
            const task = taskList[i];

            console.log('\n' + '-'.repeat(60));
            console.log(`[AGENT] 📋 TASK ${i + 1}/${taskList.length}: ${task}`);
            console.log('-'.repeat(60));

            const success = await this.executeTask(task, `task_${i + 1}`);

            if (!success) {
                console.log(`[AGENT] ⚠️  Task ${i + 1} failed or requires manual intervention`);
                this.state.flagLowConfidence(`task_${i + 1}`, 'execution_failed');
            }
        }

        // Print final summary
        this.printSummary();

        return this.state;
    }

    /**
     * Execute a single task
     */
    async executeTask(task, taskId, depth = 0) {
        // Prevent infinite recursion
        if (depth >= this.config.maxDecompositionDepth) {
            console.log(`[AGENT] ⚠️  Max decomposition depth reached`);
            return false;
        }

        // Step 1: Clarify task if needed
        if (this.config.clarifyUnclearTasks) {
            const clarified = await this.clarifyTask(task);

            if (!clarified.is_clear) {
                console.log(`[AGENT] 📝 Task clarified: ${clarified.clarified_task}`);
                task = clarified.clarified_task;
            }
        }

        // Step 2: Check if task needs decomposition
        const decomposition = await this.decomposeTask(task, taskId);

        if (!decomposition.is_atomic && decomposition.subtasks.length > 0) {
            console.log(`[AGENT] 🔀 Task decomposed into ${decomposition.subtasks.length} subtasks`);
            this.state.addDecomposition(taskId, decomposition.subtasks);

            // Execute each subtask
            for (let i = 0; i < decomposition.subtasks.length; i++) {
                const subtask = decomposition.subtasks[i];
                const subtaskId = `${taskId}_sub_${i + 1}`;

                console.log(`\n[AGENT] 🔸 Subtask ${i + 1}/${decomposition.subtasks.length}`);
                const success = await this.executeTask(subtask, subtaskId, depth + 1);

                if (!success) {
                    return false;
                }
            }

            this.state.completeTask(taskId, 'All subtasks completed');
            return true;
        }

        // Step 3: Execute atomic task
        return await this.executeAtomicTask(task, taskId);
    }

    /**
     * Clarify an unclear task
     */
    async clarifyTask(task) {
        console.log(`\n[AGENT] 🔍 Checking task clarity...`);

        const prompt = `Analyze if this task is clear and well-defined: "${task}"
    
Consider:
- Is the objective specific?
- Are requirements clear?
- Is scope well-defined?

If unclear, provide a clarified version.`;

        const llmFunc = async (p, opts) => this.llm.complete(p, 'TaskClarification', opts);

        let voteResult;
        if (this.config.useVoting) {
            voteResult = await performVote(llmFunc, prompt, 'TaskClarification', this.config.voteConfig);
        } else {
            voteResult = await quickVote(llmFunc, prompt, 'TaskClarification');
        }

        if (voteResult.consensusReached) {
            return voteResult.winningOutput;
        } else {
            // Default: assume task is clear
            return {
                original_task: task,
                is_clear: true,
                clarified_task: task,
                reasoning: 'No consensus, proceeding with original task'
            };
        }
    }

    /**
     * Decompose task into subtasks
     */
    async decomposeTask(task, taskId) {
        console.log(`\n[AGENT] 🔀 Checking if task needs decomposition...`);

        const prompt = `Analyze if this task is atomic or needs decomposition: "${task}"

A task is atomic if it can be completed in one step without breaking down.
If the task requires multiple distinct steps, decompose it into clear subtasks.

Consider:
- Does it require multiple sequential steps?
- Can it be done in one action?
- Would breaking it down make it clearer?`;

        const llmFunc = async (p, opts) => this.llm.complete(p, 'TaskDecomposition', opts);

        let voteResult;
        if (this.config.useVoting) {
            voteResult = await performVote(llmFunc, prompt, 'TaskDecomposition', this.config.voteConfig);
        } else {
            voteResult = await quickVote(llmFunc, prompt, 'TaskDecomposition');
        }

        if (voteResult.consensusReached) {
            return voteResult.winningOutput;
        } else {
            // Default: assume atomic
            return {
                task_id: taskId,
                is_atomic: true,
                subtasks: [],
                reasoning: 'No consensus, treating as atomic task'
            };
        }
    }

    /**
     * Execute an atomic task
     */
    async executeAtomicTask(task, taskId) {
        console.log(`\n[AGENT] ⚡ Executing atomic task...`);

        // Check if task requires a function call
        const functionDecision = await this.decideFunctionCall(task);

        if (functionDecision && functionDecision.function_name !== 'none') {
            // Execute function
            console.log(`\n[AGENT] 🔧 Calling function: ${functionDecision.function_name}`);
            const result = await executeFunction(
                functionDecision.function_name,
                functionDecision.parameters,
                this.state
            );

            if (result.success) {
                this.state.completeTask(taskId, result.result);
                return true;
            } else {
                console.log(`[AGENT] ❌ Function execution failed: ${result.error}`);
                return false;
            }
        }

        // Direct task execution (using LLM)
        const prompt = `Execute this task: "${task}"

Provide the result of completing this task.
If you cannot complete it, explain why.`;

        const llmFunc = async (p, opts) => this.llm.complete(p, 'TaskExecution', opts);

        let voteResult;
        if (this.config.useVoting) {
            voteResult = await performVote(llmFunc, prompt, 'TaskExecution', this.config.voteConfig);
        } else {
            voteResult = await quickVote(llmFunc, prompt, 'TaskExecution');
        }

        if (voteResult.consensusReached) {
            const result = voteResult.winningOutput;

            if (result.status === 'completed') {
                this.state.completeTask(taskId, result.result);
                return true;
            } else {
                console.log(`[AGENT] ⚠️  Task not completed: ${result.status}`);
                return false;
            }
        } else {
            console.log(`[AGENT] ⚠️  No consensus on task execution`);
            return false;
        }
    }

    /**
     * Decide if a function call is needed
     */
    async decideFunctionCall(task) {
        const availableFunctions = getAvailableFunctions();

        const functionsDesc = availableFunctions.map(f =>
            `- ${f.name}: ${f.description}`
        ).join('\n');

        const prompt = `Given this task: "${task}"

Available functions:
${functionsDesc}

Should we call a function to complete this task?
If yes, specify which function and parameters.
If no, set function_name to "none".`;

        const llmFunc = async (p, opts) => this.llm.complete(p, 'FunctionCall', opts);

        const voteResult = await quickVote(llmFunc, prompt, 'FunctionCall');

        if (voteResult.consensusReached) {
            return voteResult.winningOutput;
        } else {
            return { function_name: 'none', parameters: {}, reasoning: 'No consensus' };
        }
    }

    /**
     * Print execution summary
     */
    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('EXECUTION SUMMARY');
        console.log('='.repeat(60));

        const summary = this.state.getSummary();

        console.log(`Total Tasks:       ${summary.totalTasks}`);
        console.log(`Completed Tasks:   ${summary.completedTasks}`);
        console.log(`Facts Stored:      ${summary.factsStored}`);
        console.log(`Low Confidence:    ${summary.lowConfidenceCount}`);

        console.log('\n📊 Completed Tasks:');
        this.state.completedTasks.forEach((task, idx) => {
            const result = typeof task.result === 'string' ? task.result : JSON.stringify(task.result);
            const preview = result.substring(0, 60);
            console.log(`  ${idx + 1}. [${task.taskId}] ${preview}${result.length > 60 ? '...' : ''}`);
        });

        if (this.state.lowConfidenceItems.length > 0) {
            console.log('\n⚠️  Low Confidence Items:');
            this.state.lowConfidenceItems.forEach((item, idx) => {
                console.log(`  ${idx + 1}. ${item.item}: ${item.reason}`);
            });
        }

        console.log('\n📦 State Facts:');
        Object.keys(this.state.verifiedFacts).forEach(key => {
            const fact = this.state.verifiedFacts[key];
            console.log(`  - ${key}: ${JSON.stringify(fact.value).substring(0, 50)}...`);
        });

        console.log('\n' + '='.repeat(60));
    }

    /**
     * Cleanup
     */
    async shutdown() {
        console.log('\n[AGENT] 🔄 Shutting down...');
        await this.llm.unload();
        console.log('[AGENT] ✅ Shutdown complete');
    }
}

module.exports = {
    SSVAgent,
    AgentConfig
};