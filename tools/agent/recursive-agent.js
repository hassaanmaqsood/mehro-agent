import { z } from 'zod';
import { plan } from '../../planner/planner.js';
import { getSystemContext } from '../../runtime/dispatch.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  prompt: z.string().min(1),
  context: z.record(z.string(), z.any()).optional().default({})
});

export const artifact = {
  id: 'tools/agent/recursive-agent',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Recursive Agent',
    description: 'Decomposes complex subtasks recursively bounded by maximum depth limit',
    tags: ['agent', 'recursive']
  },
  interface: {
    inputs: {
      prompt: { type: 'string', description: 'Subtask instruction or prompt', required: true },
      context: { type: 'object', description: 'Context passed to subtask', required: false }
    },
    outputs: {
      result: { type: 'any', description: 'Result of recursive agent execution' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const currentDepth = (state.depth || 0) + 1;
      const maxDepth = state.maxDepth || state.config?.recursiveAgent?.maxDepth || 3;

      if (currentDepth > maxDepth) {
        logger.warn(`[RECURSIVE-AGENT] Depth ${currentDepth} exceeded maxDepth ${maxDepth}`);
        return cb({ output: { result: null, error: 'max_depth_exceeded' }, state });
      }

      logger.info(`[RECURSIVE-AGENT] Running sub-agent at depth ${currentDepth}/${maxDepth}`);
      const { library, scheduler, config } = getSystemContext();

      if (!library || !scheduler) {
        return cb({ output: { result: null, error: 'Runtime not initialized' }, state });
      }

      const { graphArtifact } = await plan(validated.prompt, {
        modelConfig: config?.model,
        toolsManifest: library.list(),
        budget: config?.model?.contextBudget || 8000
      });

      library.addArtifact(graphArtifact);
      const subResult = await scheduler.run(graphArtifact.id, validated.context, {
        ...state,
        depth: currentDepth
      });

      cb({ output: { result: subResult, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
