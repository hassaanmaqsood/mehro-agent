import logger from '../../src/logger.js';
import { RulesEngine } from '../../runtime/rules.js';
import { plan } from '../../planner/planner.js';
import { createNodaicSystem } from '../../engine/nodaic_minimal.js';
import { WorkflowScheduler } from '../../engine/nodaic_scheduler.js';

export class AgentRunner {
  constructor(def, options = {}) {
    this.def = def;
    this.options = options;
    this.depth = options.depth || 1;
    this.maxDepth = options.maxDepth || def.maxDepth || 3;
    this.approvalMode = def.approvalMode ?? options.approvalMode ?? 'auto';

    // 1. Isolated Ephemeral Store & Nodaic System
    const { library } = createNodaicSystem();
    this.library = library;
    this.scheduler = new WorkflowScheduler(library);

    // 2. Rules engine: child rules + inherited parent rules
    this.rulesEngine = new RulesEngine({ strict: false });

    // Inherit parent rules (parent builtin rules always apply)
    const inheritedRules = options.parentRules || [];
    for (const r of inheritedRules) {
      this.rulesEngine.registerRule(r);
    }

    // Register agent's own rules
    const agentRules = def.rules || [];
    for (const r of agentRules) {
      this.rulesEngine.registerRule(r);
    }
  }

  async run(prompt, context = {}) {
    // Check max agent depth
    if (this.depth > this.maxDepth) {
      logger.warn(`[AGENT-RUNNER] Agent '${this.def.name}' exceeded max depth (${this.depth} > ${this.maxDepth})`);
      return {
        output: null,
        error: 'max_agent_depth_exceeded'
      };
    }

    logger.info(`[AGENT-RUNNER] Running agent '${this.def.name}' (depth: ${this.depth})`);

    // Copy allowed tools from parent library into isolated child library
    const parentLibrary = this.options.parentLibrary;
    if (parentLibrary) {
      const allowedTools = this.def.tools?.allow || [];
      const disabledTools = this.def.tools?.disabled || [];

      for (const art of parentLibrary.list()) {
        const toolName = art.id.replace(/^tools\//, '').replace(/^core\//, '');
        if (allowedTools.length > 0 && !allowedTools.includes(art.id) && !allowedTools.includes(toolName)) {
          continue;
        }
        if (disabledTools.includes(art.id) || disabledTools.includes(toolName)) {
          continue;
        }
        const fullArt = parentLibrary.getArtifact(art.id, art.version);
        if (fullArt) {
          this.library.addArtifact(fullArt);
        }
      }
    }

    // Planner with agent-specific system prompt and model configuration
    const modelConfig = this.def.model || { provider: 'ollama', model: 'tinyllama:1.1b' };
    const promptFiles = {
      systemRole: this.def.system || '',
      rules: this.def.rulesProse || '',
      context: JSON.stringify(context)
    };

    const { graphArtifact, thoughtProcess } = await plan(prompt, {
      modelConfig,
      toolsManifest: this.library.list(),
      promptFiles,
      budget: modelConfig.contextBudget || 8000
    });

    this.library.addArtifact(graphArtifact);

    const rawOutput = await this.scheduler.run(graphArtifact.id, context, {
      depth: this.depth,
      approvalMode: this.approvalMode
    });

    // Parent post-tool / pre-output rules check on child agent output
    const preOutputCheck = this.rulesEngine.evaluateHook('pre-output', {
      tool: this.def.name,
      output: rawOutput,
      state: { depth: this.depth }
    });

    if (preOutputCheck.blocked) {
      return {
        output: null,
        error: preOutputCheck.error || 'Blocked by parent post-tool rule'
      };
    }

    return {
      output: preOutputCheck.output || rawOutput,
      thoughtProcess,
      agent: this.def.name,
      depth: this.depth,
      turns: 1,
      error: null
    };
  }
}

export default AgentRunner;
