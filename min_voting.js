/**
 * MINIMAL VOTING TEST - 2 Samples Only
 * Test voting with minimal samples to reduce sequence pressure
 */

const { SSVAgent, AgentConfig } = require('./agent.js');

async function runMinimalVotingTest() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     MINIMAL VOTING TEST - 2 Samples                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Configure agent with MINIMAL voting
    const config = new AgentConfig();
    config.useVoting = true;
    config.voteConfig.samplesPerVote = 2; // Reduced from 3
    config.voteConfig.consensusThreshold = 0.51; // 51% = just need majority of 2
    config.clarifyUnclearTasks = false; // Skip clarification to reduce calls
    config.verboseLogging = true;

    // Create and initialize agent
    const agent = new SSVAgent(config);

    const modelPath = process.argv[2] || null;
    if (!modelPath) {
        console.log('[TEST] ERROR: Please provide model path');
        console.log('[TEST] Usage: node minimal-voting-test.js /path/to/model.gguf');
        process.exit(1);
    }

    await agent.initialize(modelPath);

    console.log('\n📋 TEST TASKS:');
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
            './minimal_voting_state.json',
            finalState.export()
        );

        console.log('\n✅ Test complete! State saved to minimal_voting_state.json\n');
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await agent.shutdown();
    }
}

// Run test
if (require.main === module) {
    runMinimalVotingTest().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { runMinimalVotingTest };