import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { loadPromptFiles } from '../runtime/prompt-files.js';
import { SkillsRegistry } from '../runtime/skills.js';

console.log('=== Step 6 Verification: Skills System & Prompt Files Loader ===');

// 1. Test 3-layer override precedence (Layer 3 > Layer 2 > Layer 1)
console.log('[Test 1] Testing 3-layer override precedence (Layer 3 > Layer 2 > Layer 1)...');

const testBase = path.resolve('./tmp-test-layers');
const layer1Dir = path.join(testBase, 'layer1-global');
const layer2Dir = path.join(testBase, 'layer2-project');
const layer3Dir = path.join(layer2Dir, 'workspace');

fs.mkdirSync(layer1Dir, { recursive: true });
fs.mkdirSync(layer3Dir, { recursive: true });

// Layer 1 (Global)
fs.writeFileSync(path.join(layer1Dir, 'MEHRO.md'), `---
model:
  provider: ollama
  model: layer1-model
---
## System Role
Global system role from Layer 1

## Context
Global context from Layer 1
`);

// Layer 2 (Project root) overrides System Role and model
fs.writeFileSync(path.join(layer2Dir, 'MEHRO.md'), `---
model:
  provider: openai
  model: layer2-model
---
## System Role
Project system role from Layer 2
`);

// Layer 3 (Workspace) overrides Context
fs.writeFileSync(path.join(layer3Dir, 'MEHRO.md'), `---
model:
  model: layer3-model
---
## Context
Workspace context from Layer 3
`);

const merged = await loadPromptFiles(layer2Dir, layer1Dir);

// Layer 2 over Layer 1 for System Role
assert.strictEqual(merged.systemRole, 'Project system role from Layer 2');
// Layer 3 over Layer 1 for Context
assert.strictEqual(merged.context, 'Workspace context from Layer 3');
// Layer 3 over Layer 2 for model.model
assert.strictEqual(merged.frontmatter.model?.model, 'layer3-model');
// Layer 2 over Layer 1 for model.provider
assert.strictEqual(merged.frontmatter.model?.provider, 'openai');

console.log('  ✓ 3-layer precedence verified: Layer 3 > Layer 2 > Layer 1');

// Clean up temp test directory
fs.rmSync(testBase, { recursive: true, force: true });

// 2. Test Skills Loader & Trigger Matching
console.log('[Test 2] Testing skills loader and trigger matching...');
const skills = new SkillsRegistry();
skills.loadDirs(['./skills/builtin']);

assert.ok(skills.skills.has('web-researcher'), 'web-researcher skill loaded');
assert.ok(skills.skills.has('code-reviewer'), 'code-reviewer skill loaded');
assert.ok(skills.skills.has('task-planner'), 'task-planner skill loaded');
console.log('  ✓ Built-in skills loaded');

// Test keyword triggers
const searchMatch = skills.matchSkills('Please search the web for documentation', [], 3);
assert.strictEqual(searchMatch.length, 1);
assert.strictEqual(searchMatch[0].name, 'web-researcher');

const reviewMatch = skills.matchSkills('Inspect and review the auth logic', [], 3);
assert.strictEqual(reviewMatch.length, 1);
assert.strictEqual(reviewMatch[0].name, 'code-reviewer');

const planMatch = skills.matchSkills('Plan daily standup workflow', [], 3);
assert.strictEqual(planMatch.length, 1);
assert.strictEqual(planMatch[0].name, 'task-planner');
console.log('  ✓ Keyword trigger matching verified');

// Test explicit /skill:<name> activation
console.log('[Test 3] Testing explicit /skill:code-reviewer activation...');
const explicitMatch = skills.matchSkills('/skill:code-reviewer Check this file', [], 3);
assert.ok(explicitMatch.some(s => s.name === 'code-reviewer'));
console.log('  ✓ Explicit /skill:<name> activation verified');

// Test maxActive cap
console.log('[Test 4] Testing maxActive cap...');
const multiTriggerMatch = skills.matchSkills('search and review code and plan tasks', [], 2);
assert.strictEqual(multiTriggerMatch.length, 2, 'Must be capped at maxActive = 2');
console.log('  ✓ maxActive: 2 cap verified');

// Test graceful degradation on malformed skill file
console.log('[Test 5] Testing graceful degradation on malformed skill file...');
const malformedPath = path.resolve('./skills/builtin/invalid-temp.md');
fs.writeFileSync(malformedPath, 'Not valid frontmatter at all');
const loaded = skills.loadSkillFile(malformedPath);
assert.strictEqual(loaded, null);
fs.unlinkSync(malformedPath);
console.log('  ✓ Malformed skill skipped gracefully without error');

console.log('\n>>> STEP 6 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
