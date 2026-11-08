import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import logger from '../src/logger.js';
import { getSystemContext } from './dispatch.js';

export class WorkflowRegistry {
  constructor() {
    this.workflows = new Map(); // name -> workflow
    this.slashCommands = new Map(); // slashCommand -> workflowName
    this.watchers = [];
  }

  registerWorkflow(def, library = null, scheduler = null) {
    if (!def || !def.name) throw new Error('Workflow definition must have a name');

    const workflow = {
      name: def.name,
      version: def.version || '1.0.0',
      description: def.description || '',
      trigger: def.trigger || {},
      inputs: def.inputs || [],
      graph: def.graph || ''
    };

    this.workflows.set(def.name, workflow);

    // Register slash command trigger
    if (workflow.trigger.slash) {
      const slash = workflow.trigger.slash.startsWith('/') ? workflow.trigger.slash : `/${workflow.trigger.slash}`;
      this.slashCommands.set(slash, def.name);
      logger.debug(`Registered slash command [${slash}] -> workflow [${def.name}]`);
    }

    // Push graph to library as Graph artifact
    if (library && workflow.graph) {
      library.addArtifact({
        id: `workflows/${def.name}`,
        version: workflow.version,
        artifactType: 'graph',
        sourceType: 'text/x-ndl',
        source: workflow.graph,
        metadata: {
          name: def.name,
          description: workflow.description
        }
      });
    }

    // Bind webhook event to scheduler
    if (scheduler && workflow.trigger.webhook) {
      scheduler.on(workflow.trigger.webhook, `workflows/${def.name}`);
      logger.debug(`Bound webhook event [${workflow.trigger.webhook}] -> workflow [workflows/${def.name}]`);
    }

    return workflow;
  }

  loadDirs(dirs = ['./workflows/builtin', './workflows/user'], library = null, scheduler = null) {
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved)) continue;

      const files = fs.readdirSync(resolved);
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          try {
            const raw = fs.readFileSync(path.join(resolved, file), 'utf8');
            const parsed = yaml.parse(raw);
            if (parsed) {
              this.registerWorkflow(parsed, library, scheduler);
              logger.debug(`Loaded workflow [${parsed.name}] from ${file}`);
            }
          } catch (err) {
            logger.warn(`Failed to parse workflow file [${file}]: ${err.message}`);
          }
        }
      }
    }
  }

  loadInlineWorkflows(inlineWorkflows = [], library = null, scheduler = null) {
    for (const wf of inlineWorkflows) {
      this.registerWorkflow(wf, library, scheduler);
    }
  }

  validateInputs(workflow, rawInputs = {}) {
    const validated = {};
    const schemaInputs = workflow.inputs || [];

    for (const param of schemaInputs) {
      const val = rawInputs[param.name];

      if (val === undefined || val === null || val === '') {
        if (param.default !== undefined) {
          validated[param.name] = param.default;
        } else if (param.required) {
          return {
            valid: false,
            error: `Missing required workflow input: ${param.name}`,
            inputs: null
          };
        }
      } else {
        // Simple type coercion / validation
        if (param.type === 'number') {
          const num = Number(val);
          if (isNaN(num)) {
            return { valid: false, error: `Parameter '${param.name}' must be a number`, inputs: null };
          }
          validated[param.name] = num;
        } else if (param.type === 'boolean') {
          validated[param.name] = val === true || val === 'true';
        } else {
          validated[param.name] = String(val);
        }
      }
    }

    return { valid: true, error: null, inputs: validated };
  }

  get(name) {
    return this.workflows.get(name) || null;
  }

  list() {
    return Array.from(this.workflows.values());
  }

  resolveSlash(cmdName) {
    const normalized = cmdName.startsWith('/') ? cmdName : `/${cmdName}`;
    const workflowName = this.slashCommands.get(normalized);
    if (workflowName) {
      return this.workflows.get(workflowName) || null;
    }
    return null;
  }
}

export const workflowRegistry = new WorkflowRegistry();
export default workflowRegistry;
