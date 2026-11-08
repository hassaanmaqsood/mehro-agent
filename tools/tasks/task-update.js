import { z } from 'zod';
import { variablesRepo, getDb } from '../../runtime/store.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  output: z.any().optional(),
  error: z.string().nullable().optional()
});

export const artifact = {
  id: 'tools/tasks/task-update',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Update Task',
    description: 'Updates task status, output, or error state',
    tags: ['tasks', 'update']
  },
  interface: {
    inputs: {
      id: { type: 'string', description: 'Task UUID', required: true },
      status: { type: 'string', description: 'Updated status', required: false },
      output: { type: 'any', description: 'Execution output', required: false },
      error: { type: 'string', description: 'Error message', required: false }
    },
    outputs: {
      result: { type: 'object', description: 'Updated task record' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      if (state.dbPath) getDb(state.dbPath);
      const validated = schema.parse(input);
      const existing = variablesRepo.get('tasks', validated.id);
      if (!existing || !existing.value) {
        return cb({ output: { result: null, error: `Task not found: ${validated.id}` }, state });
      }

      const task = { ...existing.value };
      if (validated.status !== undefined) task.status = validated.status;
      if (validated.output !== undefined) task.output = validated.output;
      if (validated.error !== undefined) task.error = validated.error;
      task.updatedAt = new Date().toISOString();

      variablesRepo.set('tasks', validated.id, task, 'state');
      logger.info(`[TASK] Updated task ${validated.id} to status '${task.status}'`);

      cb({ output: { result: task, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
