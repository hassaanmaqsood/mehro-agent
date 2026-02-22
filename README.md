# Mehro Agent

An AI agent powered by **Google Gemini** that generates and executes Directed Acyclic Graphs (DAGs) for deterministic, multi-step task execution with strict schema validation and intelligent rate limiting.

## Features

✅ **DAG-Based Execution** - Tasks decomposed into step chains with explicit dependencies  
✅ **Strict Schema Validation** - Gemini 2.5 Flash enforces JSON schema compliance  
✅ **Smart Rate Limiting** - Automatic API quota management with safety margins  
✅ **Runtime Type Checking** - Zod-based parameter validation for all functions  
✅ **Seven Pre-defined Functions** - log, calculate, read_file, write_file, http_request, string_transform, delay  
✅ **Google Gemini API** - Powers intelligence via gemini-2.5-flash model  
✅ **Full Verbose Logging** - Complete visibility into execution, API usage, and rate limits  

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Mehro Agent                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  TASK QUEUE  │  │  RATE LIMITS │  │  VALIDATION  │   │
│  │              │  │              │  │              │   │
│  │ Maintain     │  │ API quota    │  │ JSON Schema  │   │
│  │ pending      │  │ management   │  │ + Zod        │   │
│  │ tasks        │  │ w/ safety    │  │ schemas      │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│       │                   │                   │         │
│       └───────────────────┼───────────────────┘         │
│                           │                             │
│                ┌──────────▼──────────┐                  │
│                │  TASK EXECUTOR      │                  │
│                │                     │                  │
│                │ • Parse LLM output  │                  │
│                │ • Build DAG         │                  │
│                │ • Execute steps     │                  │
│                │ • Handle retries    │                  │
│                └──────────┬──────────┘                  │
│                           │                             │
│              ┌────────────┴───────────┐                 │
│              │                        │                 │
│         ┌────▼─────┐            ┌─────▼─────┐           │
│         │  GEMINI  │            │  FUNCTIONS│           │
│         │  API     │            │           │           │
│         │          │            │ • log     │           │
│         │ 2.5      │            │ • calc    │           │
│         │ Flash    │            │ • files   │           │
│         └──────────┘            │ • http    │           │
│                                 │ • string  │           │
│                                 │ • delay   │           │
│                                 └───────────┘           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js v18+
- Google Gemini API key (free tier available at [AI Studio](https://aistudio.google.com))

### Setup

```bash
cd mehro-agent
npm install
```

### Configuration

Create a `.env` file in the root directory:

```bash
GEMINI_API_KEY=your_api_key_here
```

To get an API key:
1. Visit [Google AI Studio](https://aistudio.google.com)
2. Click "Get API Key"
3. Create a new API key in Google Cloud project
4. Copy and add to `.env`

## Usage

### Running the Agent

```bash
npm start
```

This will execute the agent with the default task queue. Edit the task definitions in `index.js` to customize:

```javascript
[
    "What is the capital of Pakistan",
    "Calculate 15 multiplied by 8",
    "Convert 'Hello World' to uppercase",
    "Write a hello world program to a file called hello.js",
].forEach(userPrompt => {
    // Tasks are queued for execution
});
```

### Example Output

```
[USAGE] Daily: 1/10, Requests: 1/1, Input: 245/50000, Output: 198/50000, Thoughts: 0
[LOG] The capital of Pakistan is Islamabad.
[CALCULATE] 15 * 8 = 120
[STRING_TRANSFORM] uppercase applied
[WRITE_FILE] Wrote to hello.js

[DONE] All tasks processed:
  t_abc123_def: success - "What is the capital of Pakistan"
  t_xyz789_ghi: success - "Calculate 15 multiplied by 8"
  t_pqr456_stu: success - "Convert 'Hello World' to uppercase"
  t_mno234_vwx: success - "Write a hello world program to a file called hello.js"
```

## Project Structure

```
mehro-agent/
├── index.js          # Main agent with task queue and executor
├── package.json      # Dependencies and scripts
├── .env              # Environment variables (GEMINI_API_KEY)
└── README.md         # This file
```

### Key Components in index.js

- **Task Queue**: Array of tasks waiting to be executed
- **Rate Limiting**: Automatic quota tracking and management
- **Model Wrapper**: Interface to Google Gemini API with schema enforcement
- **DAG Executor**: Parses and executes task execution plans
- **Functions Registry**: Pre-defined functions available to the agent

## Configuration

### Rate Limiting

The agent automatically manages API rate limits with safety margins (9% of API limits by default):

```javascript
// Configurable in index.js
let perMinuteModelRequestsLimit = 1;       // Requests per minute
let perMinuteInputTokensLimit = 50e3;      // Input tokens per minute
let perMinuteOutputTokensLimit = 50e3;     // Output tokens per minute
let perDayRequestsLimit = 10;              // Requests per day
```

**Safety Margin**: System limits are automatically set to 9% of API-imposed limits to prevent hitting hard quotas.

### API Limits

Limits are discovered dynamically from API responses and automatically adjusted:

```javascript
const apiLimits = {
    perMinuteRequests: null,           // Discovered from API
    perDayRequests: null,              // Discovered from API
    perMinuteInputTokens: null,        // Discovered from API
    perMinuteOutputTokens: null,       // Discovered from API
};
```

When a rate limit is hit, the agent automatically waits and retries.

## Available Functions

The agent can use these pre-defined functions:

| Function | Description | Parameters |
|----------|-------------|------------|
| `log` | Log a message to console | `message: string` |
| `calculate` | Evaluate mathematical expressions | `expression: string` |
| `read_file` | Read file contents | `filepath: string` |
| `write_file` | Write content to a file | `filepath: string, content: string` |
| `http_request` | Make HTTP GET/POST requests | `url: string, method?: string` |
| `string_transform` | Transform strings (uppercase, lowercase, reverse, length) | `text: string, operation: enum` |
| `delay` | Wait for specified milliseconds | `milliseconds: number` |

Each function has:
- **Runtime Validation**: Zod schema validation of parameters
- **Error Handling**: Graceful error responses
- **Logging**: Automatic operation logging to console

## How It Works

### 1. Task Queueing

Tasks are added to a queue with metadata:

```javascript
{
    id: "t_abc123",
    userPrompt: "What is the capital of Pakistan?",
    status: "pending",           // pending, ongoing, success, failed
    maxAttempts: 5,
    attempts: 0,
    response: "",
    error: null,
}
```

### 2. Rate Limit Management

Before each API call:
- Check per-minute request count
- Check input/output token usage
- Check daily request quota
- Auto-adjust limits based on API responses
- Wait if limits are exceeded

```javascript
const limitCheck = checkRateLimits(estimatedInputTokens);
if (limitCheck.limited) {
    await sleep(waitTime); // 60 seconds or 24 hours
    continue; // Retry
}
```

### 3. LLM Prompt Generation

The agent generates a structured prompt with available functions:

```javascript
const prompt = `You are an AI agent that generates execution plans as DAGs.

User Request: ${task.userPrompt}

Available Functions:
${JSON.stringify(functionSchemas, null, 2)}

Output JSON structure:
{
    "thought_process": "reasoning here",
    "dag": [
        {
            "id": "1",
            "function": "function_name",
            "parameters": { "param": "value" },
            "dependencies": []
        }
    ]
}`;
```

### 4. Strict Schema Validation

Gemini API enforces response format:
- All outputs are valid JSON
- Each function has specific parameter requirements
- Extra parameters are forbidden
- Type mismatches are rejected

### 5. DAG Execution

The agent parses and executes the task execution plan:

```javascript
// Execute each step with dependency resolution
for (const step of dag) {
    // Validate function exists
    if (!functions[step.function]) {
        throw new Error(`${step.function} not available`);
    }
    
    // Validate parameters with Zod
    const validatedParams = functionSchemas[step.function].parse(resolvedParams);
    
    // Execute and store result
    const result = await functions[step.function].function(validatedParams, context);
    context.results[step.id] = result;
}
```

### 6. Retry Logic

Failed tasks are retried up to `maxAttempts`:
- Parse errors → retry with pending status
- Execution errors → retry if attempts < maxAttempts
- Rate limit errors → wait and retry

## Example Task Execution

Input tasks:

```javascript
[
  "What is the capital of Pakistan",
  "Calculate 15 multiplied by 8",
  "Convert 'Hello World' to uppercase",
  "Write a hello world program to a file called hello.js"
]
```

Agent execution flow for each task:

```
Task 1: "What is the capital of Pakistan"
  ├─ Parse prompt and check rate limits ✅
  ├─ Generate LLM prompt with available functions
  ├─ Call Gemini 2.5 Flash API
  ├─ Validate schema enforcement ✅
  ├─ LLM response: {"thought_process": "...", "dag": [{"id": "1", "function": "log", "parameters": {"message": "The capital of Pakistan is Islamabad."}, "dependencies": []}]}
  ├─ Parse and execute DAG ✅
  ├─ Call log({message: "The capital of Pakistan is Islamabad."})
  └─ Result: success ✅

Task 2: "Calculate 15 multiplied by 8"
  ├─ Rate limit check ✅
  ├─ Generate prompt
  ├─ Gemini response: {"thought_process": "...", "dag": [{"id": "1", "function": "calculate", "parameters": {"expression": "15 * 8"}, "dependencies": []}]}
  ├─ Execute DAG ✅
  ├─ Call calculate({expression: "15 * 8"}) → returns 120
  └─ Result: success ✅

Task 3: "Convert 'Hello World' to uppercase"
  ├─ Rate limit check ✅
  ├─ Gemini response: {"thought_process": "...", "dag": [{"id": "1", "function": "string_transform", "parameters": {"text": "Hello World", "operation": "uppercase"}, "dependencies": []}]}
  ├─ Execute DAG ✅
  └─ Result: success ✅

Task 4: "Write a hello world program to a file called hello.js"
  ├─ Rate limit check ✅
  ├─ Gemini response DAG with 2 steps:
  │   Step 1: log - Provide Python/JS code
  │   Step 2: write_file - Write code to hello.js (depends on Step 1)
  ├─ Execute DAG with dependency resolution ✅
  └─ Result: success ✅
```

## Output

The agent logs detailed execution information to console:

```
[USAGE] Daily: 1/10, Requests: 1/1, Input: 362/50000, Output: 287/50000, Thoughts: 0
[LOG] The capital of Pakistan is Islamabad.
[CALCULATE] 15 * 8 = 120
[STRING_TRANSFORM] uppercase applied
[WRITE_FILE] Wrote to hello.js

[DONE] All tasks processed:
  t_abc123_def: success - "What is the capital of Pakistan"
  t_xyz789_ghi: success - "Calculate 15 multiplied by 8"
  t_pqr456_stu: success - "Convert 'Hello World' to uppercase"
  t_mno234_vwx: success - "Write a hello world program to a file called hello.js"
```

When a task fails:

```
[DONE] All tasks processed:
  t_abc123_def: failed - "Some task"
    Error: Maximum attempts exceeded
```

Rate limit handling:

```
[RATE LIMIT] Hit request count limit. Waiting 60 seconds...
[API RATE LIMIT] per-minute limit exceeded
[API RATE LIMIT] Quota: requests_per_minute
[API RATE LIMIT] API Limit: 15, waiting 60s...
[LIMITS] Updated per-minute requests: API=15, System=1
```  

## Future Enhancements (Planned)

- [ ] Interactive task input via CLI
- [ ] Persistent task history and logs
- [ ] Custom function registration API
- [ ] Multi-model execution (fallback models)
- [ ] Web dashboard for monitoring
- [ ] Context window optimization
- [ ] Advanced error recovery strategies
- [ ] Performance metrics and analytics

## Troubleshooting

### "Cannot find module '@google/genai'"

Run `npm install` to ensure all dependencies are installed.

### "GEMINI_API_KEY not found"

- Create a `.env` file in the root directory with your API key
- Format: `GEMINI_API_KEY=your_key_here`
- Restart the agent

### "Task keeps failing with parse error"

The LLM output didn't conform to the JSON schema. This can happen if:
- Model is distracted or generating text instead of JSON
- Schema is too restrictive for the model
- Try reducing task complexity

### "Rate limit exceeded"

The agent hit API quotas. Check:
- Daily request limit (default: 10 requests/day)
- Per-minute request limit (auto-adjusted based on API response)
- Per-minute token limits

The agent automatically waits and retries when hitting limits.

### "API response contains invalid JSON"

The Gemini API with schema enforcement should prevent this. If it occurs:
- Check `console.error` output for detailed error message
- Verify `.env` has correct `GEMINI_API_KEY`
- Try again (transient API issue)

### "File operations fail"

- Ensure file paths are absolute or relative from workspace root
- Check file permissions
- Verify enough disk space available


## Key Design Decisions

### Why DAG-Based Execution?

DAGs (Directed Acyclic Graphs) provide:
- **Explicit Dependencies**: Steps clearly declare what they depend on
- **Parallelizability**: Independent steps can run in parallel (future enhancement)
- **Debuggability**: Clear execution order visible in logs
- **Schema Validation**: Each step's schema is independently verifiable

### Why Gemini 2.5 Flash?

- Fast inference for quick responses
- Native JSON schema support for strict validation
- Excellent cost-to-performance ratio
- Built-in safety features prevent malformed output

### Why Strict Schema Validation?

- **Zero Ambiguity**: If output doesn't match schema, reject it
- **No Hallucination**: LLM can't add extra parameters or fields
- **Type Safety**: Runtime validation with Zod
- **Predictable Behavior**: Agent behavior is deterministic given the same inputs

### Rate Limiting Strategy

The 9% safety margin ensures:
- **Never Hit Hard Limits**: System detects and backs off before API rejects
- **Automatic Adjustment**: Limits adapt based on actual API responses
- **Graceful Degradation**: Tasks wait and retry rather than failing

## References

- [Google Gemini API Documentation](https://ai.google.dev/)
- [Zod Schema Validation](https://zod.dev/)
- [DAG (Directed Acyclic Graph)](https://en.wikipedia.org/wiki/Directed_acyclic_graph)

---

**Built with ❤️ using Gemini API**