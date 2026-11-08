import { z } from 'zod';
import { evaluate } from 'mathjs';
import logger from '../../src/logger.js';

export const schema = z.object({
  expression: z.string().min(1)
});

export const artifact = {
  id: 'tools/core/calculate',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Calculate Math Expression',
    description: 'Safely evaluates a mathematical expression using mathjs',
    tags: ['core', 'math']
  },
  interface: {
    inputs: {
      expression: { type: 'string', description: 'Mathematical expression to evaluate', required: true }
    },
    outputs: {
      result: { type: 'number', description: 'The computed result' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const res = evaluate(validated.expression);
      logger.debug(`[TOOL:CALCULATE] ${validated.expression} = ${res}`);
      cb({ output: { result: res, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
