import assert from 'assert';
import { execSync } from 'child_process';

console.log('=== Step 3 Verification: Core Tools via nodaic_check.js ===');

function checkTool(toolPath, input) {
  const cmd = `node nodaic_check.js ${toolPath} --input '${JSON.stringify(input)}'`;
  const stdout = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(stdout);
}

// 1. tools/core/log.js
console.log('[Test 1] Testing tools/core/log.js...');
const logRes = checkTool('tools/core/log.js', { message: 'Verification message' });
assert.strictEqual(logRes.output.result, 'Verification message');
assert.strictEqual(logRes.output.error, null);
console.log('  ✓ log.js verified');

// 2. tools/core/calculate.js
console.log('[Test 2] Testing tools/core/calculate.js...');
const calcRes = checkTool('tools/core/calculate.js', { expression: '(10 + 5) * 4 / 2' });
assert.strictEqual(calcRes.output.result, 30);
assert.strictEqual(calcRes.output.error, null);
console.log('  ✓ calculate.js verified');

// 3. tools/core/delay.js
console.log('[Test 3] Testing tools/core/delay.js...');
const t0 = Date.now();
const delayRes = checkTool('tools/core/delay.js', { milliseconds: 50 });
const elapsed = Date.now() - t0;
assert.strictEqual(delayRes.output.result, 50);
assert.strictEqual(delayRes.output.error, null);
assert.ok(elapsed >= 45, `Elapsed should be at least 45ms, was ${elapsed}ms`);
console.log(`  ✓ delay.js verified (${elapsed}ms)`);

// 4. tools/core/string-transform.js
console.log('[Test 4] Testing tools/core/string-transform.js...');
const upperRes = checkTool('tools/core/string-transform.js', { text: 'hello world', operation: 'uppercase' });
assert.strictEqual(upperRes.output.result, 'HELLO WORLD');

const revRes = checkTool('tools/core/string-transform.js', { text: 'radar', operation: 'reverse' });
assert.strictEqual(revRes.output.result, 'radar');

const replRes = checkTool('tools/core/string-transform.js', { text: 'foo bar foo', operation: 'replace', find: 'foo', replaceWith: 'baz' });
assert.strictEqual(replRes.output.result, 'baz bar baz');
console.log('  ✓ string-transform.js verified');

// 5. tools/core/token-context.js
console.log('[Test 5] Testing tools/core/token-context.js...');
const tokenRes = checkTool('tools/core/token-context.js', {
  budget: 15,
  items: [
    { id: 'low_prio', content: 'Short content', priority: 1, tokens: 10 },
    { id: 'high_prio_1', content: 'Important note', priority: 10, tokens: 5 },
    { id: 'high_prio_2', content: 'Critical data', priority: 20, tokens: 8 }
  ]
});
assert.strictEqual(tokenRes.output.error, null);
assert.strictEqual(tokenRes.output.usedTokens, 13);
// high_prio_2 (8) + high_prio_1 (5) = 13 <= 15. low_prio (10) exceeds remaining budget (2) -> dropped
assert.deepStrictEqual(tokenRes.output.dropped, ['low_prio']);
assert.strictEqual(tokenRes.output.selected.length, 2);
assert.strictEqual(tokenRes.output.selected[0].id, 'high_prio_2');
assert.strictEqual(tokenRes.output.selected[1].id, 'high_prio_1');
console.log('  ✓ token-context.js greedy priority fill verified');

console.log('\n>>> STEP 3 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
