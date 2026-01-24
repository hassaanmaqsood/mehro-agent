/**
 * STATE MODULE - Ground Truth Management
 * All facts and execution context stored here
 */

class AgentState {
    constructor(taskList = []) {
        this.taskList = taskList;
        this.verifiedFacts = {}; // Key-value store of confirmed facts
        this.taskDecomposition = {}; // task_id -> subtasks[]
        this.completedTasks = [];
        this.executionLog = [];
        this.lowConfidenceItems = [];
        this.currentTaskIndex = 0;
        this.createdAt = new Date().toISOString();
        this.lastUpdated = new Date().toISOString();
    }

    /**
     * Add a verified fact to state
     */
    addFact(key, value, source = 'agent') {
        this.verifiedFacts[key] = {
            value,
            source,
            timestamp: new Date().toISOString()
        };
        this.lastUpdated = new Date().toISOString();
        this._log(`FACT_ADDED: ${key} = ${JSON.stringify(value)}`);
    }

    /**
     * Get a fact from state
     */
    getFact(key) {
        return this.verifiedFacts[key]?.value || null;
    }

    /**
     * Add task decomposition
     */
    addDecomposition(taskId, subtasks) {
        this.taskDecomposition[taskId] = subtasks;
        this._log(`DECOMPOSITION: Task ${taskId} -> ${subtasks.length} subtasks`);
    }

    /**
     * Mark task as completed
     */
    completeTask(taskId, result) {
        this.completedTasks.push({
            taskId,
            result,
            timestamp: new Date().toISOString()
        });
        this._log(`TASK_COMPLETED: ${taskId}`);
    }

    /**
     * Add low confidence item for review
     */
    flagLowConfidence(item, reason) {
        this.lowConfidenceItems.push({
            item,
            reason,
            timestamp: new Date().toISOString()
        });
        this._log(`LOW_CONFIDENCE: ${item} - ${reason}`);
    }

    /**
     * Add execution log entry
     */
    log(action, details) {
        this.executionLog.push({
            action,
            details,
            timestamp: new Date().toISOString()
        });
    }

    _log(message) {
        console.log(`[STATE] ${message}`);
    }

    /**
     * Get current state summary
     */
    getSummary() {
        return {
            totalTasks: this.taskList.length,
            completedTasks: this.completedTasks.length,
            factsStored: Object.keys(this.verifiedFacts).length,
            lowConfidenceCount: this.lowConfidenceItems.length,
            currentTaskIndex: this.currentTaskIndex
        };
    }

    /**
     * Export state for persistence
     */
    export() {
        return JSON.stringify(this, null, 2);
    }

    /**
     * Import state from JSON
     */
    static import(jsonString) {
        const data = JSON.parse(jsonString);
        const state = new AgentState(data.taskList);
        Object.assign(state, data);
        return state;
    }
}

module.exports = AgentState;