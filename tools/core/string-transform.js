import { z } from 'zod';

export const schema = z.object({
  text: z.string(),
  operation: z.enum(['uppercase', 'lowercase', 'reverse', 'trim', 'length', 'replace']),
  find: z.string().optional(),
  replaceWith: z.string().optional()
});

export const artifact = {
  id: 'tools/core/string-transform',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'String Transform',
    description: 'Transforms string using various operations (uppercase, lowercase, reverse, trim, length, replace)',
    tags: ['core', 'string']
  },
  interface: {
    inputs: {
      text: { type: 'string', description: 'Input text to transform', required: true },
      operation: { type: 'string', description: 'Operation to perform', required: true },
      find: { type: 'string', description: 'Sub-string to find for replace operation', required: false },
      replaceWith: { type: 'string', description: 'Replacement string', required: false }
    },
    outputs: {
      result: { type: 'any', description: 'Transformed string or length count' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      let res;

      switch (validated.operation) {
        case 'uppercase':
          res = validated.text.toUpperCase();
          break;
        case 'lowercase':
          res = validated.text.toLowerCase();
          break;
        case 'reverse':
          res = validated.text.split('').reverse().join('');
          break;
        case 'trim':
          res = validated.text.trim();
          break;
        case 'length':
          res = validated.text.length;
          break;
        case 'replace':
          if (!validated.find) throw new Error("Missing 'find' parameter for replace operation");
          res = validated.text.replaceAll(validated.find, validated.replaceWith || '');
          break;
        default:
          throw new Error(`Unknown operation: ${validated.operation}`);
      }

      cb({ output: { result: res, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
