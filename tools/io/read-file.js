import fs from 'fs';
import { z } from 'zod';
import { validatePath } from '../../security/sandbox.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  path: z.string().min(1),
  encoding: z.string().default('utf8')
});

export const artifact = {
  id: 'tools/io/read-file',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Read File',
    description: 'Reads contents of a file inside workspace directory',
    tags: ['io', 'file', 'read']
  },
  interface: {
    inputs: {
      path: { type: 'string', description: 'Relative path within workspace', required: true },
      encoding: { type: 'string', description: 'File encoding (default utf8)', required: false }
    },
    outputs: {
      result: { type: 'string', description: 'File text content' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const workspaceDir = state.workspaceDir || './workspace';

      const check = validatePath(validated.path, workspaceDir);
      if (!check.valid) {
        return cb({ output: { result: null, error: check.error || 'path_violation' }, state });
      }

      const content = await fs.promises.readFile(check.resolvedPath, validated.encoding || 'utf8');
      logger.debug(`[TOOL:READ-FILE] Read ${check.resolvedPath}`);
      cb({ output: { result: content, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
