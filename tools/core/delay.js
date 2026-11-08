import { z } from 'zod';

export const schema = z.object({
  milliseconds: z.number().nonnegative().optional(),
  ms: z.number().nonnegative().optional()
});

export const artifact = {
  id: 'tools/core/delay',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Delay Execution',
    description: 'Waits for specified milliseconds before continuing',
    tags: ['core', 'timing']
  },
  interface: {
    inputs: {
      milliseconds: { type: 'number', description: 'Number of milliseconds to wait', required: false },
      ms: { type: 'number', description: 'Alternative key for milliseconds', required: false }
    },
    outputs: {
      result: { type: 'number', description: 'The elapsed delay in milliseconds' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const waitMs = validated.milliseconds ?? validated.ms ?? 0;

      if (state.signal && state.signal.aborted) {
        return cb({ output: { result: 0, error: 'aborted' }, state });
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        if (state.signal) {
          state.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          }, { once: true });
        }
      });

      cb({ output: { result: waitMs, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
