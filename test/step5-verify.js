import assert from 'assert';
import { registerProvider, loadProvider } from '../planner/providers/index.js';
import { complete as modelComplete } from '../planner/model-adapter.js';
import { assembleSystemPrompt, BUILTIN_PROMPT } from '../planner/prompt.js';
import { parsePlanToArtifact, plan } from '../planner/planner.js';

console.log('=== Step 5 Verification: Model Adapter, Providers & Planner ===');

// 1. Verify unknown provider throws error
console.log('[Test 1] Testing unknown provider throws error (no fallback)...');
let caughtUnknown = false;
try {
  loadProvider('non_existent_provider');
} catch (err) {
  caughtUnknown = true;
  assert.ok(err.message.includes('Unknown provider: non_existent_provider'));
  console.log('  ✓ Unknown provider threw correctly: ' + err.message);
}
assert.ok(caughtUnknown);

// 2. Test provider swap via config mock
console.log('[Test 2] Testing provider registration and swap...');
const mockProviderA = {
  complete: async (messages, cfg) => `ProviderA: ${cfg.model} received ${messages.length} messages`
};
const mockProviderB = {
  complete: async (messages, cfg) => `ProviderB: ${cfg.model} received ${messages.length} messages`
};

registerProvider('mock-a', mockProviderA);
registerProvider('mock-b', mockProviderB);

const resA = await modelComplete([{ role: 'user', content: 'hi' }], { provider: 'mock-a', model: 'alpha-1' });
assert.strictEqual(resA, 'ProviderA: alpha-1 received 1 messages');

const resB = await modelComplete([{ role: 'user', content: 'hi' }], { provider: 'mock-b', model: 'beta-2' });
assert.strictEqual(resB, 'ProviderB: beta-2 received 1 messages');
console.log('  ✓ Provider swap verified seamlessly via config');

// 3. Test prompt.js assembly order: [1..7]
console.log('[Test 3] Testing prompt.js exact assembly order [1..7]...');
const testManifest = [{ id: 'tools/core/calculate', description: 'math' }];
const testSkills = [{ name: 'web-researcher', body: 'Search web first.' }];
const testContext = 'Monorepo project in /packages.';
const testSystemRole = 'Engineering assistant for team.';
const testRules = 'Never delete files without asking.';

const prompt = await assembleSystemPrompt({
  toolsManifest: testManifest,
  activeSkills: testSkills,
  mehroContext: testContext,
  mehroSystemRole: testSystemRole,
  proseRules: testRules,
  budget: 8000
});

// Check exact appearance order in assembled string
const pos1 = prompt.indexOf('You are Mehro Agent');
const pos2 = prompt.indexOf('Available Tools:');
const pos3 = prompt.indexOf('Active Skills:');
const pos4 = prompt.indexOf('## Context');
const pos5 = prompt.indexOf('## System Role');
const pos6 = prompt.indexOf('## Rules');

assert.ok(pos1 !== -1, 'Builtin prompt must exist');
assert.ok(pos2 !== -1, 'Manifest must exist');
assert.ok(pos3 !== -1, 'Skills must exist');
assert.ok(pos4 !== -1, 'Context must exist');
assert.ok(pos5 !== -1, 'System Role must exist');
assert.ok(pos6 !== -1, 'Rules must exist');

assert.ok(pos1 < pos2, '1_builtin must precede 2_manifest');
assert.ok(pos2 < pos3, '2_manifest must precede 3_skills');
assert.ok(pos3 < pos4, '3_skills must precede 4_context');
assert.ok(pos4 < pos5, '4_context must precede 5_system_role');
assert.ok(pos5 < pos6, '5_system_role must precede 6_rules_prose');
console.log('  ✓ Assembly order [1] -> [2] -> [3] -> [4] -> [5] -> [6] verified');

// 4. Test token-context.js trimming in prompt assembly
console.log('[Test 4] Testing token budget trimming in prompt assembly...');
const tightBudgetPrompt = await assembleSystemPrompt({
  toolsManifest: testManifest,
  activeSkills: testSkills,
  mehroContext: testContext,
  mehroSystemRole: testSystemRole,
  proseRules: 'A'.repeat(5000), // Huge rules block
  budget: 250 // Tight budget: fits builtin (~182 tokens) but drops 1250-token rules
});
assert.ok(tightBudgetPrompt.includes('You are Mehro Agent'), 'High priority builtin retained');
assert.ok(!tightBudgetPrompt.includes('A'.repeat(5000)), 'Low priority huge rules block dropped');
console.log('  ✓ token-context.js trimmed low priority blocks under tight budget');

// 5. Test planner parsing JSON DAG to NDL Graph artifact
console.log('[Test 5] Testing planner parsing JSON DAG to NDL Graph artifact...');
const jsonPlan = JSON.stringify({
  thought_process: 'Calculate expression first',
  dag: [
    {
      id: 'step1',
      function: 'tools/core/calculate',
      parameters: { expression: '2 + 2' },
      dependencies: []
    }
  ]
});

const artifact = parsePlanToArtifact(jsonPlan, 'calculate 2+2');
assert.strictEqual(artifact.artifactType, 'graph');
assert.strictEqual(artifact.sourceType, 'text/x-ndl');
assert.ok(artifact.source.includes('node step1 @tools/core/calculate:1.0.0'));
assert.ok(artifact.source.includes('node sink @flow/merge:1.0.0'));
assert.ok(artifact.source.includes('step1 -> sink'));
console.log('  ✓ Planner parsed JSON DAG into valid NDL Graph artifact with flow/merge sink');

console.log('\n>>> STEP 5 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
