import { z } from 'zod';
import { executeSQLiteQuery } from './query-adapter/sqlite.js';
import { executeElasticsearchQuery } from './query-adapter/elasticsearch.js';
import { executePostgresQuery } from './query-adapter/postgres.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  backend: z.enum(['sqlite', 'elasticsearch', 'postgres']).default('sqlite'),
  operation: z.enum(['search', 'get', 'insert', 'update', 'delete']).default('search'),
  index: z.string().min(1),
  filter: z.any().optional().default({}),
  fields: z.array(z.string()).optional().default([]),
  limit: z.number().int().positive().default(50),
  data: z.any().optional()
});

export const artifact = {
  id: 'tools/data/query',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Data Query',
    description: 'Executes structured queries across SQLite, Elasticsearch, and Postgres backends',
    tags: ['data', 'query', 'database']
  },
  interface: {
    inputs: {
      backend: { type: 'string', description: 'Database backend (sqlite | elasticsearch | postgres)', required: false },
      operation: { type: 'string', description: 'Operation: search | get | insert | update | delete', required: false },
      index: { type: 'string', description: 'Table name or search index', required: true },
      filter: { type: 'object', description: 'Structured query filter { field, op, value }', required: false },
      fields: { type: 'array', description: 'Projected columns or fields', required: false },
      limit: { type: 'number', description: 'Maximum rows/documents to return', required: false },
      data: { type: 'object', description: 'Row data for insert/update operations', required: false }
    },
    outputs: {
      result: { type: 'object', description: 'Query results { rows, total }' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const backend = validated.backend || state.defaultBackend || 'sqlite';

      logger.debug(`[TOOL:QUERY] Running ${validated.operation} on ${backend}:${validated.index}`);

      let queryResult;
      switch (backend) {
        case 'sqlite':
          queryResult = await executeSQLiteQuery(validated, state);
          break;
        case 'elasticsearch':
          queryResult = await executeElasticsearchQuery(validated, state);
          break;
        case 'postgres':
          queryResult = await executePostgresQuery(validated, state);
          break;
        default:
          throw new Error(`Unknown query backend: ${backend}`);
      }

      cb({
        output: {
          result: {
            rows: queryResult.rows || [],
            total: queryResult.total ?? (queryResult.rows ? queryResult.rows.length : 0),
            meta: queryResult.sql || null
          },
          error: queryResult.error || null
        },
        state
      });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
