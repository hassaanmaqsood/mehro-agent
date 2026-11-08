import crypto from 'crypto';
import logger from '../src/logger.js';
import { complete as modelComplete } from './model-adapter.js';
import { assembleSystemPrompt } from './prompt.js';

export async function plan(userPrompt, options = {}) {
  const modelConfig = options.modelConfig || { provider: 'ollama', model: 'tinyllama:1.1b' };
  const toolsManifest = options.toolsManifest || [];
  const activeSkills = options.activeSkills || [];
  const promptFiles = options.promptFiles || {};
  const budget = modelConfig.contextBudget || 8000;

  // 1. Assemble system prompt in strict order [1..7]
  const systemPrompt = await assembleSystemPrompt({
    builtinPrompt: options.builtinPrompt,
    toolsManifest,
    activeSkills,
    mehroContext: promptFiles.context || '',
    mehroSystemRole: promptFiles.systemRole || '',
    proseRules: promptFiles.rules || '',
    budget
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  // 2. Call model adapter
  logger.info(`[PLANNER] Requesting plan from provider [${modelConfig.provider}:${modelConfig.model}]`);
  const rawResponse = await modelComplete(messages, modelConfig);

  // 3. Parse LLM output into valid Graph artifact
  const graphArtifact = parsePlanToArtifact(rawResponse, userPrompt);
  return {
    graphArtifact,
    rawResponse,
    systemPrompt
  };
}

export function parsePlanToArtifact(rawText, userPrompt = '') {
  const planId = `plan/run-${crypto.randomUUID().slice(0, 8)}`;
  let cleanText = rawText.trim();

  // Strip markdown code fences if present
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Attempt JSON parsing first
  if (cleanText.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanText);

      // Format 1: { thought_process, dag: [...] }
      if (Array.isArray(parsed.dag)) {
        let ndl = `graph ${planId}\n`;
        const nodeIds = [];

        for (const step of parsed.dag) {
          const stepId = String(step.id || `step_${nodeIds.length + 1}`);
          const func = step.function || 'tools/core/log';
          ndl += `node ${stepId} @${func}:1.0.0\n`;
          nodeIds.push(stepId);

          if (step.parameters && typeof step.parameters === 'object') {
            for (const [k, v] of Object.entries(step.parameters)) {
              const valStr = typeof v === 'object' ? JSON.stringify(v) : (typeof v === 'string' ? `"${v}"` : String(v));
              ndl += `  state ${k} = ${valStr}\n`;
            }
          }
        }

        // Add edges
        for (const step of parsed.dag) {
          const stepId = String(step.id);
          const deps = step.dependencies || [];
          for (const dep of deps) {
            ndl += `${dep} -> ${stepId}\n`;
          }
        }

        // Converge to flow/merge sink
        ndl += `node sink @flow/merge:1.0.0\n`;
        // Nodes without downstream edge connect to sink
        const hasDownstream = new Set();
        for (const step of parsed.dag) {
          for (const dep of step.dependencies || []) {
            hasDownstream.add(String(dep));
          }
        }
        for (const id of nodeIds) {
          if (!hasDownstream.has(id)) {
            ndl += `${id} -> sink\n`;
          }
        }

        return {
          id: planId,
          version: '1.0.0',
          artifactType: 'graph',
          sourceType: 'text/x-ndl',
          source: ndl,
          metadata: {
            name: `Plan for: ${userPrompt.slice(0, 40)}`,
            thoughtProcess: parsed.thought_process || ''
          }
        };
      }

      // Format 2: standard JSON graph { nodes, edges }
      if (parsed.nodes && Array.isArray(parsed.edges)) {
        return {
          id: planId,
          version: '1.0.0',
          artifactType: 'graph',
          sourceType: 'application/json',
          source: JSON.stringify(parsed),
          metadata: { name: `Plan for: ${userPrompt.slice(0, 40)}` }
        };
      }
    } catch {
      // Continue to NDL check if JSON parsing failed
    }
  }

  // Treat as NDL text
  let ndlSource = cleanText;
  if (!ndlSource.startsWith('graph ')) {
    ndlSource = `graph ${planId}\n${ndlSource}`;
  }

  // Ensure merge sink exists if not present
  if (!ndlSource.includes('@flow/merge')) {
    ndlSource += `\nnode sink @flow/merge:1.0.0\n`;
  }

  return {
    id: planId,
    version: '1.0.0',
    artifactType: 'graph',
    sourceType: 'text/x-ndl',
    source: ndlSource,
    metadata: { name: `Plan for: ${userPrompt.slice(0, 40)}` }
  };
}

export default {
  plan,
  parsePlanToArtifact
};
