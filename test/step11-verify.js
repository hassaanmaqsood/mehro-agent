import assert from 'assert';
import { createNodaicSystem } from '../engine/nodaic_minimal.js';
import { WorkflowScheduler } from '../engine/nodaic_scheduler.js';
import { workflowRegistry } from '../runtime/workflows.js';
import { resolveCommand } from '../runtime/commands.js';
import { setSystemContext } from '../runtime/dispatch.js';
import { initStore, closeStore } from '../runtime/store.js';

// Import tools used by daily-standup
import taskListTool from '../tools/tasks/task-list.js';
import logTool from '../tools/core/log.js';

console.log('=== Step 11 Verification: Workflow System & Slash Commands ===');

initStore(':memory:');
const { library } = createNodaicSystem();
const scheduler = new WorkflowScheduler(library);

// Register tools
library.addArtifact(taskListTool);
library.addArtifact(logTool);

// Register workflows
workflowRegistry.loadDirs(['./workflows/builtin'], library, scheduler);
setSystemContext({ library, scheduler, config: { model: { provider: 'mock' } } });

// 1. Test resolving /standup slash command
console.log('[Test 1] Testing /standup resolution and execution...');
const standupRes = await resolveCommand('/standup core-team');

assert.strictEqual(standupRes.isSlash, true);
assert.strictEqual(standupRes.type, 'workflow');
assert.strictEqual(standupRes.workflow, 'daily-standup');
assert.strictEqual(standupRes.inputs.team, 'core-team');
assert.strictEqual(standupRes.success, true);
console.log('  ✓ /standup resolved and executed successfully');

// 2. Test workflow input parameter schema validation
console.log('[Test 2] Testing workflow input parameter schema validation...');
workflowRegistry.registerWorkflow({
  name: 'strict-deploy',
  trigger: { slash: '/deploy' },
  inputs: [
    { name: 'service', type: 'string', required: true },
    { name: 'replicas', type: 'number', default: 3 }
  ],
  graph: `
graph workflows/strict-deploy
node log @tools/core/log:1.0.0
  state message = "Deployed"
node sink @flow/merge:1.0.0
log -> sink
`
}, library, scheduler);

// Test missing required input
const missingRes = await resolveCommand('/deploy');
assert.strictEqual(missingRes.success, false);
assert.ok(missingRes.error.includes('Missing required workflow input: service'));
console.log('  ✓ Missing required parameter was caught: ' + missingRes.error);

// Test invalid type validation
const invalidNumRes = await resolveCommand('/deploy service=backend replicas=not_a_number');
assert.strictEqual(invalidNumRes.success, false);
assert.ok(invalidNumRes.error.includes("must be a number"));
console.log('  ✓ Type mismatch was caught: ' + invalidNumRes.error);

// Test valid inputs with default applied
const validDeployRes = await resolveCommand('/deploy auth-service');
assert.strictEqual(validDeployRes.success, true);
assert.strictEqual(validDeployRes.inputs.service, 'auth-service');
assert.strictEqual(validDeployRes.inputs.replicas, 3);
console.log('  ✓ Valid inputs accepted with default value applied');

// 3. Test built-in slash commands
console.log('[Test 3] Testing built-in slash commands (/task, /approval, /tools)...');
const taskRes = await resolveCommand('/task Create release checklist');
assert.strictEqual(taskRes.success, true);
assert.strictEqual(taskRes.task.prompt, 'Create release checklist');

const session = {};
const approvalRes = await resolveCommand('/approval review', session);
assert.strictEqual(approvalRes.success, true);
assert.strictEqual(session.sessionApprovalMode, 'review');

const toolsRes = await resolveCommand('/tools');
assert.strictEqual(toolsRes.success, true);
assert.ok(Array.isArray(toolsRes.tools));

const unknownRes = await resolveCommand('/unknowncmd');
assert.strictEqual(unknownRes.success, false);
assert.ok(unknownRes.error.includes('Unknown command'));
console.log('  ✓ Builtin slash commands (/task, /approval, /tools) verified');

closeStore();
console.log('\n>>> STEP 11 VERIFICATION PASSED SUCCESSFULLY! <<<\n');
