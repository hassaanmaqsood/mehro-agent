/**
 * SIMPLE TEST - No Voting, Debug Sequences
 * Use this to test if the model works without voting overhead
 */

const { SSVAgent, AgentConfig } = require('./agent.js');

async function runSimpleTest() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     SIMPLE TEST - Single Sample (No Voting)                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Configure agent - DISABLE VOTING for testing
    const config = new AgentConfig();
    config.useVoting = false; // No voting = only 1 sequence needed
    config.clarifyUnclearTasks = false; // Skip clarification
    config.verboseLogging = true;

    // Create and initialize agent
    const agent = new SSVAgent(config);

    const modelPath = process.argv[2] || null;
    if (!modelPath) {
        console.log('[TEST] ERROR: Please provide model path');
        console.log('[TEST] Usage: node simple-test.js /path/to/model.gguf');
        process.exit(1);
    }

    await agent.initialize(modelPath);

    console.log('\n📋 TEST TASKS (Simple):');
    console.log('   1. What is the capital of France?\n');

    // Execute ONE simple task
    const tasks = [
        "What is the capital of France?"
    ];

    try {
        const finalState = await agent.executeTasks(tasks);

        // Save state
        const fs = require('fs');
        fs.writeFileSync(
            './simple_test_state.json',
            finalState.export()
        );

        console.log('\n✅ Test complete! State saved to simple_test_state.json\n');
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await agent.shutdown();
    }
}

// Run test
if (require.main === module) {
    runSimpleTest().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { runSimpleTest };