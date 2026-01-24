/**
 * DEMO - Simple demonstration of SSV Agent
 */

const { SSVAgent, AgentConfig } = require('./agent.js');

async function runDemo() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           SSV AGENT - SIMPLE DEMONSTRATION                 ║');
    console.log('║        State • Strict Schema • Vote Framework              ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Configure agent
    const config = new AgentConfig();
    config.useVoting = false; // Disable voting for faster demo
    config.clarifyUnclearTasks = false; // Disable clarification for demo
    config.verboseLogging = true;

    // Create and initialize agent
    const agent = new SSVAgent(config);
    await agent.initialize(); // No model - will use mock mode

    console.log('\n📋 DEMONSTRATION TASKS:');
    console.log('   1. Search for capital of France');
    console.log('   2. Calculate 42 * 8');
    console.log('   3. Get current time');
    console.log('   4. Save Python hello world to file\n');

    // Execute tasks
    const tasks = [
        "What is the capital of France?",
        "Calculate 42 * 8",
        "Get current time",
        "save print('Hello, World!') to hello.py file"
    ];

    const finalState = await agent.executeTasks(tasks);

    // Save state
    const fs = require('fs');

    const path = require('path');
    const outputPath = path.join(__dirname, './final_state.json');
    fs.writeFileSync(
        outputPath,
        finalState.export()
    );

    console.log('\n✅ Demo complete! State saved to demo_state.json\n');

    await agent.shutdown();
}

// Run demo
if (require.main === module) {
    runDemo().catch(error => {
        console.error('Demo error:', error);
        process.exit(1);
    });
}

module.exports = { runDemo };