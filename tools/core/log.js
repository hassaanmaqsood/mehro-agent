import { z } from 'zod';
import logger from '../../src/logger.js';

export const schema = z.object({
  message: z.string()
});

export const artifact = {
  id: 'tools/core/log',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Log Message',
    description: 'Logs a message to the runtime logger system and returns it',
    tags: ['core', 'logging']
  },
  interface: {
    inputs: {
      message: { type: 'string', description: 'Message to log', required: true }
    },
    outputs: {
      result: { type: 'string', description: 'The logged message' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      logger.info(`[TOOL:LOG] ${validated.message}`);
      cb({ output: { result: validated.message, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
