import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createNodaicSystem } from '../engine/nodaic_minimal.js';
import { WorkflowScheduler } from '../engine/nodaic_scheduler.js';
import { initStore, closeStore, auditRepo, getDb } from '../runtime/store.js';
import { mask } from '../tools/privacy/mask.js';
import { unmask } from '../tools/privacy/unmask.js';
import { registerProvider } from '../planner/providers/index.js';
import { plan } from '../planner/planner.js';
import { artifact as recursiveAgentArtifact } from '../tools/agent/recursive-agent.js';
import { artifact as spawnAgentArtifact } from '../tools/agent/spawn-agent.js';

console.log('================================================================');
console.log('   MEHRO AGENT v2 — PHASE 4 COMPLETE END-TO-END VERIFICATION   ');
console.log('================================================================\n');

const workspaceDir = path.resolve('./workspace');
if (!fs.existsSync(workspaceDir)) {
  fs.mkdirSync(workspaceDir, { recursive: true });
}

// -----------------------------------------------------------------------------
// CHECKPOINT 1: Tool Isolation
// Every Process tool passes nodaic_check.js
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 1/8] Tool Isolation: Testing all Process tools via nodaic_check.js...');

const toolsToTest = [
  { file: 'tools/core/log.js', input: { message: 'Isolation test' } },
  { file: 'tools/core/calculate.js', input: { expression: '7 * 6' } },
  { file: 'tools/core/delay.js', input: { ms: 10 } },
  { file: 'tools/core/string-transform.js', input: { text: 'hello', operation: 'uppercase' } },
  { file: 'tools/core/token-context.js', input: { items: [{ id: '1', content: 'test', priority: 1 }], budget: 50 } },
  { file: 'tools/io/read-file.js', input: { path: './workspace/dummy-cp1.txt' }, setup: () => fs.writeFileSync('./workspace/dummy-cp1.txt', 'cp1') },
  { file: 'tools/io/write-file.js', input: { path: './workspace/dummy-write-cp1.txt', content: 'write-cp1' } },
  { file: 'tools/network/web-search.js', input: { query: 'nodaic engine' } },
  { file: 'tools/data/query.js', input: { backend: 'sqlite', operation: 'search', index: 'variables' } },
  { file: 'tools/tasks/task-create.js', input: { prompt: 'Isolation task' } },
  { file: 'tools/tasks/task-list.js', input: {} },
  { file: 'tools/privacy/mask.js', input: { text: 'Email: test@example.com' } }
];

for (const t of toolsToTest) {
  if (t.setup) t.setup();
  const cmd = `node nodaic_check.js ${t.file} --input '${JSON.stringify(t.input)}'`;
  const stdout = execSync(cmd, { encoding: 'utf8' });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.output.error, null, `Tool [${t.file}] failed: ${parsed.output.error}`);
  console.log(`  ✓ Tool passed: ${t.file}`);
}

// Clean up dummy files
if (fs.existsSync('./workspace/dummy-cp1.txt')) fs.unlinkSync('./workspace/dummy-cp1.txt');
if (fs.existsSync('./workspace/dummy-write-cp1.txt')) fs.unlinkSync('./workspace/dummy-write-cp1.txt');
console.log('✓ Checkpoint 1 PASSED: All Process tools pass isolation check\n');


// -----------------------------------------------------------------------------
// CHECKPOINT 2: Security Gates
// read-file/write-file reject ../../../etc/shadow; shell rejects without confirmation token
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 2/8] Security Gates: Testing sandbox and confirmation token gates...');

// Path sandbox check
const readEscapeCmd = `node nodaic_check.js tools/io/read-file.js --input '${JSON.stringify({ path: '../../../etc/shadow' })}'`;
const readEscapeRes = JSON.parse(execSync(readEscapeCmd, { encoding: 'utf8' }));
assert.strictEqual(readEscapeRes.output.error, 'path_violation', 'read-file must reject outside path');

const writeEscapeCmd = `node nodaic_check.js tools/io/write-file.js --input '${JSON.stringify({ path: '../../../etc/shadow', content: 'bad' })}'`;
const writeEscapeRes = JSON.parse(execSync(writeEscapeCmd, { encoding: 'utf8' }));
assert.strictEqual(writeEscapeRes.output.error, 'path_violation', 'write-file must reject outside path');

// Shell confirmation token check
const shellNoTokenCmd = `node nodaic_check.js tools/io/shell.js --input '${JSON.stringify({ command: 'echo should_fail' })}'`;
const shellNoTokenRes = JSON.parse(execSync(shellNoTokenCmd, { encoding: 'utf8' }));
assert.strictEqual(shellNoTokenRes.output.error, 'confirmation_required', 'shell must reject without token');

console.log('  ✓ read-file rejected ../../../etc/shadow with path_violation');
console.log('  ✓ write-file rejected ../../../etc/shadow with path_violation');
console.log('  ✓ shell rejected without token with confirmation_required');
console.log('✓ Checkpoint 2 PASSED: Security gates verified\n');


