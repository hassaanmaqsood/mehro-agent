import { z } from 'zod';
import { variablesRepo, getDb } from '../../runtime/store.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  id: z.string().min(1)
});

export const artifact = {
  id: 'tools/tasks/task-delete',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Delete Task',
    description: 'Deletes a persistent task by UUID',
    tags: ['tasks', 'delete']
  },
  interface: {
    inputs: {
      id: { type: 'string', description: 'Task UUID', required: true }
    },
    outputs: {
      result: { type: 'object', description: 'Delete confirmation { id, deleted: true }' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      if (state.dbPath) getDb(state.dbPath);
      const validated = schema.parse(input);
      const deleted = variablesRepo.delete('tasks', validated.id);
      logger.info(`[TASK] Deleted task ${validated.id}: ${deleted}`);

      cb({
        output: {
          result: { id: validated.id, deleted },
          error: deleted ? null : `Task not found: ${validated.id}`
        },
        state
      });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
