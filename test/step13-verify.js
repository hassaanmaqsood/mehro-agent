import assert from 'assert';
import { MehroTUI } from '../tui/tui.js';
import logger from '../src/logger.js';
import { initStore, closeStore, auditRepo } from '../runtime/store.js';

console.log('=== Step 13 Verification: Terminal User Interface (MehroTUI) ===');

initStore(':memory:');

// 1. Test instantiation in headless mode
console.log('[Test 1] Testing MehroTUI instantiation...');
const tui = new MehroTUI({ headless: true, approvalMode: 'review' });
assert.ok(tui, 'MehroTUI instance must be created');
assert.strictEqual(tui.approvalMode, 'review');
console.log('  ✓ MehroTUI instantiated with approvalMode: review');

// 2. Test logger subscription without overriding console.log
console.log('[Test 2] Testing logger subscription separation...');
const originalConsoleLog = console.log;
let receivedLog = null;

tui.onLogEntry = (entry) => {
  receivedLog = entry;
};

logger.info('TUI event test message');
assert.strictEqual(console.log, originalConsoleLog, 'console.log must NOT be overridden');
assert.strictEqual(receivedLog?.message, 'TUI event test message');
console.log('  ✓ Logger events received by TUI while console.log remains pristine');

// 3. Test simulated [Y] Approve
console.log('[Test 3] Testing simulated [Y] Approve response...');
const resY = tui._handleDecision('yes', 'shell', { command: 'npm test' });
assert.strictEqual(resY.action, 'yes');
assert.strictEqual(resY.approved, true);
assert.deepStrictEqual(resY.input, { command: 'npm test' });
console.log('  ✓ [Y] Approve returned approved: true');

// 4. Test simulated [N] Reject
console.log('[Test 4] Testing simulated [N] Reject response...');
const resN = tui._handleDecision('no', 'shell', { command: 'rm -rf /' });
assert.strictEqual(resN.action, 'no');
assert.strictEqual(resN.approved, false);
console.log('  ✓ [N] Reject returned approved: false');

// 5. Test simulated [E] Edit
console.log('[Test 5] Testing simulated [E] Edit response & audit logging...');
const originalInput = { command: 'npm run test-all' };
const editedInput = { command: 'npm test' };

const resE = tui._handleDecision('edit', 'shell', originalInput, editedInput);
assert.strictEqual(resE.action, 'edit');
assert.strictEqual(resE.approved, true);
assert.deepStrictEqual(resE.edited, editedInput);
assert.deepStrictEqual(resE.original, originalInput);

// Verify audit log has recorded both original and edited inputs
const auditRows = auditRepo.query({ toolId: 'shell' });
assert.ok(auditRows.length > 0, 'Audit record must be created for edited tool');
const latestAudit = auditRows[0];
const parsedAuditInput = JSON.parse(latestAudit.input_json);
assert.deepStrictEqual(parsedAuditInput.original, originalInput);
assert.deepStrictEqual(parsedAuditInput.edited, editedInput);
assert.strictEqual(latestAudit.status, 'edited_and_approved');
console.log('  ✓ [E] Edit logged both original and edited inputs to SQLite audit store');

// 6. Test simulated [A] All
console.log('[Test 6] Testing simulated [A] All response...');
const resA = tui._handleDecision('all', 'shell', { command: 'ls' });
assert.strictEqual(resA.action, 'all');
assert.strictEqual(resA.approved, true);
assert.strictEqual(tui.approvalMode, 'allow-all', 'Approval mode must switch to allow-all');
console.log('  ✓ [A] All approved call and switched session mode to allow-all');

tui.destroy();
closeStore();
console.log('\n>>> STEP 13 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
