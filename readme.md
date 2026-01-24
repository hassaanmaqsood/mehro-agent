# SSV Agent - Zero-Hallucination Task Executor

A local AI agent built on the **State, Strict Schema, and Vote (SSV)** framework for deterministic, verifiable task execution.

## Features

✅ **State Management** - Single source of truth for all facts and execution context  
✅ **Strict Schema Validation** - Zero tolerance for unparseable outputs using JSON schemas  
✅ **Consensus Voting** - Multi-sample voting for critical decisions  
✅ **Task Decomposition** - Automatically breaks down complex tasks into subtasks  
✅ **Task Clarification** - Clarifies vague or unclear task requirements  
✅ **Pre-defined Functions** - Built-in tools (RAG, file operations, calculations)  
✅ **Local Models** - Works with TinyLlama, Qwen, or any GGUF model via node-llama-cpp  
✅ **Full Verbose Logging** - Complete visibility into agent decision-making  

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      SSV AGENT                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  STATE   │  │  SCHEMA  │  │   VOTE   │            │
│  │          │  │          │  │          │            │
│  │ Ground   │  │ Validate │  │ Consensus│            │
│  │ Truth    │  │ All      │  │ Multi-   │            │
│  │ Storage  │  │ Outputs  │  │ Sample   │            │
│  └──────────┘  └──────────┘  └──────────┘            │
│       │              │              │                  │
│       └──────────────┴──────────────┘                  │
│                      │                                  │
│              ┌───────▼────────┐                        │
│              │  TASK EXECUTOR │                        │
│              │                │                        │
│              │ • Clarify      │                        │
│              │ • Decompose    │                        │
│              │ • Execute      │                        │
│              └───────┬────────┘                        │
│                      │                                  │
│         ┌────────────┴────────────┐                   │
│         │                         │                    │
│    ┌────▼─────┐           ┌──────▼──────┐           │
│    │   LLM    │           │  FUNCTIONS  │           │
│    │          │           │             │           │
│    │ Local    │           │ • RAG       │           │
│    │ GGUF     │           │ • Files     │           │
│    │ Models   │           │ • Math      │           │
│    └──────────┘           └─────────────┘           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js v18+
- (Optional) GGUF model file (TinyLlama, Qwen, etc.)

### Setup

```bash
cd ssv-agent
npm install
```

## Usage

### Running Without a Model (Mock Mode)

For testing the architecture without downloading a model:

```bash
node index.js
```

This will run in **MOCK MODE** with simulated LLM responses.

### Running With a Local Model

Download a GGUF model (e.g., TinyLlama-1.1B or Qwen2-0.5B):

```bash
# Example: Download TinyLlama
wget https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf

# Run agent with model
node index.js ./tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

## Project Structure

```
ssv-agent/
├── index.js          # Main entry point
├── agent.js          # SSV Agent orchestrator
├── state.js          # State management module
├── schema.js         # Schema validation module
├── voting.js         # Consensus voting module
├── llm.js            # LLM wrapper (node-llama-cpp)
├── functions.js      # Pre-defined functions library
├── package.json      # Dependencies
└── README.md         # This file
```

## Configuration

Edit `index.js` to customize agent behavior:

```javascript
const config = new AgentConfig();

// Enable/disable voting
config.useVoting = true;

// Number of samples per vote
config.voteConfig.samplesPerVote = 3;

// Consensus threshold (0.66 = 66%)
config.voteConfig.consensusThreshold = 0.66;

// Auto-clarify unclear tasks
config.clarifyUnclearTasks = true;

