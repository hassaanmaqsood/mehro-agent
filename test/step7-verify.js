import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { signConfirmationToken } from '../security/confirm.js';

console.log('=== Step 7 Verification: Security Gates & IO Tools ===');

const workspaceDir = path.resolve('./workspace');
if (!fs.existsSync(workspaceDir)) {
  fs.mkdirSync(workspaceDir, { recursive: true });
}

function checkTool(toolPath, input, state = {}) {
  const stateArg = Object.keys(state).length > 0 ? `--state '${JSON.stringify(state)}'` : '';
  const cmd = `node nodaic_check.js ${toolPath} --input '${JSON.stringify(input)}' ${stateArg}`;
  const stdout = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(stdout);
}

// 1. read-file: reject path outside workspace
console.log('[Test 1] Testing read-file rejects path outside workspace (path_violation)...');
const readOutside = checkTool('tools/io/read-file.js', { path: '../../../etc/shadow' }, { workspaceDir });
assert.strictEqual(readOutside.output.error, 'path_violation');
console.log('  ✓ read-file rejected outside path with path_violation');

// 2. write-file & read-file inside workspace
console.log('[Test 2] Testing write-file & read-file inside workspace...');
const testFilePath = path.join(workspaceDir, 'step7-test.txt');
const writeInside = checkTool(
  'tools/io/write-file.js',
  { path: testFilePath, content: 'Verified step 7 content!' },
  { workspaceDir }
);
assert.strictEqual(writeInside.output.error, null);
assert.ok(writeInside.output.result.bytesWritten > 0);

const readInside = checkTool('tools/io/read-file.js', { path: testFilePath }, { workspaceDir });
assert.strictEqual(readInside.output.error, null);
assert.strictEqual(readInside.output.result, 'Verified step 7 content!');
console.log('  ✓ write-file and read-file verified inside workspace');

// 3. write-file: reject path outside workspace
console.log('[Test 3] Testing write-file rejects path outside workspace...');
const writeOutside = checkTool(
  'tools/io/write-file.js',
  { path: '/etc/bad-write-attempt.txt', content: 'malicious' },
  { workspaceDir }
);
assert.strictEqual(writeOutside.output.error, 'path_violation');
console.log('  ✓ write-file rejected outside path with path_violation');

// 4. shell: missing confirmationToken -> confirmation_required
console.log('[Test 4] Testing shell rejects without confirmationToken (confirmation_required)...');
const shellNoToken = checkTool('tools/io/shell.js', { command: 'echo hello' }, { workspaceDir });
assert.strictEqual(shellNoToken.output.error, 'confirmation_required');
console.log('  ✓ shell rejected without token with confirmation_required');

// 5. shell: with valid confirmationToken -> runs successfully
console.log('[Test 5] Testing shell executes with valid signed confirmationToken...');
const validToken = signConfirmationToken('shell', { command: 'echo hello_world' });
const shellWithToken = checkTool(
  'tools/io/shell.js',
  { command: 'echo hello_world' },
  { workspaceDir, confirmationToken: validToken }
);
assert.strictEqual(shellWithToken.output.error, null);
assert.strictEqual(shellWithToken.output.result, 'hello_world');
console.log('  ✓ shell executed successfully with signed confirmationToken');

// 6. shell: command not in allowlist or matching blocklist
console.log('[Test 6] Testing shell blocks blocked command even with token...');
const shellBlockedCmd = checkTool(
  'tools/io/shell.js',
  { command: 'rm -rf /' },
  { workspaceDir, confirmationToken: validToken }
);
assert.ok(shellBlockedCmd.output.error.includes('blocklist'));
console.log('  ✓ shell rejected blocked command matching blocklist');

// Clean up test file
if (fs.existsSync(testFilePath)) {
  fs.unlinkSync(testFilePath);
}

console.log('\n>>> STEP 7 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
