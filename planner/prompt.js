import { artifact as tokenContextTool } from '../tools/core/token-context.js';

export const BUILTIN_PROMPT = `You are Mehro Agent, a local-first autonomous orchestration agent.
Your objective is to decompose user requests into execution plans as DAGs (Directed Acyclic Graphs).
You output ONLY valid NDL (Nodaic Definition Language) or valid JSON DAG representations.

NDL Format Example:
graph task/execution
node step1 @tools/core/calculate:1.0.0
  state expression = "5 * 10"
node sink @flow/merge:1.0.0
step1 -> sink

JSON DAG Format Example:
{
  "thought_process": "reasoning...",
  "dag": [
    {
      "id": "1",
      "function": "tools/core/calculate",
      "parameters": { "expression": "5 * 10" },
      "dependencies": []
    }
  ]
}

CRITICAL RULES:
1. Always converge branching nodes to a single sink node (@flow/merge:1.0.0).
2. Reference outputs from prior steps using {{stepId.output}} or {{stepId.result}}.
3. Output ONLY the graph representation, with no markdown conversational padding.`;

export async function assembleSystemPrompt({
  builtinPrompt = BUILTIN_PROMPT,
  toolsManifest = [],
  activeSkills = [],
  mehroContext = '',
  mehroSystemRole = '',
  proseRules = '',
  budget = 8000
} = {}) {
  // Format tool manifest block
  const manifestContent = toolsManifest.length > 0
    ? `Available Tools:\n${JSON.stringify(toolsManifest, null, 2)}`
    : '';

  // Format active skills block
  const skillsContent = activeSkills.length > 0
    ? `Active Skills:\n${activeSkills.map(s => `--- Skill: ${s.name} ---\n${s.content || s.body}`).join('\n\n')}`
    : '';

  // Define candidate blocks in exact assembly order:
  // [1] builtin prompt
  // [2] tool manifest
  // [3] active skills
  // [4] MEHRO.md ## Context
  // [5] MEHRO.md ## System Role
  // [6] MEHRO.md / RULES.md ## Rules prose
  const candidates = [
    { id: '1_builtin', order: 1, priority: 100, content: builtinPrompt.trim() },
    { id: '2_manifest', order: 2, priority: 90, content: manifestContent.trim() },
    { id: '3_skills', order: 3, priority: 80, content: skillsContent.trim() },
    { id: '4_context', order: 4, priority: 70, content: mehroContext ? `## Context\n${mehroContext.trim()}` : '' },
    { id: '5_system_role', order: 5, priority: 60, content: mehroSystemRole ? `## System Role\n${mehroSystemRole.trim()}` : '' },
    { id: '6_rules_prose', order: 6, priority: 50, content: proseRules ? `## Rules\n${proseRules.trim()}` : '' }
  ].filter(c => c.content.length > 0);

  // [7] token-context.js trim
  const candidateItems = candidates.map(c => ({
    id: c.id,
    content: c.content,
    priority: c.priority
  }));

  let selectedIds = new Set(candidates.map(c => c.id));

  // Run token-context greedy fill
  await new Promise((resolve) => {
    tokenContextTool.source({ items: candidateItems, budget }, {}, (res) => {
      if (res?.output?.selected) {
        selectedIds = new Set(res.output.selected.map(item => item.id));
      }
      resolve();
    });
  });

  // Preserve the exact assembly order [1..6] for the selected sections
  const selectedBlocks = candidates
    .filter(c => selectedIds.has(c.id))
    .sort((a, b) => a.order - b.order)
    .map(c => c.content);

  return selectedBlocks.join('\n\n');
}

export default {
  BUILTIN_PROMPT,
  assembleSystemPrompt
};
