import { z } from 'zod';
import logger from '../../src/logger.js';

export const schema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.union([z.string(), z.record(z.string(), z.any()), z.array(z.any())]).optional(),
  timeout: z.number().int().positive().default(30000)
});

export const artifact = {
  id: 'tools/network/http-request',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'HTTP Request',
    description: 'Performs HTTP requests with full method, header, body support and cancellation',
    tags: ['network', 'http']
  },
  interface: {
    inputs: {
      url: { type: 'string', description: 'URL to request', required: true },
      method: { type: 'string', description: 'HTTP method (GET, POST, etc.)', required: false },
      headers: { type: 'object', description: 'HTTP headers', required: false },
      body: { type: 'any', description: 'Request payload', required: false },
      timeout: { type: 'number', description: 'Request timeout in ms', required: false }
    },
    outputs: {
      result: { type: 'object', description: 'Response { status, statusText, headers, data }' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const headers = { ...validated.headers };

      let body = undefined;
      if (validated.body !== undefined && validated.method !== 'GET' && validated.method !== 'HEAD') {
        if (typeof validated.body === 'object') {
          body = JSON.stringify(validated.body);
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
        } else {
          body = String(validated.body);
        }
      }

      const controller = new AbortController();
      let combinedSignal = controller.signal;

      if (state.signal) {
        if (state.signal.aborted) {
          return cb({ output: { result: null, error: 'aborted' }, state });
        }
        state.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const timeoutId = setTimeout(() => controller.abort(), validated.timeout || 30000);

      try {
        const res = await fetch(validated.url, {
          method: validated.method,
          headers,
          body,
          signal: combinedSignal
        });

        clearTimeout(timeoutId);

        const contentType = res.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          try {
            data = await res.json();
          } catch {
            data = await res.text();
          }
        } else {
          data = await res.text();
        }

        const responseHeaders = {};
        res.headers.forEach((v, k) => {
          responseHeaders[k] = v;
        });

        logger.debug(`[TOOL:HTTP-REQUEST] ${validated.method} ${validated.url} -> ${res.status}`);

        cb({
          output: {
            result: {
              status: res.status,
              statusText: res.statusText,
              headers: responseHeaders,
              data
            },
            error: res.ok ? null : `HTTP Error ${res.status}: ${res.statusText}`
          },
          state
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        cb({
          output: {
            result: null,
            error: fetchErr.name === 'AbortError' ? 'aborted' : fetchErr.message
          },
          state
        });
      }
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
