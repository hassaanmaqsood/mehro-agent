/**
 * STRICT SCHEMA MODULE
 * Zero tolerance for unparseable outputs
 */

/**
 * Task Status Enum
 */
const TaskStatus = {
    PENDING: 'pending',
    CLARIFYING: 'clarifying',
    DECOMPOSING: 'decomposing',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

/**
 * Schema Definitions
 */
const Schemas = {
    /**
     * Task Clarification Response
     */
    TaskClarification: {
        name: 'TaskClarification',
        validate: (obj) => {
            const required = ['original_task', 'is_clear', 'clarified_task', 'reasoning'];
            const valid = required.every(field => field in obj);

            if (!valid) return { valid: false, error: 'Missing required fields' };
            if (typeof obj.is_clear !== 'boolean') return { valid: false, error: 'is_clear must be boolean' };

            return { valid: true };
        },
        example: {
            original_task: "do something",
            is_clear: false,
            clarified_task: "Create a specific action plan",
            reasoning: "Original task was too vague"
        }
    },

    /**
     * Task Decomposition Response
     */
    TaskDecomposition: {
        name: 'TaskDecomposition',
        validate: (obj) => {
            const required = ['task_id', 'is_atomic', 'subtasks', 'reasoning'];
            const valid = required.every(field => field in obj);

            if (!valid) return { valid: false, error: 'Missing required fields' };
            if (typeof obj.is_atomic !== 'boolean') return { valid: false, error: 'is_atomic must be boolean' };
            if (!Array.isArray(obj.subtasks)) return { valid: false, error: 'subtasks must be array' };

            return { valid: true };
        },
        example: {
            task_id: "task_1",
            is_atomic: true,
            subtasks: [],
            reasoning: "This is a simple question that can be answered directly without breaking it down into steps"
        }
    },

    /**
     * Task Execution Response
     */
    TaskExecution: {
        name: 'TaskExecution',
        validate: (obj) => {
            const required = ['task_id', 'status', 'result', 'confidence', 'verification_method'];
            const valid = required.every(field => field in obj);

            if (!valid) return { valid: false, error: 'Missing required fields' };
            if (!Object.values(TaskStatus).includes(obj.status)) {
                return { valid: false, error: 'Invalid status' };
            }
            if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
                return { valid: false, error: 'confidence must be 0-1' };
            }

            return { valid: true };
        },
        example: {
            task_id: "task_1",
            status: "completed",
            result: "Task completed successfully",
            confidence: 0.95,
            verification_method: "execution completed without errors"
        }
    },

    /**
     * Function Call Response
     */
    FunctionCall: {
        name: 'FunctionCall',
        validate: (obj) => {
            const required = ['function_name', 'parameters', 'reasoning'];
            const valid = required.every(field => field in obj);

            if (!valid) return { valid: false, error: 'Missing required fields' };
            if (typeof obj.parameters !== 'object') return { valid: false, error: 'parameters must be object' };

            return { valid: true };
        },
        example: {
            function_name: "search_knowledge",
            parameters: { query: "capital of France" },
            reasoning: "Need to look up factual information"
        }
    }
};

/**
 * Parse and validate LLM output against schema
 */
function parseAndValidate(rawOutput, schemaName) {
    const schema = Schemas[schemaName];

    if (!schema) {
        return {
            success: false,
            error: `Unknown schema: ${schemaName}`,
            raw: rawOutput
        };
    }

    try {
        // Try to extract JSON from output
        let jsonStr = rawOutput.trim();

        // Remove markdown code blocks if present
        jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');

        // Find JSON object in text
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        const parsed = JSON.parse(jsonStr);

        // Validate against schema
        const validation = schema.validate(parsed);

        if (!validation.valid) {
            console.log(`[SCHEMA] ❌ VALIDATION FAILED: ${validation.error}`);
            return {
                success: false,
                error: validation.error,
                raw: rawOutput,
                parsed: parsed
            };
        }

        console.log(`[SCHEMA] ✅ VALIDATION PASSED: ${schema.name}`);
        return {
            success: true,
            data: parsed,
            raw: rawOutput
        };

    } catch (error) {
        console.log(`[SCHEMA] ❌ PARSE ERROR: ${error.message}`);
        return {
            success: false,
            error: `Parse error: ${error.message}`,
            raw: rawOutput
        };
    }
}

/**
 * Get schema prompt for LLM
 */
function getSchemaPrompt(schemaName) {
    const schema = Schemas[schemaName];
    if (!schema) return '';

    // Special handling for TaskDecomposition to make it clearer
    if (schemaName === 'TaskDecomposition') {
        return `Analyze if this task needs decomposition.

RULES (follow exactly):
1. Questions like "What is X?" → is_atomic: true, subtasks: []
2. Calculations like "Calculate X" → is_atomic: true, subtasks: []  
3. Simple lookups/searches → is_atomic: true, subtasks: []
4. ONLY decompose if task needs 3+ distinct sequential steps
5. When atomic, subtasks MUST be empty array []

Examples:

"What is the capital of France?" →
{
  "task_id": "task_1",
  "is_atomic": true,
  "subtasks": [],
  "reasoning": "Simple question"
}

"Create file, test it, then deploy" →
{
  "task_id": "task_1",
  "is_atomic": false,
  "subtasks": ["Create file", "Test file", "Deploy"],
  "reasoning": "Multiple sequential steps"
}

Respond ONLY with JSON (no markdown, no extra text):

`;
    }

    return `You MUST respond with ONLY valid JSON matching this exact schema:

${JSON.stringify(schema.example, null, 2)}

RULES:
- Respond ONLY with valid JSON
- Do not include any text before or after the JSON
- Do not use markdown code blocks
- All required fields must be present
- Follow the exact field names and types shown above

`;
}


module.exports = {
    TaskStatus,
    Schemas,
    parseAndValidate,
    getSchemaPrompt
};