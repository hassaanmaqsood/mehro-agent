import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import logger from '../src/logger.js';

export function parseAgentFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');

    // Case 1: YAML file
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      const parsed = yaml.parse(raw);
      if (parsed && parsed.name) {
        return parsed;
      }
      return null;
    }

    // Case 2: Markdown file with YAML frontmatter
    if (filePath.endsWith('.md')) {
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (fmMatch) {
        const frontmatter = yaml.parse(fmMatch[1]) || {};
        const systemBody = fmMatch[2].trim();
        return {
          ...frontmatter,
          system: systemBody || frontmatter.system || ''
        };
      }
    }
  } catch (err) {
    logger.warn(`Failed to parse agent file [${filePath}]: ${err.message}`);
  }

  return null;
}

export class AgentRegistry {
  constructor() {
    this.agents = new Map(); // name -> agentDef
  }

  registerAgent(def) {
    if (!def || !def.name) {
      throw new Error('Agent definition must have a name');
    }
    this.agents.set(def.name, def);
    logger.debug(`Registered agent: ${def.name}`);
    return def;
  }

  get(name) {
    return this.agents.get(name) || null;
  }

  list() {
    return Array.from(this.agents.values());
  }

  loadDirs(dirs = ['./agents/builtin', './agents/user']) {
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved)) continue;

      const files = fs.readdirSync(resolved);
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.md')) {
          const parsed = parseAgentFile(path.join(resolved, file));
          if (parsed && parsed.name) {
            this.registerAgent(parsed);
          }
        }
      }
    }
  }
}

export const agentRegistry = new AgentRegistry();
export default agentRegistry;
