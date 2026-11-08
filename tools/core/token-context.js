import { z } from 'zod';

export const contextItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  priority: z.number().default(0),
  tokens: z.number().int().optional()
});

export const schema = z.object({
  items: z.array(contextItemSchema),
  budget: z.number().int().positive()
});

export const artifact = {
  id: 'tools/core/token-context',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Token Context Manager',
    description: 'Priority-ranked greedy fill of candidate items up to token budget',
    tags: ['core', 'context', 'tokens']
  },
  interface: {
    inputs: {
      items: { type: 'array', description: 'Candidate items with priority and content', required: true },
      budget: { type: 'number', description: 'Maximum tokens allowed in context budget', required: true }
    },
    outputs: {
      selected: { type: 'array', description: 'Selected items that fit within budget' },
      dropped: { type: 'array', description: 'IDs of items dropped because budget was exhausted' },
      usedTokens: { type: 'number', description: 'Total tokens used by selected items' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const items = [...validated.items];
      const budget = validated.budget;

      // Sort by priority descending (higher priority first)
      items.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

      const selected = [];
      const dropped = [];
      let usedTokens = 0;

      for (const item of items) {
        const itemTokens = item.tokens !== undefined
          ? item.tokens
          : Math.max(1, Math.ceil(item.content.length / 4));

        if (usedTokens + itemTokens <= budget) {
          selected.push({
            id: item.id,
            content: item.content,
            tokens: itemTokens,
            priority: item.priority ?? 0
          });
          usedTokens += itemTokens;
        } else {
          dropped.push(item.id);
        }
      }

      cb({
        output: {
          selected,
          dropped,
          usedTokens,
          error: null
        },
        state
      });
    } catch (e) {
      cb({
        output: {
          selected: [],
          dropped: [],
          usedTokens: 0,
          error: e.message
        },
        state
      });
    }
  }
};

export default artifact;
