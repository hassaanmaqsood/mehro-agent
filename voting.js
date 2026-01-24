/**
 * VOTE MODULE - Multi-sample Consensus Mechanism
 * Since we're using local models, we vote with multiple samples (temperature > 0)
 */

/**
 * Vote Configuration
 */
class VoteConfig {
    constructor() {
        this.samplesPerVote = 3; // Number of samples to generate
        this.consensusThreshold = 0.66; // 66% agreement required
        this.temperature = 0.7; // Temperature for diversity
        this.maxTokens = 512;
    }
}

/**
 * Vote Result
 */
class VoteResult {
    constructor() {
        this.consensusReached = false;
        this.winningOutput = null;
        this.voteDistribution = {};
        this.confidence = 0.0;
        this.allOutputs = [];
        this.dissentingOutputs = [];
    }
}

/**
 * Semantic equivalence check for outputs
 * Simple version: normalize and compare key fields
 */
function areSemanticallySimilar(output1, output2, schemaName) {
    // For TaskClarification
    if (schemaName === 'TaskClarification') {
        return output1.is_clear === output2.is_clear &&
            normalizeText(output1.clarified_task) === normalizeText(output2.clarified_task);
    }

    // For TaskDecomposition
    if (schemaName === 'TaskDecomposition') {
        return output1.is_atomic === output2.is_atomic &&
            output1.subtasks.length === output2.subtasks.length;
    }

    // For TaskExecution
    if (schemaName === 'TaskExecution') {
        return output1.status === output2.status &&
            normalizeText(output1.result) === normalizeText(output2.result);
    }

    // For FunctionCall
    if (schemaName === 'FunctionCall') {
        return output1.function_name === output2.function_name;
    }

    return false;
}

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

/**
 * Perform voting with multiple samples
 */
async function performVote(llmFunction, prompt, schemaName, config = new VoteConfig()) {
    console.log(`\n[VOTE] 🗳️  Starting vote with ${config.samplesPerVote} samples...`);
    console.log(`[VOTE] Schema: ${schemaName}`);
    console.log(`[VOTE] Consensus threshold: ${config.consensusThreshold}`);

    const result = new VoteResult();
    const validOutputs = [];

    // Generate multiple samples
    for (let i = 0; i < config.samplesPerVote; i++) {
        console.log(`\n[VOTE] Sample ${i + 1}/${config.samplesPerVote}:`);

        try {
            const output = await llmFunction(prompt, {
                temperature: config.temperature,
                maxTokens: config.maxTokens
            });

            result.allOutputs.push(output);

            // Only count valid outputs
            if (output.success && output.data) {
                validOutputs.push(output.data);
                console.log(`[VOTE] ✅ Valid output received`);
            } else {
                console.log(`[VOTE] ❌ Invalid output (schema validation failed)`);
            }
        } catch (error) {
            console.log(`[VOTE] ❌ Error generating sample: ${error.message}`);
        }
    }

    console.log(`\n[VOTE] Valid outputs: ${validOutputs.length}/${config.samplesPerVote}`);

    // Check if we have enough valid samples
    if (validOutputs.length < 2) {
        console.log(`[VOTE] ⚠️  Insufficient valid samples for voting`);
        result.consensusReached = false;
        return result;
    }

    // Group semantically similar outputs
    const groups = [];

    for (const output of validOutputs) {
        let foundGroup = false;

        for (const group of groups) {
            if (areSemanticallySimilar(output, group[0], schemaName)) {
                group.push(output);
                foundGroup = true;
                break;
            }
        }

        if (!foundGroup) {
            groups.push([output]);
        }
    }

    console.log(`[VOTE] Grouped into ${groups.length} semantically similar clusters`);

    // Find largest group
    const largestGroup = groups.reduce((max, group) =>
        group.length > max.length ? group : max
        , []);

    const consensusRatio = largestGroup.length / validOutputs.length;
    console.log(`[VOTE] Largest group size: ${largestGroup.length}/${validOutputs.length} (${(consensusRatio * 100).toFixed(1)}%)`);

    // Check consensus threshold
    if (consensusRatio >= config.consensusThreshold) {
        result.consensusReached = true;
        result.winningOutput = largestGroup[0]; // Take first from winning group
        result.confidence = consensusRatio;
        result.voteDistribution = groups.reduce((dist, group, idx) => {
            dist[`group_${idx}`] = group.length;
            return dist;
        }, {});

        // Identify dissenting outputs
        for (const group of groups) {
            if (group !== largestGroup) {
                result.dissentingOutputs.push(...group);
            }
        }

        console.log(`[VOTE] ✅ CONSENSUS REACHED (${(consensusRatio * 100).toFixed(1)}%)`);
        console.log(`[VOTE] Vote distribution:`, result.voteDistribution);
    } else {
        result.consensusReached = false;
        result.confidence = consensusRatio;
        console.log(`[VOTE] ❌ NO CONSENSUS (${(consensusRatio * 100).toFixed(1)}% < ${(config.consensusThreshold * 100).toFixed(1)}%)`);
    }

    return result;
}

/**
 * Quick vote (single sample - for testing)
 */
async function quickVote(llmFunction, prompt, schemaName) {
    console.log(`\n[QUICK_VOTE] 🎯 Single sample (no consensus)`);

    const output = await llmFunction(prompt, {
        temperature: 0.1,
        maxTokens: 512
    });

    const result = new VoteResult();
    result.allOutputs = [output];

    if (output.success && output.data) {
        result.consensusReached = true;
        result.winningOutput = output.data;
        result.confidence = 1.0;
        console.log(`[QUICK_VOTE] ✅ Valid output received`);
    } else {
        result.consensusReached = false;
        console.log(`[QUICK_VOTE] ❌ Invalid output`);
    }

    return result;
}

module.exports = {
    VoteConfig,
    VoteResult,
    performVote,
    quickVote
};