import assert from 'assert';
import { execSync } from 'child_process';
import { createNodaicSystem, Process, Graph, Library } from '../engine/nodaic_minimal.js';
import { WorkflowScheduler } from '../engine/nodaic_scheduler.js';
import { initStore, closeStore } from '../runtime/store.js';

console.log('=== Step 2 Verification: Nodaic Engine & Testing Harness ===');

// 1. Verify nodaic_check.js against dummy process
console.log('[Test 1] Testing nodaic_check.js CLI harness with dummy process...');
const cmd = `node nodaic_check.js test/fixtures/dummy_process.js --input '{"name":"Mehro"}'`;
const stdout = execSync(cmd, { encoding: 'utf8' });
const parsed = JSON.parse(stdout);

assert.ok(parsed.output, 'Output must exist');
assert.strictEqual(parsed.output.result, 'Hello, Mehro!');
assert.strictEqual(parsed.output.error, null);
console.log('  ✓ nodaic_check.js successfully executed dummy process');

// 2. Verify NDL graph with parallel execution
console.log('[Test 2] Testing 2-node parallel NDL graph execution...');
initStore(':memory:');
const { library } = createNodaicSystem();

// Register a 150ms delay process
library.addArtifact({
  id: 'test/sleep',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  source: async (input, state, cb) => {
    const delay = input.ms || state.ms || 150;
    const start = Date.now();
    await new Promise(r => setTimeout(r, delay));
    const elapsed = Date.now() - start;
    cb({
      output: {
        [input.tag || state.tag || 'done']: true,
        [`${input.tag || state.tag || 'done'}_elapsed`]: elapsed,
        error: null
      },
      state
    });
  }
});

// NDL graph with two independent nodes converging into flow/merge
const ndlSource = `
graph test/parallel-graph
node a @test/sleep:1.0.0
  state tag = "nodeA"
  state ms = 150
node b @test/sleep:1.0.0
  state tag = "nodeB"
  state ms = 150
node sink @flow/merge:1.0.0
a -> sink
b -> sink
`;

library.addArtifact({
  id: 'test/parallel-graph',
  version: '1.0.0',
  artifactType: 'graph',
  sourceType: 'text/x-ndl',
  source: ndlSource
});

const scheduler = new WorkflowScheduler(library);
const t0 = Date.now();
const graphResult = await scheduler.run('test/parallel-graph');
const totalTime = Date.now() - t0;

console.log(`  ✓ 2 parallel 150ms nodes completed in ${totalTime}ms`);
assert.ok(graphResult.nodeA, 'nodeA must have executed');
assert.ok(graphResult.nodeB, 'nodeB must have executed');
// If sequential: ~300ms+. In parallel: ~150-240ms (well under 280ms)
assert.ok(totalTime < 280, `Expected parallel execution under 280ms, took ${totalTime}ms`);

// 3. Test built-in memory/state persistence
console.log('[Test 3] Testing built-in memory/state process...');
const writeRes = await scheduler.run('memory/state', { key: 'sample_var', value: { count: 42 } });
assert.strictEqual(writeRes.key, 'sample_var');
assert.deepStrictEqual(writeRes.value, { count: 42 });

const readRes = await scheduler.run('memory/state', { key: 'sample_var' });
assert.strictEqual(readRes.key, 'sample_var');
assert.deepStrictEqual(readRes.value, { count: 42 });
console.log('  ✓ memory/state roundtrip persistence verified');

// 4. Test error propagation & aborting downstream unless allowFail: true
console.log('[Test 4] Testing error abort in DAG...');
library.addArtifact({
  id: 'test/fail',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  source: (input, state, cb) => {
    cb({ output: { error: 'simulated_failure' }, state });
  }
});

const failGraphNDL = `
node step1 @test/fail:1.0.0
node step2 @test/sleep:1.0.0
  state tag = "step2"
step1 -> step2
`;

library.addArtifact({
  id: 'test/fail-graph',
  version: '1.0.0',
  artifactType: 'graph',
  sourceType: 'text/x-ndl',
  source: failGraphNDL
});

const failResult = await scheduler.run('test/fail-graph');
assert.strictEqual(failResult.error, 'simulated_failure');
assert.strictEqual(failResult.step2, undefined, 'step2 should not have run because step1 failed');
console.log('  ✓ Error properly aborted downstream node');

closeStore();
console.log('\n>>> STEP 2 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
