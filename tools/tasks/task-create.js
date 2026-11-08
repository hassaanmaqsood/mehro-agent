import crypto from 'crypto';
import { z } from 'zod';
import { variablesRepo, getDb } from '../../runtime/store.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  prompt: z.string().min(1),
  status: z.enum(['pending', 'running', 'completed', 'failed']).default('pending'),
  priority: z.number().default(1),
  metadata: z.record(z.string(), z.any()).optional().default({})
});

export const artifact = {
  id: 'tools/tasks/task-create',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Create Task',
    description: 'Creates a persistent task in SQLite tasks namespace',
    tags: ['tasks', 'create']
  },
  interface: {
    inputs: {
      prompt: { type: 'string', description: 'Task prompt or instruction', required: true },
      status: { type: 'string', description: 'Initial status', required: false },
      priority: { type: 'number', description: 'Task priority', required: false },
      metadata: { type: 'object', description: 'Arbitrary task metadata', required: false }
    },
    outputs: {
      result: { type: 'object', description: 'Created task record' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      if (state.dbPath) getDb(state.dbPath);
      const validated = schema.parse(input);
      const taskId = crypto.randomUUID();
      const taskRecord = {
        id: taskId,
        prompt: validated.prompt,
        status: validated.status,
        priority: validated.priority,
        metadata: validated.metadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      variablesRepo.set('tasks', taskId, taskRecord, 'state');
      logger.info(`[TASK] Created task ${taskId}: "${validated.prompt.slice(0, 30)}..."`);

      cb({ output: { result: taskRecord, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
