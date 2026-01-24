/**
 * PRE-DEFINED FUNCTIONS
 * Tools the agent can use to accomplish tasks
 */

const fs = require('fs');
const path = require('path');

/**
 * Knowledge base for RAG
 */
const knowledgeBase = {
    "capital_of_france": "Paris",
    "capital_of_germany": "Berlin",
    "capital_of_japan": "Tokyo",
    "python_hello_world": "print('Hello, World!')",
    "javascript_hello_world": "console.log('Hello, World!');",
    "what_is_ai": "Artificial Intelligence (AI) is the simulation of human intelligence by machines, especially computer systems.",
    "what_is_machine_learning": "Machine Learning is a subset of AI that enables systems to learn and improve from experience without being explicitly programmed."
};

/**
 * Available functions registry
 */
const Functions = {
    /**
     * Search knowledge base (Simple RAG)
     */
    search_knowledge: {
        description: 'Search the knowledge base for information',
        parameters: {
            query: 'string - search query'
        },
        execute: async (params, state) => {
            console.log(`[FUNCTION] 🔍 Searching knowledge: "${params.query}"`);

            const query = params.query.toLowerCase().replace(/[^a-z0-9_]/g, '_');

            // Direct lookup
            if (knowledgeBase[query]) {
                const result = knowledgeBase[query];
                state.addFact(`knowledge_${query}`, result, 'search_knowledge');
                return {
                    success: true,
                    result: result,
                    source: 'knowledge_base'
                };
            }

            // Fuzzy search through keys
            const matches = Object.keys(knowledgeBase).filter(key =>
                key.includes(query) || query.includes(key)
            );

            if (matches.length > 0) {
                const result = knowledgeBase[matches[0]];
                state.addFact(`knowledge_${query}`, result, 'search_knowledge');
                return {
                    success: true,
                    result: result,
                    source: 'knowledge_base',
                    matched_key: matches[0]
                };
            }

            return {
                success: false,
                error: 'No matching knowledge found',
                query: params.query
            };
        }
    },

    /**
     * Calculate mathematical expression
     */
    calculate: {
        description: 'Perform mathematical calculations',
        parameters: {
            expression: 'string - mathematical expression (e.g., "2 + 2")'
        },
        execute: async (params, state) => {
            console.log(`[FUNCTION] 🧮 Calculating: "${params.expression}"`);

            try {
                // Simple eval - in production, use a safe math parser
                const result = eval(params.expression);
                state.addFact(`calc_${params.expression}`, result, 'calculate');

                return {
                    success: true,
                    result: result,
                    expression: params.expression
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message,
                    expression: params.expression
                };
            }
        }
    },

    /**
     * Read file
     */
    read_file: {
        description: 'Read contents of a file',
        parameters: {
            filepath: 'string - path to file'
        },
        execute: async (params, state) => {
            console.log(`[FUNCTION] 📄 Reading file: "${params.filepath}"`);

            try {
                const content = fs.readFileSync(params.filepath, 'utf8');
                state.addFact(`file_${path.basename(params.filepath)}`, content, 'read_file');

                return {
                    success: true,
                    result: content,
                    filepath: params.filepath,
                    size: content.length
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message,
                    filepath: params.filepath
                };
            }
        }
    },

    /**
     * Write file
     */
    write_file: {
        description: 'Write content to a file',
        parameters: {
            filepath: 'string - path to file',
            content: 'string - content to write'
        },
        execute: async (params, state) => {
            console.log(`[FUNCTION] 💾 Writing file: "${params.filepath}"`);

            try {
                fs.writeFileSync(params.filepath, params.content, 'utf8');
                state.addFact(`written_${path.basename(params.filepath)}`, params.filepath, 'write_file');

                return {
                    success: true,
                    result: `File written successfully: ${params.filepath}`,
                    filepath: params.filepath,
                    size: params.content.length
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message,
                    filepath: params.filepath
                };
            }
        }
    },

    /**
     * List directory
     */
    list_directory: {
        description: 'List files in a directory',
        parameters: {
            dirpath: 'string - path to directory'
        },
        execute: async (params, state) => {
            console.log(`[FUNCTION] 📁 Listing directory: "${params.dirpath}"`);

            try {
                const files = fs.readdirSync(params.dirpath);
                state.addFact(`dir_${path.basename(params.dirpath)}`, files, 'list_directory');

                return {
                    success: true,
                    result: files,
                    dirpath: params.dirpath,
                    count: files.length
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message,
                    dirpath: params.dirpath
                };
            }
        }
    },

    /**
     * Get current time
     */
    get_current_time: {
        description: 'Get the current date and time',
        parameters: {},
        execute: async (params, state) => {
            console.log(`[FUNCTION] ⏰ Getting current time`);

            const now = new Date();
            const result = now.toISOString();
            state.addFact('current_time', result, 'get_current_time');

            return {
                success: true,
                result: result,
                timestamp: now.getTime()
            };
        }
    },

    /**
     * Add to knowledge base
     */
    add_knowledge: {
        description: 'Add a new fact to the knowledge base',
        parameters: {
            key: 'string - knowledge key',
            value: 'string - knowledge value'
        },
        execute: async (params, state) => {
            console.log(`[FUNCTION] 📚 Adding knowledge: "${params.key}"`);

            const key = params.key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
            knowledgeBase[key] = params.value;
            state.addFact(`added_knowledge_${key}`, params.value, 'add_knowledge');

            return {
                success: true,
                result: `Knowledge added: ${params.key} = ${params.value}`,
                key: key
            };
        }
    }
};

/**
 * Execute a function
 */
async function executeFunction(functionName, parameters, state) {
    const func = Functions[functionName];

    if (!func) {
        console.log(`[FUNCTION] ❌ Unknown function: ${functionName}`);
        return {
            success: false,
            error: `Unknown function: ${functionName}`
        };
    }

    try {
        const result = await func.execute(parameters, state);

        // Log execution
        state.log('FUNCTION_CALL', {
            function: functionName,
            parameters,
            result: result.success ? 'success' : 'failed'
        });

        return result;
    } catch (error) {
        console.log(`[FUNCTION] ❌ Execution error: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get list of available functions for prompt
 */
function getAvailableFunctions() {
    return Object.keys(Functions).map(name => {
        const func = Functions[name];
        return {
            name,
            description: func.description,
            parameters: func.parameters
        };
    });
}

module.exports = {
    Functions,
    executeFunction,
    getAvailableFunctions,
    knowledgeBase
};