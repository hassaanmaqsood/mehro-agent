import { z } from 'zod';

export const DEFAULT_PII_PATTERNS = [
  // Email addresses
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  // Phone numbers (US & international formats)
  { name: 'phone', regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  // API keys / tokens
  { name: 'api_key', regex: /(?:sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|ghp_[a-zA-Z0-9]{36})/g }
];

export function mask(text, customPatterns = []) {
  if (!text || typeof text !== 'string') {
    return { masked: text || '', vault: new Map() };
  }

  const vault = new Map();
  let counter = 0;
  let masked = text;

  // Combine default patterns with custom regex patterns
  const allPatterns = [...DEFAULT_PII_PATTERNS];
  for (const p of customPatterns) {
    if (p.regex) {
      allPatterns.push({
        name: p.name || 'custom',
        regex: typeof p.regex === 'string' ? new RegExp(p.regex, 'g') : p.regex
      });
    }
  }

  for (const { regex } of allPatterns) {
    // Reset regex index if global
    regex.lastIndex = 0;
    masked = masked.replaceAll(regex, (matched) => {
      // If already in vault, reuse placeholder
      for (const [placeholder, orig] of vault.entries()) {
        if (orig === matched) {
          return placeholder;
        }
      }
      const placeholder = `{{PII_${counter++}}}`;
      vault.set(placeholder, matched);
      return placeholder;
    });
  }

  return { masked, vault };
}

export const schema = z.object({
  text: z.string(),
  patterns: z.array(z.object({ name: z.string(), regex: z.string() })).optional()
});

export const artifact = {
  id: 'tools/privacy/mask',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Mask PII',
    description: 'Replaces personally identifiable information with reversible {{PII_N}} placeholders',
    tags: ['privacy', 'mask']
  },
  interface: {
    inputs: {
      text: { type: 'string', description: 'Raw text containing sensitive PII', required: true },
      patterns: { type: 'array', description: 'Additional custom regex patterns', required: false }
    },
    outputs: {
      result: { type: 'object', description: '{ masked, vault }' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const custom = (validated.patterns || []).concat(state.privacyPatterns || []);
      const { masked: maskedText, vault } = mask(validated.text, custom);

      cb({
        output: {
          result: {
            masked: maskedText,
            vault: Object.fromEntries(vault)
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
