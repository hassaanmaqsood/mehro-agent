import { z } from 'zod';
import logger from '../../src/logger.js';

export const schema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().default(5)
});

export const artifact = {
  id: 'tools/network/web-search',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Web Search',
    description: 'Searches the web and returns ranked snippets and source URLs',
    tags: ['network', 'search']
  },
  interface: {
    inputs: {
      query: { type: 'string', description: 'Search query string', required: true },
      limit: { type: 'number', description: 'Max number of results', required: false }
    },
    outputs: {
      result: { type: 'object', description: 'Search results list and metadata' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      logger.info(`[TOOL:WEB-SEARCH] Searching for: ${validated.query}`);

      // Built-in lightweight query handler or external endpoint if configured
      const searchUrl = state.searchApiUrl || process.env.SEARCH_API_URL;
      if (searchUrl) {
        const res = await fetch(`${searchUrl}?q=${encodeURIComponent(validated.query)}&limit=${validated.limit}`, {
          signal: state.signal
        });
        const data = await res.json();
        return cb({ output: { result: data, error: null }, state });
      }

      // Default mock search response for local development
      const sampleResults = [
        {
          title: `Result 1 for "${validated.query}"`,
          url: `https://example.com/search?q=${encodeURIComponent(validated.query)}&item=1`,
          snippet: `This is a comprehensive summary of primary data concerning ${validated.query}.`
        },
        {
          title: `Documentation and guides: ${validated.query}`,
          url: `https://docs.example.org/${encodeURIComponent(validated.query)}`,
          snippet: `Detailed API references and architectural specifications related to ${validated.query}.`
        }
      ].slice(0, validated.limit);

      cb({
        output: {
          result: {
            query: validated.query,
            total: sampleResults.length,
            results: sampleResults
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
