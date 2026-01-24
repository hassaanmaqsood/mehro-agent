/**
 * TEST FILE - SSV Agent Testing Scenarios
 */

const { SSVAgent, AgentConfig } = require('./agent.js');

async function runTests() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║              SSV AGENT - TEST SCENARIOS                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Test 1: Simple atomic tasks
    console.log('\n📌 TEST 1: Simple Atomic Tasks');
    console.log('─'.repeat(60));

    const config1 = new AgentConfig();
    config1.useVoting = false; // Faster for simple tasks

    const agent1 = new SSVAgent(config1);
    await agent1.initialize();

    await agent1.executeTasks([
        "What is the capital of France?",
        "Calculate 15 + 27",
        "Get current time"
    ]);

    await agent1.shutdown();

    // Test 2: Tasks requiring decomposition
    console.log('\n\n📌 TEST 2: Complex Tasks (Decomposition)');
    console.log('─'.repeat(60));

    const config2 = new AgentConfig();
    config2.useVoting = true;
    config2.voteConfig.samplesPerVote = 3;

    const agent2 = new SSVAgent(config2);
    await agent2.initialize();

    await agent2.executeTasks([
        "Create a Python script that prints hello world and save it to hello.py file"
    ]);

    await agent2.shutdown();

    // Test 3: Unclear tasks (clarification needed)
    console.log('\n\n📌 TEST 3: Unclear Tasks (Clarification)');
    console.log('─'.repeat(60));

    const config3 = new AgentConfig();
    config3.clarifyUnclearTasks = true;

    const agent3 = new SSVAgent(config3);
    await agent3.initialize();

    await agent3.executeTasks([
        "do something",
        "make it better",
        "analyze data"
    ]);

    await agent3.shutdown();

    // Test 4: Function calling
    console.log('\n\n📌 TEST 4: Function Calling');
    console.log('─'.repeat(60));

    const config4 = new AgentConfig();

    const agent4 = new SSVAgent(config4);
    await agent4.initialize();

    await agent4.executeTasks([
        "Search for what is machine learning",
        "Calculate 99 * 88",
        "Add to knowledge base that Islamabad is the capital of Pakistan"
    ]);

    await agent4.shutdown();

    console.log('\n\n✅ All tests completed!\n');
}

// Run tests
if (require.main === module) {
    runTests().catch(error => {
        console.error('Test error:', error);
        process.exit(1);
    });
}

module.exports = { runTests };