// Maximum decomposition depth
config.maxDecompositionDepth = 3;
```

## Available Functions

The agent can use these pre-defined functions:

| Function | Description | Parameters |
|----------|-------------|------------|
| `search_knowledge` | Search knowledge base (RAG) | `query: string` |
| `calculate` | Perform math calculations | `expression: string` |
| `read_file` | Read file contents | `filepath: string` |
| `write_file` | Write to file | `filepath, content` |
| `list_directory` | List directory contents | `dirpath: string` |
| `get_current_time` | Get current timestamp | none |
| `add_knowledge` | Add fact to knowledge base | `key, value` |

## How It Works

### 1. State Management

All facts and execution context are stored in a persistent state object:

```javascript
{
  verifiedFacts: {
    "knowledge_capital_of_france": {
      value: "Paris",
      source: "search_knowledge",
      timestamp: "2026-01-21T..."
    }
  },
  completedTasks: [...],
  executionLog: [...]
}
```

### 2. Strict Schema Validation

Every LLM output must conform to a predefined JSON schema:

```javascript
// Example: TaskExecution schema
{
  task_id: "task_1",
  status: "completed",
  result: "Paris is the capital of France",
  confidence: 0.95,
  verification_method: "knowledge_base_lookup"
}
```

If output doesn't parse → **RED FLAG** → Discard and retry

### 3. Voting Mechanism

For critical decisions, the agent generates multiple samples and votes:

```
Sample 1: {"result": "Paris", "confidence": 0.9}
Sample 2: {"result": "Paris", "confidence": 0.85}
Sample 3: {"result": "Lyon", "confidence": 0.6}

Vote: 2/3 agree on "Paris" → CONSENSUS REACHED ✅
```

## Example Task Execution

Input tasks:

```javascript
[
  "What is the capital of France?",
  "Calculate 25 * 4",
  "Write a hello world program in Python"
]
```

Execution flow:

```
Task 1: "What is the capital of France?"
  ├─ Clarify: Task is clear ✅
  ├─ Decompose: Task is atomic ✅
  ├─ Function decision: search_knowledge
  ├─ Execute: search_knowledge({query: "capital of france"})
  └─ Result: "Paris" ✅

Task 2: "Calculate 25 * 4"
  ├─ Clarify: Task is clear ✅
  ├─ Decompose: Task is atomic ✅
  ├─ Function decision: calculate
  ├─ Execute: calculate({expression: "25 * 4"})
  └─ Result: 100 ✅

Task 3: "Write a hello world program in Python"
  ├─ Clarify: Task is clear ✅
  ├─ Decompose: Needs decomposition
  │   ├─ Subtask 1: "Create Python code"
  │   └─ Subtask 2: "Save to file"
  └─ Execute both subtasks ✅
```

## Output

Final state is saved to `final_state.json`:

```json
{
  "taskList": [...],
  "verifiedFacts": {...},
  "completedTasks": [...],
  "executionLog": [...],
  "lowConfidenceItems": [...]
}
```

## SSV Checklist (Built-in)

✅ **STATE**: All facts stored in typed state object  
✅ **STATE**: State mutations logged with timestamps  
✅ **STATE**: No regeneration of existing facts  
✅ **SCHEMA**: JSON schemas defined for all outputs  
✅ **SCHEMA**: Validation logic rejects unparseable responses  
✅ **SCHEMA**: No optional fields for critical data  
✅ **VOTE**: Multiple samples for critical decisions  
✅ **VOTE**: Consensus threshold configured  
✅ **VOTE**: Dissenting outputs logged  

## Future Enhancements (Planned)

- [ ] TUI (Terminal User Interface) for interactive task management
- [ ] Prompt user when requirements are vague
- [ ] Embeddable as library in other Node.js projects
- [ ] Exploration/research behaviors for complex queries
- [ ] Multi-model voting (different architectures)
- [ ] Persistent knowledge base (database)
- [ ] Web interface for monitoring
- [ ] Plugin system for custom functions

## Troubleshooting

### "Cannot find module 'node-llama-cpp'"

Run in mock mode first: `node index.js`

Or install dependencies: `npm install`

### "Model loading failed"

Check:

- Model path is correct
- Model file is GGUF format
- Sufficient RAM available (2GB+ for TinyLlama)

### "No consensus reached"

Increase samples or lower threshold:

```javascript
config.voteConfig.samplesPerVote = 5;
config.voteConfig.consensusThreshold = 0.6;
```

## License

ISC

## References

Based on SSV Framework principles:

- State: Single source of truth
- Strict Schema: Zero-tolerance validation
- Vote: Multi-sample consensus

---

**Built with ❤️ for zero-hallucination AI**
