import assert from 'assert';
import express from 'express';
import http from 'http';
import { createMcpRouter } from '../runtime/mcp-server.js';
import { McpClientManager } from '../runtime/mcp-client.js';
import { generateToken } from '../runtime/auth.js';
import { setSystemContext } from '../runtime/dispatch.js';
import { createNodaicSystem } from '../engine/nodaic_minimal.js';
import { skillsRegistry } from '../runtime/skills.js';
import { initStore, closeStore } from '../runtime/store.js';

console.log('=== Step 9 Verification: Bidirectional MCP Layer ===');

initStore(':memory:');
const { library } = createNodaicSystem();
setSystemContext({ library });

// Load builtin skills for prompts list
skillsRegistry.loadDirs(['./skills/builtin']);

// Mount MCP router on Express
const app = express();
app.use(express.json());
app.use('/mcp', createMcpRouter());

const port = 3988;
const server = http.createServer(app);
await new Promise(r => server.listen(port, '127.0.0.1', r));

const mcpToken = generateToken({ role: 'admin', keyId: 'admin_mcp' });
const deviceTokenNoMcp = generateToken({ role: 'device', keyId: 'dev_no_mcp' });

try {
  // 1. Test unauthenticated request fails with 401
  console.log('[Test 1] Testing unauthenticated access to /mcp/tools/list returns 401...');
  const unauthRes = await fetch(`http://127.0.0.1:${port}/mcp/tools/list`);
  assert.strictEqual(unauthRes.status, 401);
  console.log('  ✓ Unauthenticated access correctly rejected with 401');

  // 2. Test request without mcp scope fails with 403
  console.log('[Test 2] Testing device token without mcp scope returns 403...');
  const forbiddenRes = await fetch(`http://127.0.0.1:${port}/mcp/tools/list`, {
    headers: { 'Authorization': `Bearer ${deviceTokenNoMcp}` }
  });
  assert.strictEqual(forbiddenRes.status, 403);
  console.log('  ✓ Insufficient scope correctly rejected with 403');

  // 3. Test GET /mcp/tools/list with valid mcp token
  console.log('[Test 3] Testing GET /mcp/tools/list with valid bearer token...');
  const toolsRes = await fetch(`http://127.0.0.1:${port}/mcp/tools/list`, {
    headers: { 'Authorization': `Bearer ${mcpToken}` }
  });
  assert.strictEqual(toolsRes.status, 200);
  const toolsData = await toolsRes.json();
  assert.ok(Array.isArray(toolsData.tools), 'Must return tools array');
  assert.ok(toolsData.tools.some(t => t.name === 'memory/state'));
  console.log(`  ✓ /mcp/tools/list returned ${toolsData.tools.length} tools`);

  // 4. Test GET /mcp/prompts/list
  console.log('[Test 4] Testing GET /mcp/prompts/list with valid bearer token...');
  const promptsRes = await fetch(`http://127.0.0.1:${port}/mcp/prompts/list`, {
    headers: { 'Authorization': `Bearer ${mcpToken}` }
  });
  assert.strictEqual(promptsRes.status, 200);
  const promptsData = await promptsRes.json();
  assert.ok(Array.isArray(promptsData.prompts), 'Must return prompts array');
  assert.ok(promptsData.prompts.some(p => p.name === 'web-researcher'));
  assert.ok(promptsData.prompts.some(p => p.name === 'code-reviewer'));
  console.log(`  ✓ /mcp/prompts/list returned ${promptsData.prompts.length} prompts`);

  // 5. Test McpClientManager client wrapping
  console.log('[Test 5] Testing McpClientManager tool wrapping...');
  const clientMgr = new McpClientManager();
  const mockServerConfig = {
    name: 'filesystem',
    transport: 'mock',
    mockTools: [
      { name: 'read_dir', description: 'Lists directory entries' }
    ]
  };

  await clientMgr.connectServer(mockServerConfig, library);
  const activeMcpTools = clientMgr.getConnectedTools();
  assert.strictEqual(activeMcpTools.length, 1);
  assert.strictEqual(activeMcpTools[0].id, 'mcp/filesystem/read_dir');
  assert.ok(library.has('mcp/filesystem/read_dir'), 'Wrapped tool added to library');
  console.log('  ✓ MCP client wrapped and registered remote tool in library');

  clientMgr.disconnectAll();
} finally {
  server.close();
  closeStore();
}

console.log('\n>>> STEP 9 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
