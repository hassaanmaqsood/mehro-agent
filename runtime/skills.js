import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import logger from '../src/logger.js';

export class SkillsRegistry {
  constructor() {
    this.skills = new Map(); // name -> skill
    this.watchers = [];
  }

  loadSkillFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parseSkillContent(content, filePath);
      if (parsed) {
        this.skills.set(parsed.name, parsed);
        logger.debug(`Loaded skill: ${parsed.name} from ${filePath}`);
        return parsed;
      }
    } catch (err) {
      logger.warn(`Malformed skill file [${filePath}]: ${err.message}. Skipping gracefully.`);
    }
    return null;
  }

  loadDirs(dirs = ['./skills/builtin', './skills/user']) {
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved)) continue;

      const files = fs.readdirSync(resolved);
      for (const file of files) {
        if (file.endsWith('.md')) {
          this.loadSkillFile(path.join(resolved, file));
        }
      }
    }
  }

  matchSkills(prompt = '', explicitList = [], maxActive = 3) {
    const active = [];
    const promptLower = prompt.toLowerCase();
    const explicitSet = new Set(explicitList);

    // 1. Check for /skill:<name> or /skill <name> in prompt
    const skillCommandMatches = prompt.matchAll(/\/skill[:\s]([a-zA-Z0-9_-]+)/g);
    for (const match of skillCommandMatches) {
      explicitSet.add(match[1]);
    }

    // 2. Add explicitly activated skills first
    for (const name of explicitSet) {
      const skill = this.skills.get(name);
      if (skill && !active.some(s => s.name === skill.name)) {
        active.push(skill);
      }
    }

    // 3. Keyword trigger matching
    for (const skill of this.skills.values()) {
      if (active.some(s => s.name === skill.name)) continue;
      if (active.length >= maxActive) break;

      const triggers = skill.triggers || [];
      const matched = triggers.some(trig => promptLower.includes(trig.toLowerCase()));
      if (matched) {
        active.push(skill);
      }
    }

    return active.slice(0, maxActive);
  }

  watchDirs(dirs = ['./skills/builtin', './skills/user']) {
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved)) continue;

      const watcher = fs.watch(resolved, (eventType, filename) => {
        if (filename && filename.endsWith('.md')) {
          logger.info(`Skill file change detected: ${filename}`);
          this.loadSkillFile(path.join(resolved, filename));
        }
      });
      this.watchers.push(watcher);
    }
  }

  close() {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }
}

export function parseSkillContent(rawContent, filePath = '') {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Missing YAML frontmatter delineated by --- fences');
  }

  const frontmatterStr = match[1];
  const body = match[2].trim();

  const frontmatter = yaml.parse(frontmatterStr);
  if (!frontmatter || !frontmatter.name) {
    throw new Error('Frontmatter missing required "name" field');
  }

  return {
    name: frontmatter.name,
    version: frontmatter.version || '1.0.0',
    triggers: Array.isArray(frontmatter.triggers) ? frontmatter.triggers : [],
    tools: Array.isArray(frontmatter.tools) ? frontmatter.tools : [],
    scope: frontmatter.scope || 'planner',
    body,
    content: body,
    filePath
  };
}

export const skillsRegistry = new SkillsRegistry();
export default skillsRegistry;
