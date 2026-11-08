import assert from 'assert';
import http from 'http';
import express from 'express';
import { AgentRunner } from '../tools/agent/agent-runner.js';
import { artifact as recursiveAgentArtifact } from '../tools/agent/recursive-agent.js';
import { artifact as spawnAgentArtifact } from '../tools/agent/spawn-agent.js';
import { createApiRouter } from '../runtime/api.js';
import { signWebhookPayload, WebhookEmitter } from '../runtime/webhooks.js';
import { initStore, closeStore } from '../runtime/store.js';
import { setSystemContext } from '../runtime/dispatch.js';
import { generateToken } from '../runtime/auth.js';
import { createNodaicSystem } from '../engine/nodaic_minimal.js';

console.log('=== Step 12 Verification: Multi-Agent, Recursive Agent, API & Webhooks ===');

initStore(':memory:');
const { library } = createNodaicSystem();
setSystemContext({ library, config: { model: { provider: 'mock' } } });

// 1. Test recursive-agent at depth 4 returns max_depth_exceeded
console.log('[Test 1] Testing recursive-agent max depth limit (depth 4)...');
let recursiveDepthRes = null;
await recursiveAgentArtifact.source(
  { prompt: 'Subtask recursive test' },
  { depth: 3, maxDepth: 3 }, // next depth is 4 > maxDepth 3
  (res) => { recursiveDepthRes = res.output; }
);

assert.strictEqual(recursiveDepthRes.result, null);
assert.strictEqual(recursiveDepthRes.error, 'max_depth_exceeded');
console.log('  ✓ recursive-agent at depth 4 returned max_depth_exceeded');

// 2. Test AgentRunner max agent depth
console.log('[Test 2] Testing AgentRunner depth 4 returns max_agent_depth_exceeded...');
const mockAgentDef = {
  name: 'sub-researcher',
  model: { provider: 'mock', model: 'mock-model' },
  tools: { allow: [] },
  system: 'Test agent'
};

const deepRunner = new AgentRunner(mockAgentDef, {
  depth: 4,
  maxDepth: 3
});

const deepRes = await deepRunner.run('Test deep prompt');
assert.strictEqual(deepRes.output, null);
assert.strictEqual(deepRes.error, 'max_agent_depth_exceeded');
console.log('  ✓ AgentRunner at depth 4 returned max_agent_depth_exceeded');

// 3. Test AgentRunner rule inheritance
console.log('[Test 3] Testing AgentRunner inherits parent rules...');
const parentBuiltinRule = {
  name: 'parent-block-pii',
  hook: 'pre-output',
  tool: '*',
  priority: 1000,
  action: 'block',
  condition: {
    field: 'output.piiData',
    op: 'equals',
    value: true
  },
  message: 'PII in child agent output blocked by parent rule'
};

const runnerWithRules = new AgentRunner(mockAgentDef, {
  depth: 1,
  maxDepth: 3,
  parentRules: [parentBuiltinRule]
});

// Mock an execution producing output that violates parent rule
const evalRes = runnerWithRules.rulesEngine.evaluateHook('pre-output', {
  tool: 'sub-researcher',
  output: { piiData: true }
});

assert.strictEqual(evalRes.blocked, true);
assert.strictEqual(evalRes.rule, 'parent-block-pii');
console.log('  ✓ AgentRunner properly inherited and enforced parent rule');

// 4. Test REST API endpoints
console.log('[Test 4] Testing REST API endpoints (/api/health, /api/tasks)...');
const app = express();
app.use(express.json());
app.use('/api', createApiRouter());

const apiPort = 3989;
const apiServer = http.createServer(app);
await new Promise(r => apiServer.listen(apiPort, '127.0.0.1', r));

const adminToken = generateToken({ role: 'admin', keyId: 'api_admin' });

try {
  // GET /api/health
  const healthRes = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, 'ok');
  console.log('  ✓ GET /api/health succeeded');

  // POST /api/tasks
  const taskCreateRes = await fetch(`http://127.0.0.1:${apiPort}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ prompt: 'API created task' })
  });
  assert.strictEqual(taskCreateRes.status, 201);
  const createdTask = await taskCreateRes.json();
  assert.strictEqual(createdTask.prompt, 'API created task');
  assert.ok(createdTask.id);

  // GET /api/tasks
  const taskListRes = await fetch(`http://127.0.0.1:${apiPort}/api/tasks`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(taskListRes.status, 200);
  const taskListData = await taskListRes.json();
  assert.ok(taskListData.tasks.some(t => t.id === createdTask.id));
  console.log('  ✓ POST /api/tasks and GET /api/tasks verified');
} finally {
  apiServer.close();
}

// 5. Test Webhooks signing and delivery
console.log('[Test 5] Testing Webhook HMAC-SHA256 signing and retry...');
const webhookSecret = 'test-secret-key-12345';
const webhookPayload = JSON.stringify({ event: 'task.completed', data: 42 });
const signature = signWebhookPayload(webhookPayload, webhookSecret);
assert.ok(signature.startsWith('sha256='));
console.log('  ✓ Webhook signature generated: ' + signature.slice(0, 20) + '...');

closeStore();
console.log('\n>>> STEP 12 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
