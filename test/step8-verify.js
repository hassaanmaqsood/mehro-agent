import assert from 'assert';
import fs from 'fs';
import http from 'http';
import { exec as execCb, execSync } from 'child_process';
import util from 'util';
import { initStore, closeStore } from '../runtime/store.js';

const exec = util.promisify(execCb);

console.log('=== Step 8 Verification: Network & Data Query Tools ===');

// 1. Set up temporary test HTTP server for method & header forwarding check
const testPort = 3987;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      echoMethod: req.method,
      echoHeader: req.headers['x-custom-header'],
      echoBody: body ? JSON.parse(body) : null
    }));
  });
});

await new Promise(resolve => server.listen(testPort, '127.0.0.1', resolve));

try {
  // Test http-request with POST, custom header, and JSON body
  console.log('[Test 1] Testing http-request.js method & header forwarding...');
  const httpCmd = `node nodaic_check.js tools/network/http-request.js --input '${JSON.stringify({
    url: `http://127.0.0.1:${testPort}/test`,
    method: 'POST',
    headers: { 'X-Custom-Header': 'MehroTestValue' },
    body: { hello: 'world' }
  })}'`;

  // Use async exec so the Node event loop can serve the HTTP request
  const { stdout: httpStdout } = await exec(httpCmd);
  const httpRes = JSON.parse(httpStdout);

  assert.strictEqual(httpRes.output.error, null);
  assert.strictEqual(httpRes.output.result.status, 200);
  assert.strictEqual(httpRes.output.result.data.echoMethod, 'POST');
  assert.strictEqual(httpRes.output.result.data.echoHeader, 'MehroTestValue');
  assert.deepStrictEqual(httpRes.output.result.data.echoBody, { hello: 'world' });
  console.log('  ✓ http-request.js correctly forwarded POST method, custom headers, and body');
} finally {
  server.close();
}

// 2. Test query.js against local SQLite adapter
console.log('[Test 2] Testing query.js with SQLite adapter...');
const dbPath = './workspace/test-step8.db';
const stateStr = JSON.stringify({ dbPath });

// Insert query
const insertCmd = `node nodaic_check.js tools/data/query.js --input '${JSON.stringify({
  backend: 'sqlite',
  operation: 'insert',
  index: 'variables',
  data: {
    namespace: 'query_test_ns',
    key: 'test_key_1',
    value: 'query_adapter_success'
  }
})}' --state '${stateStr}'`;

const insertRes = JSON.parse(execSync(insertCmd, { encoding: 'utf8' }));
assert.strictEqual(insertRes.output.error, null);
assert.strictEqual(insertRes.output.result.total, 1);
console.log('  ✓ query.js insert operation succeeded');

// Search query
const searchCmd = `node nodaic_check.js tools/data/query.js --input '${JSON.stringify({
  backend: 'sqlite',
  operation: 'search',
  index: 'variables',
  filter: {
    field: 'key',
    op: 'eq',
    value: 'test_key_1'
  }
})}' --state '${stateStr}'`;

const searchRes = JSON.parse(execSync(searchCmd, { encoding: 'utf8' }));
assert.strictEqual(searchRes.output.error, null);
assert.strictEqual(searchRes.output.result.total, 1);
assert.strictEqual(searchRes.output.result.rows[0].value, 'query_adapter_success');
console.log('  ✓ query.js search operation retrieved inserted row');

// Delete query
const deleteCmd = `node nodaic_check.js tools/data/query.js --input '${JSON.stringify({
  backend: 'sqlite',
  operation: 'delete',
  index: 'variables',
  filter: {
    field: 'key',
    op: 'eq',
    value: 'test_key_1'
  }
})}' --state '${stateStr}'`;

const deleteRes = JSON.parse(execSync(deleteCmd, { encoding: 'utf8' }));
assert.strictEqual(deleteRes.output.error, null);
assert.strictEqual(deleteRes.output.result.total, 1);
console.log('  ✓ query.js delete operation removed row');

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

closeStore();
console.log('\n>>> STEP 8 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
