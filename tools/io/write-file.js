import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { validatePath } from '../../security/sandbox.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  path: z.string().min(1),
  content: z.string()
});

export const artifact = {
  id: 'tools/io/write-file',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Write File',
    description: 'Writes content to a file inside the sandboxed workspace directory',
    tags: ['io', 'file', 'write']
  },
  interface: {
    inputs: {
      path: { type: 'string', description: 'File path within workspace', required: true },
      content: { type: 'string', description: 'Text content to write', required: true }
    },
    outputs: {
      result: { type: 'object', description: 'Written file metadata' },
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

      const dir = path.dirname(check.resolvedPath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      await fs.promises.writeFile(check.resolvedPath, validated.content, 'utf8');
      logger.debug(`[TOOL:WRITE-FILE] Wrote ${validated.content.length} bytes to ${check.resolvedPath}`);

      cb({
        output: {
          result: {
            path: check.resolvedPath,
            bytesWritten: Buffer.byteLength(validated.content, 'utf8')
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