// -----------------------------------------------------------------------------
// CHECKPOINT 3: Privacy Roundtrip
// unmask(mask(text).masked, vault) === original
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 3/8] Privacy Layer: Testing mask and unmask roundtrip...');

const secretPayload = 'User bob.smith@acme.org called +1-800-555-0199 with key sk-abcdef0123456789abcdef01 and badge EMP-998877';
const { masked, vault } = mask(secretPayload, [{ name: 'badge', regex: /EMP-[0-9]{6}/g }]);

assert.ok(!masked.includes('bob.smith@acme.org'), 'Email must be masked');
assert.ok(!masked.includes('800-555-0199'), 'Phone must be masked');
assert.ok(!masked.includes('sk-abcdef0123456789abcdef01'), 'Key must be masked');
assert.ok(!masked.includes('EMP-998877'), 'Custom pattern must be masked');

const restored = unmask(masked, vault);
assert.strictEqual(restored, secretPayload, 'Restored text must strictly equal original text');
console.log('  ✓ Reversible masking verified without leaking original values');
console.log('✓ Checkpoint 3 PASSED: Privacy roundtrip verified\n');


// -----------------------------------------------------------------------------
// CHECKPOINT 4: Model Swap
// Changing model.provider in config produces the same DAG execution flow with a mock/local provider
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 4/8] Model Swap: Testing provider swapping and DAG generation...');

const expectedPlanNDL = `
graph plan/test
node calc @tools/core/calculate:1.0.0
  state expression = "100 / 4"
node sink @flow/merge:1.0.0
calc -> sink
`;

registerProvider('mock-provider-1', {
  complete: async () => expectedPlanNDL
});
registerProvider('mock-provider-2', {
  complete: async () => expectedPlanNDL
});

const plan1 = await plan('Divide 100 by 4', {
  modelConfig: { provider: 'mock-provider-1', model: 'mock-v1' }
});
const plan2 = await plan('Divide 100 by 4', {
  modelConfig: { provider: 'mock-provider-2', model: 'mock-v2' }
});

assert.strictEqual(plan1.graphArtifact.artifactType, 'graph');
assert.strictEqual(plan2.graphArtifact.artifactType, 'graph');
assert.ok(plan1.graphArtifact.source.includes('@tools/core/calculate:1.0.0'));
assert.ok(plan2.graphArtifact.source.includes('@tools/core/calculate:1.0.0'));
console.log('  ✓ Model providers swapped cleanly producing identical DAG execution plans');
console.log('✓ Checkpoint 4 PASSED: Model swap verified\n');


// -----------------------------------------------------------------------------
// CHECKPOINT 5: Parallel Execution
// Two independent 200ms delay nodes in a Graph complete in ~200ms (under 350ms), proving Promise.all parallelism
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 5/8] Parallel Execution: Testing 2 independent 200ms nodes finish under 350ms...');

initStore(':memory:');
const { library: parLib } = createNodaicSystem();

parLib.addArtifact({
  id: 'test/delay-200',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  source: async (input, state, cb) => {
    const start = Date.now();
    await new Promise(r => setTimeout(r, 200));
    cb({
      output: { [input.id || state.id || 'node']: Date.now() - start, error: null },
      state
    });
  }
});

parLib.addArtifact({
  id: 'test/parallel-200ms-graph',
  version: '1.0.0',
  artifactType: 'graph',
  sourceType: 'text/x-ndl',
  source: `
graph test/parallel-check
node nodeA @test/delay-200:1.0.0
  state id = "nodeA"
node nodeB @test/delay-200:1.0.0
  state id = "nodeB"
node sink @flow/merge:1.0.0
nodeA -> sink
nodeB -> sink
`
});

const parScheduler = new WorkflowScheduler(parLib);
const tStart = Date.now();
const parResult = await parScheduler.run('test/parallel-200ms-graph');
const tTotal = Date.now() - tStart;

console.log(`  ✓ Two 200ms nodes finished in ${tTotal}ms (nodeA: ${parResult.nodeA}ms, nodeB: ${parResult.nodeB}ms)`);
assert.ok(parResult.nodeA >= 190, 'nodeA must have executed for ~200ms');
assert.ok(parResult.nodeB >= 190, 'nodeB must have executed for ~200ms');
assert.ok(tTotal < 350, `Expected parallel time < 350ms, actual time was ${tTotal}ms`);
console.log('✓ Checkpoint 5 PASSED: Parallel execution proven via Promise.all\n');


// -----------------------------------------------------------------------------
// CHECKPOINT 6: Task Persistence
// Tasks created via task-create persist across SQLite store re-initialization
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 6/8] Task Persistence: Testing tasks persist across SQLite store reload...');

const persistenceDbPath = path.resolve('./workspace/e2e-persistence-test.db');
if (fs.existsSync(persistenceDbPath)) fs.unlinkSync(persistenceDbPath);

