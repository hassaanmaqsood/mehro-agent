/**
 * SSV AGENT - Main Entry Point
 * Simple and Functional AI Agent with State, Schema, and Vote
 */

const { SSVAgent, AgentConfig } = require('./agent.js');

/**
 * Main execution function
 */
async function main() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         SSV AGENT - Zero-Hallucination Task Executor       ║');
    console.log('║                State • Schema • Vote                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Create agent configuration
    const config = new AgentConfig();
    config.useVoting = true; // Enable consensus voting
    config.voteConfig.samplesPerVote = 3; // 3 samples per vote
    config.voteConfig.consensusThreshold = 0.66; // 66% consensus required
    config.clarifyUnclearTasks = true; // Auto-clarify vague tasks
    config.verboseLogging = true;

    // Create agent
    const agent = new SSVAgent(config);

    // Initialize (with or without model path)
    // For testing without a model, pass null
    const modelPath = process.argv[2] || null;

    if (modelPath) {
        console.log(`[MAIN] Using model: ${modelPath}`);
    } else {
        console.log('[MAIN] No model specified - running in MOCK MODE');
        console.log('[MAIN] To use a real model, run: node index.js <path-to-gguf-model>');
    }

    await agent.initialize(modelPath);

    // Define task list
    const tasks = [
        "What is the capital of France?",
        "Calculate 25 * 4",
        "Write a hello world program in Python and save it to a file",
        "Create a comprehensive data analysis report with charts",
        "Get current time"
    ];

    console.log('\n[MAIN] 📋 Task List:');
    tasks.forEach((task, idx) => {
        console.log(`  ${idx + 1}. ${task}`);
    });

    // Execute tasks
    try {
        const finalState = await agent.executeTasks(tasks);

        // Export final state
        console.log('\n[MAIN] 💾 Exporting final state...');
        const stateJson = finalState.export();

        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname,'./final_state.json');
        fs.writeFileSync(outputPath, stateJson);
        console.log(`[MAIN] ✅ State saved to: ${outputPath}`);

    } catch (error) {
        console.error('\n[MAIN] ❌ Error during execution:', error.message);
        console.error(error.stack);
    } finally {
        // Cleanup
        await agent.shutdown();
    }

    console.log('\n[MAIN] 🎉 Execution complete!\n');
}

// Run main function
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { main };