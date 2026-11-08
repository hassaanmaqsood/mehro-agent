import { z } from 'zod';
import { AgentRunner } from './agent-runner.js';
import { getSystemContext } from '../../runtime/dispatch.js';
import { agentRegistry } from '../../runtime/agents.js';
import logger from '../../src/logger.js';

export const schema = z.object({
  agent: z.string().min(1),
  prompt: z.string().min(1),
  context: z.record(z.string(), z.any()).optional().default({})
});

export const artifact = {
  id: 'tools/agent/spawn-agent',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: {
    name: 'Spawn Agent',
    description: 'Spawns an independent specialist agent with isolated context and custom rules',
    tags: ['agent', 'spawn']
  },
  interface: {
    inputs: {
      agent: { type: 'string', description: 'Name of the agent definition to spawn', required: true },
      prompt: { type: 'string', description: 'Task prompt for the agent', required: true },
      context: { type: 'object', description: 'Contextual payload for agent execution', required: false }
    },
    outputs: {
      result: { type: 'object', description: 'Output returned by spawned agent' },
      error: { type: 'string', description: 'Error message if any' }
    }
  },
  schema,
  source: async (input, state, cb) => {
    try {
      const validated = schema.parse(input);
      const def = (state.agentRegistry && state.agentRegistry[validated.agent])
        || getSystemContext().agentRegistry?.[validated.agent]
        || agentRegistry.get(validated.agent);

      if (!def) {
        return cb({ output: { result: null, error: `Unknown agent: ${validated.agent}` }, state });
      }

      const { library, config } = getSystemContext();
      const currentDepth = (state.depth || 0) + 1;
      const maxAgentDepth = state.maxAgentDepth || config?.agents?.maxDepth || 3;

      if (currentDepth > maxAgentDepth) {
        return cb({ output: { result: null, error: 'max_agent_depth_exceeded' }, state });
      }

      const runner = new AgentRunner(def, {
        depth: currentDepth,
        maxDepth: maxAgentDepth,
        approvalMode: def.approvalMode ?? state.parentApprovalMode,
        parentRules: state.parentRules || [],
        parentLibrary: library
      });

      const result = await runner.run(validated.prompt, validated.context);
      if (result.error && !result.output) {
        return cb({ output: { result: null, error: result.error }, state });
      }

      cb({ output: { result: result.output, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};

export default artifact;
