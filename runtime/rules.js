import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { z } from 'zod';
import logger from '../src/logger.js';
import { resolveRefs } from '../engine/nodaic_minimal.js';

export const ruleSchema = z.object({
  name: z.string(),
  version: z.string().default('1.0.0'),
  hook: z.enum(['pre-plan', 'post-plan', 'pre-tool', 'post-tool', 'pre-output']),
  tool: z.string().default('*'),
  priority: z.number().default(50),
  action: z.enum(['block', 'warn', 'transform', 'require-confirm', 'emit-event']),
  condition: z.union([
    z.boolean(),
    z.object({
      field: z.string(),
      op: z.string(),
      value: z.any()
    })
  ]),
  message: z.string().optional(),
  transform: z.any().optional()
});

export class RulesEngine {
  constructor(options = {}) {
    this.rules = [];
    this.watchers = [];
    this.strict = options.strict ?? true;
  }

  registerRule(ruleDef) {
    const validated = ruleSchema.parse(ruleDef);
    // Remove duplicate by name if exists
    this.rules = this.rules.filter(r => r.name !== validated.name);
    this.rules.push(validated);
    this._sortRules();
    return validated;
  }

  _sortRules() {
    this.rules.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
  }

  loadRulesDir(dirPath, isBuiltin = false) {
    const resolvedDir = path.resolve(dirPath);
    if (!fs.existsSync(resolvedDir)) {
      return [];
    }

    const files = fs.readdirSync(resolvedDir);
    const loaded = [];

    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const fullPath = path.join(resolvedDir, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = yaml.parse(content);
          if (parsed) {
            const rule = this.registerRule(parsed);
            rule._isBuiltin = isBuiltin;
            rule._filePath = fullPath;
            loaded.push(rule);
            logger.debug(`Loaded rule [${rule.name}] from ${file}`);
          }
        } catch (err) {
          const errMsg = `Failed to parse rule file ${file}: ${err.message}`;
          if (this.strict) {
            logger.error(errMsg);
            throw new Error(errMsg);
          } else {
            logger.warn(errMsg);
          }
        }
      }
    }

    return loaded;
  }

  loadAllRules(config = {}) {
    const rulesConfig = config.rules || {};
    const dirs = rulesConfig.dirs || ['./rules/builtin', './rules/user'];
    this.strict = rulesConfig.strict ?? true;

    for (const dir of dirs) {
      const isBuiltin = dir.includes('builtin');
      this.loadRulesDir(dir, isBuiltin);
    }
  }

  watchUserRules(dirPath = './rules/user') {
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }

    const watcher = fs.watch(resolved, (eventType, filename) => {
      if (filename && (filename.endsWith('.yaml') || filename.endsWith('.yml'))) {
        logger.info(`User rule change detected: ${filename}, reloading...`);
        try {
          this.loadRulesDir(resolved, false);
        } catch (err) {
          logger.warn(`Failed to reload user rules: ${err.message}`);
        }
      }
    });

    this.watchers.push(watcher);
    return watcher;
  }

  close() {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }

  evaluateHook(hook, context = {}) {
    const { tool = '*', input = {}, output = {}, state = {}, config = {} } = context;
    const warnings = [];
    let currentInput = { ...input };
    let currentOutput = { ...output };
    let requireConfirm = false;

    // Filter rules for this hook and tool
    const candidateRules = this.rules.filter(r => {
      if (r.hook !== hook) return false;
      if (r.tool === '*' || tool === '*' || r.tool === tool) return true;
      const commaSeparated = r.tool.split(',').map(s => s.trim());
      return commaSeparated.includes(tool);
    });

    for (const rule of candidateRules) {
      const matches = this._evaluateCondition(rule.condition, {
        tool,
        input: currentInput,
        output: currentOutput,
        state,
        config
      });

      if (matches) {
        if (rule.action === 'block') {
          // First block wins and aborts
          const err = rule.message || `Blocked by rule [${rule.name}]`;
          logger.warn(`[RULE:BLOCK] ${rule.name}: ${err}`);
          return {
            blocked: true,
            rule: rule.name,
            error: err,
            action: 'block',
            warnings,
            input: currentInput,
            output: currentOutput,
            requireConfirm
          };
        }

        if (rule.action === 'warn') {
          const warnMsg = rule.message || `Warning from rule [${rule.name}]`;
          warnings.push(warnMsg);
          logger.warn(`[RULE:WARN] ${rule.name}: ${warnMsg}`);
        }

        if (rule.action === 'require-confirm') {
          requireConfirm = true;
          logger.info(`[RULE:CONFIRM] Rule [${rule.name}] requested confirmation`);
        }

        if (rule.action === 'transform' && rule.transform) {
          if (hook === 'pre-tool' || hook === 'pre-plan') {
            currentInput = { ...currentInput, ...rule.transform };
          } else {
            currentOutput = { ...currentOutput, ...rule.transform };
          }
        }
      }
    }

    return {
      blocked: false,
      rule: null,
      error: null,
      warnings,
      input: currentInput,
      output: currentOutput,
      requireConfirm
    };
  }

  _evaluateCondition(condition, context) {
    if (condition === true) return true;
    if (condition === false) return false;
    if (!condition || typeof condition !== 'object') return false;

    const { field, op, value } = condition;
    const fieldValue = this._getFieldValue(field, context);
    let expectedValue = value;

    // Resolve templates in expectedValue, e.g. {{config.runtime.workspaceDir}}
    if (typeof expectedValue === 'string' && expectedValue.includes('{{')) {
      expectedValue = resolveRefs(expectedValue, { config: context.config });
    }

    switch (op) {
      case 'not-starts-with': {
        if (fieldValue === undefined || fieldValue === null) return false;
        // Specially resolve file paths against workspace
        const targetPath = path.resolve(String(fieldValue));
        const basePath = path.resolve(String(expectedValue || './workspace'));
        const rel = path.relative(basePath, targetPath);
        const isInside = !rel.startsWith('..') && !path.isAbsolute(rel);
        if (targetPath === basePath) return false;
        return !isInside;
      }

      case 'starts-with': {
        if (fieldValue === undefined || fieldValue === null) return false;
        const strVal = String(fieldValue);
        return strVal.startsWith(String(expectedValue));
      }

      case 'contains': {
        if (fieldValue === undefined || fieldValue === null) return false;
        const strVal = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : String(fieldValue);
        return strVal.includes(String(expectedValue));
      }

      case 'not-contains': {
        if (fieldValue === undefined || fieldValue === null) return true;
        const strVal = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : String(fieldValue);
        return !strVal.includes(String(expectedValue));
      }

      case 'equals':
        return fieldValue === expectedValue;

      case 'not-equals':
        return fieldValue !== expectedValue;

      case 'greater-than':
        return Number(fieldValue || 0) > Number(expectedValue || 0);

      case 'regex': {
        if (!fieldValue) return false;
        const re = new RegExp(String(expectedValue));
        return re.test(String(fieldValue));
      }

      case 'shell-not-allowed': {
        const cmd = String(fieldValue || '').trim();
        if (!cmd) return true;
        const cmdName = cmd.split(/\s+/)[0];
        const sec = context.config.security || {};
        const allowlist = sec.shellAllowlist || [];
        const blocklist = sec.shellBlocklist || [];

        // Check blocklist first
        for (const blocked of blocklist) {
          if (cmd.includes(blocked) || cmdName === blocked) {
            return true; // Match blocklist = not allowed
          }
        }

        // Check allowlist
        if (allowlist.length > 0 && !allowlist.includes(cmdName)) {
          return true; // Not in allowlist = not allowed
        }
        return false;
      }

      case 'contains-pii': {
        if (!fieldValue) return false;
        const text = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : String(fieldValue);
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
        const apiKeyRegex = /(?:sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35})/;
        return emailRegex.test(text) || phoneRegex.test(text) || apiKeyRegex.test(text);
      }

      case 'scope-insufficient': {
        const callerScopes = context.state?.callerScopes;
        if (!callerScopes) return false;
        // If caller doesn't have required scopes for this tool
        return false;
      }

      default:
        return false;
    }
  }

  _getFieldValue(pathStr, context) {
    if (!pathStr) return undefined;
    const parts = pathStr.split('.');
    let curr = context;
    for (const p of parts) {
      if (curr === null || curr === undefined) return undefined;
      curr = curr[p];
    }
    return curr;
  }
}

export const rulesEngine = new RulesEngine();
export default rulesEngine;
