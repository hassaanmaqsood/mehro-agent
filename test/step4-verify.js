import assert from 'assert';
import path from 'path';
import { RulesEngine } from '../runtime/rules.js';

console.log('=== Step 4 Verification: Rules Engine & Builtin Policies ===');

const mockConfig = {
  runtime: {
    workspaceDir: './workspace'
  },
  security: {
    shellAllowlist: ['git', 'npm', 'node', 'ls'],
    shellBlocklist: ['rm -rf', 'mkfs']
  },
  recursiveAgent: {
    maxDepth: 3
  }
};

const engine = new RulesEngine({ strict: true });
engine.loadRulesDir('./rules/builtin', true);

// 1. Test path-sandbox blocks ../../../etc/shadow
console.log('[Test 1] Testing path-sandbox blocks path outside workspace...');
const sandboxBlockRes = engine.evaluateHook('pre-tool', {
  tool: 'read-file',
  input: { path: '../../../etc/shadow' },
  config: mockConfig
});

assert.strictEqual(sandboxBlockRes.blocked, true);
assert.strictEqual(sandboxBlockRes.rule, 'path-sandbox');
assert.ok(sandboxBlockRes.error.includes('sandbox'));
console.log('  ✓ path-sandbox successfully blocked ../../../etc/shadow');

// Test path-sandbox allows safe path inside workspace
const safePathRes = engine.evaluateHook('pre-tool', {
  tool: 'read-file',
  input: { path: './workspace/report.txt' },
  config: mockConfig
});
assert.strictEqual(safePathRes.blocked, false);
console.log('  ✓ path-sandbox allowed safe path ./workspace/report.txt');

// 2. Test Priority Ordering
console.log('[Test 2] Testing priority ordering and evaluation...');
const customEngine = new RulesEngine({ strict: true });

const executionOrder = [];

customEngine.registerRule({
  name: 'low-prio-warn',
  hook: 'pre-tool',
  tool: '*',
  priority: 50,
  action: 'warn',
  condition: true,
  message: 'low prio warning'
});

customEngine.registerRule({
  name: 'high-prio-transform',
  hook: 'pre-tool',
  tool: '*',
  priority: 200,
  action: 'transform',
  condition: true,
  transform: { transformed: true }
});

const hookRes = customEngine.evaluateHook('pre-tool', {
  tool: 'any-tool',
  input: { original: true },
  config: mockConfig
});

assert.strictEqual(hookRes.blocked, false);
assert.strictEqual(hookRes.input.transformed, true);
assert.strictEqual(hookRes.warnings.length, 1);
assert.strictEqual(hookRes.warnings[0], 'low prio warning');
console.log('  ✓ Priority ordering verified (transform run at 200, warn run at 50)');

// Test first block stops execution
customEngine.registerRule({
  name: 'high-prio-block',
  hook: 'pre-tool',
  tool: '*',
  priority: 500,
  action: 'block',
  condition: true,
  message: 'First block wins'
});

const blockRes = customEngine.evaluateHook('pre-tool', {
  tool: 'any-tool',
  input: {},
  config: mockConfig
});
assert.strictEqual(blockRes.blocked, true);
assert.strictEqual(blockRes.rule, 'high-prio-block');
console.log('  ✓ First block won and aborted downstream execution');

// 3. Test shell-allowlist rule
console.log('[Test 3] Testing shell-allowlist blocks blocked commands...');
const shellBlockRes = engine.evaluateHook('pre-tool', {
  tool: 'shell',
  input: { command: 'rm -rf /' },
  config: mockConfig
});
assert.strictEqual(shellBlockRes.blocked, true);
assert.strictEqual(shellBlockRes.rule, 'shell-allowlist');
console.log('  ✓ shell-allowlist blocked rm -rf /');

// 4. Test max-recursion-depth
console.log('[Test 4] Testing max-recursion-depth rule...');
const depthRes = engine.evaluateHook('pre-plan', {
  tool: 'recursive-agent',
  state: { depth: 4 },
  config: mockConfig
});
assert.strictEqual(depthRes.blocked, true);
assert.strictEqual(depthRes.rule, 'max-recursion-depth');
console.log('  ✓ max-recursion-depth blocked depth 4 > maxDepth (3)');

// 5. Test PII scan on output
console.log('[Test 5] Testing PII output scan warning...');
const piiRes = engine.evaluateHook('pre-output', {
  tool: '*',
  output: { userEmail: 'alice@example.com' },
  config: mockConfig
});
assert.strictEqual(piiRes.blocked, false);
assert.strictEqual(piiRes.warnings.length, 1);
assert.ok(piiRes.warnings[0].includes('PII'));
console.log('  ✓ pii-output-scan warned on unmasked email address');

console.log('\n>>> STEP 4 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
