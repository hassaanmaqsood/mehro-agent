import logger from '../src/logger.js';
import { loadPromptFiles } from './prompt-files.js';
import { mask } from '../tools/privacy/mask.js';
import { unmask } from '../tools/privacy/unmask.js';
import { skillsRegistry } from './skills.js';
import { rulesEngine } from './rules.js';
import { plan } from '../planner/planner.js';
import { dispatch, getSystemContext } from './dispatch.js';
import { webhookEmitter } from './webhooks.js';

function unmaskDeep(val, vault) {
  if (!vault || vault.size === 0) return val;
  if (typeof val === 'string') return unmask(val, vault);
  if (Array.isArray(val)) return val.map(x => unmaskDeep(x, vault));
  if (val && typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = unmaskDeep(v, vault);
    }
    return res;
  }
  return val;
}

export async function executePipeline(userPrompt, sessionContext = {}) {
  const { config, library } = getSystemContext();
  const modelConfig = sessionContext.modelConfig || config?.model || { provider: 'ollama', model: 'tinyllama:1.1b' };

  logger.info(`[PIPELINE] Starting execution pipeline for prompt: "${userPrompt.slice(0, 50)}..."`);

  // 1. Prompt files merge (Layer 1 -> Layer 2 -> Layer 3)
  const promptFiles = await loadPromptFiles();

  // 2. Privacy: mask PII
  const customPatterns = config?.privacy?.patterns || [];
  const { masked: maskedPrompt, vault } = mask(userPrompt, customPatterns);
  logger.debug(`[PIPELINE] Masked prompt: "${maskedPrompt.slice(0, 50)}..." (vault size: ${vault.size})`);

  // 3. Skills activation (trigger match + MEHRO.md active skills)
  const maxSkills = config?.skills?.maxActive || 3;
  const activeSkills = skillsRegistry.matchSkills(
    maskedPrompt,
    [...(sessionContext.activeSkills || []), ...(promptFiles.activeSkills || [])],
    maxSkills
  );

  // 4. Rules: pre-plan hook
  const prePlan = rulesEngine.evaluateHook('pre-plan', {
    input: { prompt: maskedPrompt },
    state: sessionContext,
    config
  });
  if (prePlan.blocked) {
    logger.warn(`[PIPELINE] Blocked at pre-plan: ${prePlan.error}`);
    return {
      success: false,
      error: prePlan.error || 'Blocked by pre-plan policy',
      stage: 'pre-plan'
    };
  }

  // 5. Planner (with prompt assembly [1..7] & token context greedy fill)
  const toolsManifest = library ? library.list() : [];
  const { graphArtifact, thoughtProcess } = await plan(maskedPrompt, {
    modelConfig,
    toolsManifest,
    activeSkills,
    promptFiles,
    budget: modelConfig.contextBudget || 8000
  });

  // 6. Rules: post-plan hook
  const postPlan = rulesEngine.evaluateHook('post-plan', {
    output: graphArtifact,
    state: sessionContext,
    config
  });
  if (postPlan.blocked) {
    logger.warn(`[PIPELINE] Blocked at post-plan: ${postPlan.error}`);
    return {
      success: false,
      error: postPlan.error || 'Blocked by post-plan policy',
      stage: 'post-plan'
    };
  }

  // 7. Dispatch library.push
  const pushRes = await dispatch('library.push', { artifact: graphArtifact }, { isAdmin: true, valid: true });
  if (pushRes && pushRes.error) {
    return { success: false, error: pushRes.reason || 'Failed to save graph artifact', stage: 'library.push' };
  }

  // 8. Dispatch run.start
  const runPayload = {
    artifactId: graphArtifact.id,
    input: {},
    state: {
      ...sessionContext,
      config,
      approvalMode: sessionContext.sessionApprovalMode || config?.security?.approvalMode || 'auto'
    }
  };

  const runResult = await dispatch('run.start', runPayload, { isAdmin: true, valid: true });
  if (runResult && runResult.error) {
    return {
      success: false,
      error: runResult.reason || 'Execution failed',
      stage: 'run.start',
      runId: runResult.runId
    };
  }

  // 9. Rules: pre-output hook
  const preOutput = rulesEngine.evaluateHook('pre-output', {
    output: runResult.output,
    state: sessionContext,
    config
  });

  let finalOutput = preOutput.output || runResult.output;

  // 10. Privacy: unmask output
  finalOutput = unmaskDeep(finalOutput, vault);

  // 11. Outbound HMAC webhooks
  webhookEmitter.emit('agent.run.completed', {
    prompt: userPrompt,
    output: finalOutput,
    runId: runResult.runId
  }, runResult.runId);

  logger.info(`[PIPELINE] Execution pipeline completed successfully for run: ${runResult.runId}`);

  return {
    success: true,
    runId: runResult.runId,
    thoughtProcess,
    output: finalOutput,
    durationMs: runResult.durationMs
  };
}

export default {
  executePipeline
};
