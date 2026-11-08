import logger from '../src/logger.js';
import { workflowRegistry } from './workflows.js';
import { getSystemContext } from './dispatch.js';
import { plan } from '../planner/planner.js';
import { variablesRepo, workflowRunsRepo } from './store.js';
import { skillsRegistry } from './skills.js';
import { executePipeline } from './pipeline.js';
import crypto from 'crypto';

export async function resolveCommand(commandLine, sessionContext = {}) {
  const trimmed = (commandLine || '').trim();
  if (!trimmed.startsWith('/')) {
    // Execute natural language prompt through the critical execution pipeline
    const pipelineResult = await executePipeline(trimmed, sessionContext);
    return { isSlash: false, prompt: trimmed, ...pipelineResult };
  }

  const parts = trimmed.split(/\s+/);
  const slash = parts[0].toLowerCase();
  const rest = trimmed.slice(parts[0].length).trim();

  // 1. Check workflow slash commands FIRST
  const workflow = workflowRegistry.resolveSlash(slash);
  if (workflow) {
    // Parse arguments: positional or key=value
    const rawInputs = {};
    const schemaInputs = workflow.inputs || [];

    if (rest) {
      if (rest.includes('=')) {
        // key=val pairs
        const pairs = rest.split(/\s+/);
        for (const pair of pairs) {
          const [k, v] = pair.split('=');
          if (k && v !== undefined) rawInputs[k.trim()] = v.trim();
        }
      } else if (schemaInputs.length > 0) {
        // Single positional argument assigned to first input parameter
        rawInputs[schemaInputs[0].name] = rest;
      }
    }

    // Validate inputs against workflow schema
    const validation = workflowRegistry.validateInputs(workflow, rawInputs);
    if (!validation.valid) {
      return {
        isSlash: true,
        command: slash,
        type: 'workflow',
        success: false,
        error: validation.error
      };
    }

    const { scheduler } = getSystemContext();
    if (!scheduler) {
      return {
        isSlash: true,
        command: slash,
        type: 'workflow',
        success: false,
        error: 'Scheduler not initialized'
      };
    }

    try {
      const output = await scheduler.run(`workflows/${workflow.name}`, validation.inputs);
      return {
        isSlash: true,
        command: slash,
        type: 'workflow',
        workflow: workflow.name,
        inputs: validation.inputs,
        success: true,
        output
      };
    } catch (err) {
      return {
        isSlash: true,
        command: slash,
        type: 'workflow',
        workflow: workflow.name,
        success: false,
        error: err.message
      };
    }
  }

  // 2. Built-in slash commands
  switch (slash) {
    case '/run': {
      if (!rest) return { isSlash: true, command: slash, success: false, error: 'Usage: /run <prompt>' };
      const pipelineResult = await executePipeline(rest, sessionContext);
      return {
        isSlash: true,
        command: slash,
        ...pipelineResult
      };
    }

    case '/task': {
      if (!rest) return { isSlash: true, command: slash, success: false, error: 'Usage: /task <prompt>' };
      const taskId = crypto.randomUUID();
      const taskRecord = {
        id: taskId,
        prompt: rest,
        status: 'pending',
        priority: 1,
        createdAt: new Date().toISOString()
      };
      variablesRepo.set('tasks', taskId, taskRecord, 'state');
      return {
        isSlash: true,
        command: slash,
        success: true,
        task: taskRecord
      };
    }

    case '/skill': {
      if (!rest) {
        const available = Array.from(skillsRegistry.skills.keys());
        return { isSlash: true, command: slash, success: true, skills: available };
      }
      const skillName = rest.trim();
      const exists = skillsRegistry.skills.has(skillName);
      if (!exists) {
        return { isSlash: true, command: slash, success: false, error: `Skill not found: ${skillName}` };
      }
      if (!sessionContext.activeSkills) sessionContext.activeSkills = [];
      if (!sessionContext.activeSkills.includes(skillName)) {
        sessionContext.activeSkills.push(skillName);
      }
      return { isSlash: true, command: slash, success: true, activated: skillName };
    }

    case '/tools': {
      const { library } = getSystemContext();
      const tools = library ? library.list() : [];
      return {
        isSlash: true,
        command: slash,
        success: true,
        tools: tools.map(t => ({ id: t.id, description: t.metadata?.description }))
      };
    }

    case '/history': {
      const runs = workflowRunsRepo.list(20);
      return {
        isSlash: true,
        command: slash,
        success: true,
        history: runs
      };
    }

    case '/clear': {
      sessionContext.activeSkills = [];
      sessionContext.messages = [];
      return {
        isSlash: true,
        command: slash,
        success: true,
        message: 'Session context cleared'
      };
    }

    case '/approval': {
      const validModes = ['review', 'auto', 'allow-all'];
      if (!rest || !validModes.includes(rest.trim())) {
        return {
          isSlash: true,
          command: slash,
          success: false,
          error: `Usage: /approval [review|auto|allow-all]`
        };
      }
      sessionContext.sessionApprovalMode = rest.trim();
      return {
        isSlash: true,
        command: slash,
        success: true,
        approvalMode: rest.trim()
      };
    }

    default:
      return {
        isSlash: true,
        command: slash,
        success: false,
        error: `Unknown command '${slash}'. Available: /run, /task, /skill, /tools, /history, /clear, /approval`
      };
  }
}

export default {
  resolveCommand
};