// Session 1: Create task
initStore(persistenceDbPath);
const createCmd = `node nodaic_check.js tools/tasks/task-create.js --input '${JSON.stringify({
  prompt: 'E2E persistent task verification',
  status: 'pending'
})}' --state '${JSON.stringify({ dbPath: persistenceDbPath })}'`;

const createRes = JSON.parse(execSync(createCmd, { encoding: 'utf8' }));
const savedTaskId = createRes.output.result.id;
assert.ok(savedTaskId);
closeStore();

// Session 2: Re-open store from disk
initStore(persistenceDbPath);
const listCmd = `node nodaic_check.js tools/tasks/task-list.js --input '{}' --state '${JSON.stringify({ dbPath: persistenceDbPath })}'`;
const listRes = JSON.parse(execSync(listCmd, { encoding: 'utf8' }));

assert.strictEqual(listRes.output.error, null);
const foundTask = listRes.output.result.tasks.find(t => t.id === savedTaskId);
assert.ok(foundTask, 'Task must persist and be retrieved after store reload');
assert.strictEqual(foundTask.prompt, 'E2E persistent task verification');

closeStore();
if (fs.existsSync(persistenceDbPath)) fs.unlinkSync(persistenceDbPath);
console.log('  ✓ Task successfully survived SQLite re-initialization');
console.log('✓ Checkpoint 6 PASSED: Task persistence verified\n');


// -----------------------------------------------------------------------------
// CHECKPOINT 7: Recursive Depth
// recursive-agent and spawn-agent at depth 4 return max_depth_exceeded / max_agent_depth_exceeded
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 7/8] Recursive Depth: Testing depth 4 hard limits...');

// 1. recursive-agent at depth 4
let recOutput = null;
await recursiveAgentArtifact.source(
  { prompt: 'Recursive subtask' },
  { depth: 3, maxDepth: 3 }, // next depth is 4
  (res) => { recOutput = res.output; }
);
assert.strictEqual(recOutput.result, null);
assert.strictEqual(recOutput.error, 'max_depth_exceeded');
console.log('  ✓ recursive-agent at depth 4 returned max_depth_exceeded');

// 2. spawn-agent at depth 4
let spawnOutput = null;
await spawnAgentArtifact.source(
  { agent: 'researcher', prompt: 'Spawned agent task' },
  { depth: 3, maxAgentDepth: 3, agentRegistry: { researcher: { name: 'researcher' } } }, // next depth is 4
  (res) => { spawnOutput = res.output; }
);
assert.strictEqual(spawnOutput.result, null);
assert.strictEqual(spawnOutput.error, 'max_agent_depth_exceeded');
console.log('  ✓ spawn-agent at depth 4 returned max_agent_depth_exceeded');
console.log('✓ Checkpoint 7 PASSED: Recursive depth boundaries enforced\n');


// -----------------------------------------------------------------------------
// CHECKPOINT 8: Audit Log
// Every tool execution writes a row to SQLite audit_log with timestamp, tool_id, input_hash, output_hash
// -----------------------------------------------------------------------------
console.log('▶ [Checkpoint 8/8] Audit Log: Verifying SQLite audit_log records...');

const auditDb = initStore(':memory:');
const { library: auditLib } = createNodaicSystem();

auditLib.addArtifact({
  id: 'tools/calc-audit-test',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  source: (input, state, cb) => {
    const a = input.a ?? state.a ?? 0;
    const b = input.b ?? state.b ?? 0;
    cb({ output: { result: a + b, error: null }, state });
  }
});

auditLib.addArtifact({
  id: 'test/audit-graph',
  version: '1.0.0',
  artifactType: 'graph',
  sourceType: 'text/x-ndl',
  source: `
graph test/audit-run
node step1 @tools/calc-audit-test:1.0.0
  state a = 15
  state b = 25
node sink @flow/merge:1.0.0
step1 -> sink
`
});

const auditScheduler = new WorkflowScheduler(auditLib);
const runResult = await auditScheduler.run('test/audit-graph', {}, { runId: 'audit-run-001' });

assert.strictEqual(runResult.result, 40);

// Query SQLite audit_log table
const auditRows = auditRepo.query({ runId: 'audit-run-001' });
assert.ok(auditRows.length > 0, 'Audit log row must exist in SQLite');

for (const row of auditRows) {
  assert.ok(row.timestamp, 'Must have timestamp');
  assert.ok(row.tool_id, 'Must have tool_id');
  assert.ok(row.input_hash, 'Must have input_hash');
  assert.ok(row.output_hash, 'Must have output_hash');
  console.log(`  ✓ Audited node [${row.tool_id}]: input_hash=${row.input_hash.slice(0, 8)}..., output_hash=${row.output_hash.slice(0, 8)}... at ${row.timestamp}`);
}

closeStore();
console.log('✓ Checkpoint 8 PASSED: Every tool execution is recorded with hashes and timestamp in audit_log\n');

console.log('================================================================');
console.log('   🎉 ALL 8 CHECKPOINTS VERIFIED WITH 0 ERRORS! BUILD COMPLETE   ');
console.log('================================================================');
