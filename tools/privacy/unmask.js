import { z } from 'zod';

export function unmask(text, vault) {
  if (!text || typeof text !== 'string') return text || '';
  if (!vault) return text;

  let unmasked = text;

  if (vault instanceof Map) {
    for (const [placeholder, original] of vault.entries()) {
      unmasked = unmasked.replaceAll(placeholder, original);
    }
  } else if (typeof vault === 'object') {
    for (const [placeholder, original] of Object.entries(vault)) {
      unmasked = unmasked.replaceAll(placeholder, String(original));
    }
  }

  return unmasked;
}

export const schema = z.object({
  text: z.string(),
  vault: z.any()
});

export const artifact = {
  id: 'tools/privacy/unmask',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Unmask PII',
    description: 'Restores original sensitive values from in-process vault placeholders',
    tags: ['privacy', 'unmask']
  },
  interface: {
    inputs: {
      text: { type: 'string', description: 'Masked text containing {{PII_N}} placeholders', required: true },
      vault: { type: 'object', description: 'Placeholder mapping vault from mask step', required: true }
    },
    outputs: {
      result: { type: 'string', description: 'Restored original text' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const restored = unmask(validated.text, validated.vault);
      cb({ output: { result: restored, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
