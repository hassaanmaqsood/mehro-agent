import { exec } from 'child_process';
import { z } from 'zod';
import { isCommandAllowed } from '../../security/allowlist.js';
import { verifyConfirmationToken } from '../../security/confirm.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeout: z.number().int().positive().default(30000)
});

export const artifact = {
  id: 'tools/io/shell',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Shell Command Executor',
    description: 'Executes allowed shell commands under explicit confirmation token gate',
    tags: ['io', 'shell', 'exec']
  },
  interface: {
    inputs: {
      command: { type: 'string', description: 'The shell command line to run', required: true },
      cwd: { type: 'string', description: 'Working directory (defaults to workspace)', required: false },
      timeout: { type: 'number', description: 'Execution timeout in ms', required: false }
    },
    outputs: {
      result: { type: 'string', description: 'Command standard output' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const allowlist = state.shellAllowlist || ['git', 'npm', 'node', 'ls', 'echo', 'cat', 'pwd'];
      const blocklist = state.shellBlocklist || ['rm -rf', 'mkfs', 'shutdown', 'reboot'];

      // 1. Allowlist & Blocklist gate
      const check = isCommandAllowed(validated.command, allowlist, blocklist);
      if (!check.allowed) {
        return cb({ output: { result: null, error: check.reason || 'command_blocked' }, state });
      }

      // 2. Confirmation Token gate
      const token = state.confirmationToken;
      const verify = verifyConfirmationToken(token, 'shell');
      if (!verify.valid) {
        return cb({ output: { result: null, error: 'confirmation_required' }, state });
      }

      // 3. Execution
      const workspaceDir = state.workspaceDir || './workspace';
      const execCwd = validated.cwd || workspaceDir;

      exec(
        validated.command,
        {
          cwd: execCwd,
          timeout: validated.timeout || 30000,
          maxBuffer: 1024 * 1024 * 5 // 5MB limit
        },
        (err, stdout, stderr) => {
          if (err) {
            logger.warn(`[TOOL:SHELL] Command failed: ${err.message}`);
            return cb({
              output: {
                result: stdout || stderr || null,
                error: err.message
              },
              state
            });
          }

          logger.debug(`[TOOL:SHELL] Command succeeded: ${validated.command}`);
          cb({
            output: {
              result: (stdout || stderr || '').trim(),
              error: null
            },
            state
          });
        }
      );
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
