import assert from 'assert';
import { boot, shutdown, loadAndValidateConfig, configSchema } from '../runtime/index.js';
import { getDb, initStore, closeStore } from '../runtime/store.js';
import { generateToken, validateToken, checkRateLimit, resetRateLimits } from '../runtime/auth.js';
import { dispatch } from '../runtime/dispatch.js';
import logger from '../src/logger.js';

console.log('=== Step 1 Verification: Runtime Skeleton & Config Validation ===');

// 1. Test clean boot with in-memory DB and valid config
console.log('[Test 1] Booting runtime with config.yaml...');
const { config, db } = boot({ configPath: './config.yaml', inMemory: true, watch: false });
assert.ok(config, 'Config should load');
assert.strictEqual(config.runtime.port, 3030);
assert.strictEqual(config.model.provider, 'ollama');

// 2. Test SQLite tables existence
console.log('[Test 2] Verifying SQLite tables initialize cleanly...');
const tables = [
  'artifacts',
  'bindings',
  'principals',
  'permissions',
  'variables',
  'audit_log',
  'workflow_runs'
];

for (const table of tables) {
  const row = db.prepare(`SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  assert.strictEqual(row.count, 1, `Table ${table} must exist in SQLite`);
  console.log(`  ✓ Table '${table}' verified`);
}

// 3. Test Zod strict rejection of unknown keys at root
console.log('[Test 3] Verifying Zod rejects unknown root keys...');
let rejectedRoot = false;
try {
  configSchema.parse({
    ...config,
    unknownRootKey: 'bad'
  });
} catch (err) {
  rejectedRoot = true;
  assert.ok(err.message.includes('unknownRootKey') || err.message.includes('unrecognized_keys'));
  console.log('  ✓ Rejected unknown root key correctly');
}
assert.ok(rejectedRoot, 'Zod must reject unknown root keys');

// 4. Test Zod strict rejection of unknown keys in nested sections
console.log('[Test 4] Verifying Zod rejects unknown nested keys...');
let rejectedNested = false;
try {
  configSchema.parse({
    ...config,
    runtime: {
      ...config.runtime,
      maliciousOption: true
    }
  });
} catch (err) {
  rejectedNested = true;
  assert.ok(err.message.includes('maliciousOption') || err.message.includes('unrecognized_keys'));
  console.log('  ✓ Rejected unknown nested key correctly');
}
assert.ok(rejectedNested, 'Zod must reject unknown nested keys');

// 5. Test missing required key emits clear key path
console.log('[Test 5] Verifying missing required key path reporting...');
let missingReported = false;
try {
  const invalidConfig = JSON.parse(JSON.stringify(config));
  delete invalidConfig.model.provider;
  configSchema.parse(invalidConfig);
} catch (err) {
  missingReported = true;
  const issues = err.issues || [];
  const fieldPath = issues[0]?.path?.join('.');
  assert.strictEqual(fieldPath, 'model.provider', 'Error must clearly point to model.provider');
  console.log(`  ✓ Clear key path emitted: ${fieldPath}`);
}
assert.ok(missingReported, 'Zod must emit clear key path on missing required key');

// 6. Test 256-hex HMAC token generation & validation
console.log('[Test 6] Verifying 256-hex HMAC token...');
const token = generateToken({ role: 'admin', keyId: 'admin_test' });
assert.strictEqual(token.length, 256, 'Token must be exactly 256 hex chars');
const verified = validateToken(token);
assert.strictEqual(verified.valid, true);
assert.strictEqual(verified.role, 'admin');
assert.strictEqual(verified.keyId, 'admin_test');

// Test tampered token
const tamperedToken = token.slice(0, 100) + (token[100] === 'A' ? 'B' : 'A') + token.slice(101);
const tamperedRes = validateToken(tamperedToken);
assert.strictEqual(tamperedRes.valid, false);
console.log('  ✓ 256-hex HMAC token verified and tamper detection passed');

// 7. Test rate limiter
console.log('[Test 7] Verifying 60 req/min rate limiter...');
resetRateLimits();
for (let i = 0; i < 60; i++) {
  const rl = checkRateLimit('test_user', 60);
  assert.strictEqual(rl.allowed, true);
}
const blocked = checkRateLimit('test_user', 60);
assert.strictEqual(blocked.allowed, false);
assert.ok(blocked.retryAfter > 0);
console.log('  ✓ Rate limiter properly blocks request #61 with Retry-After');

// 8. Test single dispatch seam with auth
console.log('[Test 8] Verifying dispatch seam and scope checks...');
const whoamiRes = await dispatch('whoami', {}, token);
assert.strictEqual(whoamiRes.role, 'admin');
assert.strictEqual(whoamiRes.isAdmin, true);

// Test unauthenticated access to protected action
const unauthRes = await dispatch('variable.set', { key: 'test', value: 123 }, null);
assert.strictEqual(unauthRes.error, true);
assert.strictEqual(unauthRes.status, 401);
assert.strictEqual(unauthRes.code, 'auth_required');

// Test device token without admin scope trying to delete variable
const deviceToken = generateToken({ role: 'device', keyId: 'dev1' });
const forbiddenRes = await dispatch('variable.delete', { key: 'test' }, deviceToken);
assert.strictEqual(forbiddenRes.error, true);
assert.strictEqual(forbiddenRes.status, 403);
assert.strictEqual(forbiddenRes.code, 'forbidden');
console.log('  ✓ Dispatch correctly enforces authentication and scope checks');

// 9. Test logger separation (console.log untouched)
console.log('[Test 9] Verifying logger event emitter...');
let logEmitted = false;
logger.once('entry', (entry) => {
  logEmitted = true;
  assert.strictEqual(entry.message, 'Step 1 log test');
});
logger.info('Step 1 log test');
assert.ok(logEmitted, 'Logger must emit entry event');
console.log('  ✓ Logger event emitter verified without touching console.log');

shutdown();
console.log('\n>>> STEP 1 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
