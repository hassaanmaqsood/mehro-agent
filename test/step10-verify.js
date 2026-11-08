import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { mask } from '../tools/privacy/mask.js';
import { unmask } from '../tools/privacy/unmask.js';
import { initStore, closeStore } from '../runtime/store.js';

console.log('=== Step 10 Verification: Task Manager & Privacy Processes ===');

// 1. Privacy roundtrip test (callable helpers)
console.log('[Test 1] Testing privacy layer mask & unmask roundtrip...');
const originalText = 'Contact Alice at alice@acme.com or phone +1-415-555-2671 using key sk-1234567890abcdef1234567890 with employee ID EMP-654321 for confidential project.';
const customPatterns = [{ name: 'internal_id', regex: 'EMP-[0-9]{6}' }];

const { masked, vault } = mask(originalText, customPatterns);
console.log('  Masked output: ' + masked);

assert.ok(!masked.includes('alice@acme.com'), 'Email must be masked');
assert.ok(!masked.includes('415-555-2671'), 'Phone must be masked');
assert.ok(!masked.includes('sk-1234567890abcdef1234567890'), 'API key must be masked');
assert.ok(!masked.includes('EMP-654321'), 'Custom pattern must be masked');

const restored = unmask(masked, vault);
assert.strictEqual(restored, originalText, 'Unmask must perfectly restore original text');
console.log('  ✓ Helper functions roundtrip verified: unmask(mask(text).masked, vault) === text');

// 2. Privacy roundtrip via nodaic_check.js
console.log('[Test 2] Testing privacy processes via nodaic_check.js...');
const maskCmd = `node nodaic_check.js tools/privacy/mask.js --input '${JSON.stringify({
  text: 'Secret email bob@test.com with API key sk-99999999999999999999'
})}'`;
const maskStdout = execSync(maskCmd, { encoding: 'utf8' });
const maskResult = JSON.parse(maskStdout);

assert.strictEqual(maskResult.output.error, null);
const maskedFromTool = maskResult.output.result.masked;
const vaultFromTool = maskResult.output.result.vault;
assert.ok(!maskedFromTool.includes('bob@test.com'));

const unmaskCmd = `node nodaic_check.js tools/privacy/unmask.js --input '${JSON.stringify({
  text: maskedFromTool,
  vault: vaultFromTool
})}'`;
const unmaskStdout = execSync(unmaskCmd, { encoding: 'utf8' });
const unmaskResult = JSON.parse(unmaskStdout);

assert.strictEqual(unmaskResult.output.error, null);
assert.strictEqual(unmaskResult.output.result, 'Secret email bob@test.com with API key sk-99999999999999999999');
console.log('  ✓ Process artifacts mask.js and unmask.js passed via nodaic_check.js');

// 3. Task persistence across store reload
console.log('[Test 3] Testing task persistence across SQLite store reload...');
const testDbPath = path.resolve('./workspace/tasks-persistence-test.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

// Initialize store in file
initStore(testDbPath);

// Create task 1
const createCmd1 = `node nodaic_check.js tools/tasks/task-create.js --input '${JSON.stringify({
  prompt: 'Task One to persist'
})}' --state '${JSON.stringify({ dbPath: testDbPath })}'`;
const res1 = JSON.parse(execSync(createCmd1, { encoding: 'utf8' }));
const task1Id = res1.output.result.id;
assert.ok(task1Id, 'Task 1 must have UUID id');

// Create task 2
const createCmd2 = `node nodaic_check.js tools/tasks/task-create.js --input '${JSON.stringify({
  prompt: 'Task Two to persist'
})}' --state '${JSON.stringify({ dbPath: testDbPath })}'`;
const res2 = JSON.parse(execSync(createCmd2, { encoding: 'utf8' }));
const task2Id = res2.output.result.id;
assert.ok(task2Id, 'Task 2 must have UUID id');

// Close the store
closeStore();

// Re-open the store at the same DB file
initStore(testDbPath);

// List tasks after reload
const listCmd = `node nodaic_check.js tools/tasks/task-list.js --input '{}' --state '${JSON.stringify({ dbPath: testDbPath })}'`;
const listRes = JSON.parse(execSync(listCmd, { encoding: 'utf8' }));

assert.strictEqual(listRes.output.error, null);
assert.strictEqual(listRes.output.result.total, 2);
const ids = listRes.output.result.tasks.map(t => t.id);
assert.ok(ids.includes(task1Id), 'Task 1 survived store reload');
assert.ok(ids.includes(task2Id), 'Task 2 survived store reload');
console.log('  ✓ Tasks survived SQLite store reload intact');

// Update task 1
const updateCmd = `node nodaic_check.js tools/tasks/task-update.js --input '${JSON.stringify({
  id: task1Id,
  status: 'completed',
  output: { success: true }
})}' --state '${JSON.stringify({ dbPath: testDbPath })}'`;
const updateRes = JSON.parse(execSync(updateCmd, { encoding: 'utf8' }));
assert.strictEqual(updateRes.output.error, null);
assert.strictEqual(updateRes.output.result.status, 'completed');

// Delete task 2
const deleteCmd = `node nodaic_check.js tools/tasks/task-delete.js --input '${JSON.stringify({
  id: task2Id
})}' --state '${JSON.stringify({ dbPath: testDbPath })}'`;
const deleteRes = JSON.parse(execSync(deleteCmd, { encoding: 'utf8' }));
assert.strictEqual(deleteRes.output.error, null);
assert.strictEqual(deleteRes.output.result.deleted, true);

// Verify count is now 1
const listFinal = JSON.parse(execSync(listCmd, { encoding: 'utf8' }));
assert.strictEqual(listFinal.output.result.total, 1);
assert.strictEqual(listFinal.output.result.tasks[0].id, task1Id);
console.log('  ✓ Task update and delete verified over SQLite');

closeStore();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

console.log('\n>>> STEP 10 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
