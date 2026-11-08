import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import logger from '../src/logger.js';

const mtimeCache = new Map(); // filePath -> { mtimeMs, data }

export function parsePromptFileContent(rawText) {
  let frontmatter = {};
  let body = rawText;

  const fmMatch = rawText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fmMatch) {
    try {
      frontmatter = yaml.parse(fmMatch[1]) || {};
      body = fmMatch[2];
    } catch (e) {
      logger.warn(`Failed to parse frontmatter in prompt file: ${e.message}`);
    }
  }

  // Parse sections: ## System Role, ## Rules, ## Context
  const sections = {};
  const sectionChunks = body.split(/^##\s+/m);
  for (const chunk of sectionChunks) {
    if (!chunk.trim()) continue;
    const newlineIdx = chunk.indexOf('\n');
    if (newlineIdx !== -1) {
      const title = chunk.slice(0, newlineIdx).trim();
      const content = chunk.slice(newlineIdx + 1).trim();
      sections[title] = content;
    } else {
      sections[chunk.trim()] = '';
    }
  }

  return {
    frontmatter,
    sections,
    body: body.trim()
  };
}

export function loadSinglePromptFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const stat = fs.statSync(filePath);
    const cached = mtimeCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.data;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = parsePromptFileContent(raw);
    mtimeCache.set(filePath, { mtimeMs: stat.mtimeMs, data: parsed });
    return parsed;
  } catch (err) {
    logger.warn(`Error reading prompt file ${filePath}: ${err.message}`);
    return null;
  }
}

export async function loadPromptFiles(rootDir = process.cwd(), globalDir = path.join(os.homedir(), '.mehro')) {
  const layers = [
    { name: 'Layer 1 (Global)', dir: globalDir },
    { name: 'Layer 2 (Project)', dir: path.resolve(rootDir) },
    { name: 'Layer 3 (Workspace)', dir: path.resolve(rootDir, 'workspace') }
  ];

  const merged = {
    systemRole: '',
    context: '',
    rules: '',
    frontmatter: {},
    frontmatterRules: [],
    frontmatterWorkflows: [],
    activeSkills: [],
    disabledTools: []
  };

  for (const layer of layers) {
    if (!fs.existsSync(layer.dir)) continue;

    // Check MEHRO.md, RULES.md, WORKFLOWS.md
    const standardFiles = ['MEHRO.md', 'RULES.md', 'WORKFLOWS.md'];
    for (const fileName of standardFiles) {
      const filePath = path.join(layer.dir, fileName);
      const parsed = loadSinglePromptFile(filePath);
      if (parsed) {
        mergePromptFileData(merged, parsed);
      }
    }

    // Check .mehro/ subdirectory if present
    const dotMehroDir = path.join(layer.dir, '.mehro');
    if (fs.existsSync(dotMehroDir)) {
      const files = fs.readdirSync(dotMehroDir);
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.yaml') || file.endsWith('.yml')) {
          const parsed = loadSinglePromptFile(path.join(dotMehroDir, file));
          if (parsed) {
            mergePromptFileData(merged, parsed);
          }
        }
      }
    }
  }

  return merged;
}

function deepMerge(target, source) {
  for (const [key, val] of Object.entries(source)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], val);
    } else {
      target[key] = val;
    }
  }
  return target;
}

function mergePromptFileData(target, source) {
  const { frontmatter, sections } = source;

  // Sections: Later layer overrides earlier layer
  if (sections['System Role']) {
    target.systemRole = sections['System Role'];
  }
  if (sections['Context']) {
    target.context = sections['Context'];
  }
  if (sections['Rules']) {
    target.rules = sections['Rules'];
  }

  // Frontmatter merging: deep merge so nested config is preserved across layers
  if (frontmatter) {
    deepMerge(target.frontmatter, frontmatter);

    if (frontmatter.rules && Array.isArray(frontmatter.rules)) {
      target.frontmatterRules.push(...frontmatter.rules);
    }
    if (frontmatter.workflows && Array.isArray(frontmatter.workflows)) {
      target.frontmatterWorkflows.push(...frontmatter.workflows);
    }
    if (frontmatter.skills?.active && Array.isArray(frontmatter.skills.active)) {
      target.activeSkills.push(...frontmatter.skills.active);
    }
    if (frontmatter.tools?.disabled && Array.isArray(frontmatter.tools.disabled)) {
      target.disabledTools.push(...frontmatter.tools.disabled);
    }
  }
}

export function watchPromptFiles(rootDir = process.cwd(), onChange = null) {
  const pathsToWatch = [
    path.resolve(rootDir),
    path.resolve(rootDir, 'workspace')
  ];

  const watchers = [];
  for (const dir of pathsToWatch) {
    if (!fs.existsSync(dir)) continue;
    const w = fs.watch(dir, (eventType, filename) => {
      if (filename && (filename.endsWith('.md') || filename.endsWith('.yaml'))) {
        mtimeCache.delete(path.join(dir, filename));
        logger.info(`Prompt file changed: ${filename}`);
        if (onChange) onChange();
      }
    });
    watchers.push(w);
  }
  return watchers;
}

export default {
  loadPromptFiles,
  loadSinglePromptFile,
  parsePromptFileContent,
  watchPromptFiles
};
