import { z } from 'zod';
import { variablesRepo, getDb } from '../../runtime/store.js';

export const schema = z.object({
  status: z.string().optional(),
  limit: z.number().int().positive().default(50)
});

export const artifact = {
  id: 'tools/tasks/task-list',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'List Tasks',
    description: 'Lists persistent tasks from SQLite tasks namespace',
    tags: ['tasks', 'list']
  },
  interface: {
    inputs: {
      status: { type: 'string', description: 'Filter by task status', required: false },
      limit: { type: 'number', description: 'Maximum tasks to return', required: false }
    },
    outputs: {
      result: { type: 'object', description: 'List of tasks and count' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      if (state.dbPath) getDb(state.dbPath);
      const validated = schema.parse(input);
      const rows = variablesRepo.list('tasks');

      let tasks = rows.map(r => {
        const item = variablesRepo.get('tasks', r.key);
        return item?.value;
      }).filter(Boolean);

      if (validated.status) {
        tasks = tasks.filter(t => t.status === validated.status);
      }

      tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const limited = tasks.slice(0, validated.limit);

      cb({
        output: {
          result: {
            tasks: limited,
            total: tasks.length
          },
          error: null
        },
        state
      });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
