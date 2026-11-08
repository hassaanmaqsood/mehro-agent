# Mehro Agent - System Architecture

## Phase 1 — DEFINE

**System boundary:** A local-first agentic orchestration runtime that takes natural language tasks, decomposes them into a DAG of tool calls via an LLM planner, executes the DAG with real tools (search, file, shell, HTTP, Elasticsearch, tasks, recursive agents), and returns structured results — with security, privacy, and swappable model providers built into the core, not bolted on.

**What's inside:** planner, DAG engine, tool registry, model adapter, security/privacy layer, task manager, TUI/API interface.

**What's outside:** the LLM models themselves (Ollama, OpenAI, Anthropic), external data stores (ES cluster), the user's filesystem beyond a sandboxed workspace.

**Inputs:** natural language prompt → structured DAG → tool results → final output **Outputs:** task result, audit log, modified files/state within sandbox

**Success condition:** A prompt runs end-to-end, every tool call is audited, sensitive data never leaves the privacy layer unmasked, the shell tool never runs without user confirmation, swapping model providers requires changing one line in config.yaml, and external systems can trigger runs via inbound webhooks.

---

## Phase 2 — DESIGN

### Core Insight: Adopt the Nodaic Process/Graph Model

The existing mehro-agent already has the right instinct — DAG-based execution. The critical upgrade: replace the ad-hoc DAG runner with the **Nodaic engine contract** (Process + Graph + Library). This gives:

- Every tool becomes a **Process** artifact: `(input, state, cb) => cb({output})`
- Every agent plan becomes a **Graph** artifact: nodes wired by edges
- The runtime manages library, execution, secrets, and persistence
- Recursive agents = a Graph whose nodes include another Graph (fractal property)

### System Decomposition

```
mehro-agent/
├── config.yaml               # Single config source — all tunables here
│
├── runtime/
│   ├── index.js              # Boot: config → prompt-files → store → library → scheduler → listen
│   ├── dispatch.js           # ONE function: all actions route through here
│   ├── store.js              # SQLite: artifacts, bindings, vars, secrets, audit
│   ├── auth.js               # Token HMAC, roles, scopes, API key verification
│   ├── api.js                # REST routes: /api/* — thin wrappers over dispatch
│   ├── webhooks.js           # Outbound webhook emitter (fire + retry)
│   ├── mcp-server.js         # Exposes tools as MCP server (/mcp/*)
│   ├── mcp-client.js         # Connects to external MCP servers, wraps tools
│   ├── commands.js           # Slash command registry + resolution
│   └── prompt-files.js       # Discovers + loads MEHRO.md, RULES.md, WORKFLOWS.md
│
├── engine/                   # Nodaic engine — copy unchanged, never edited
│   └── [engine files]
│
├── planner/
│   ├── planner.js            # NL → Graph artifact (skills injected here)
│   ├── prompt.js             # System prompt builder (tool manifest + active skills)
│   ├── model-adapter.js      # Loads provider from config.yaml
│   └── providers/
│       ├── index.js          # Registry: { openai, anthropic, ollama, ... }
│       ├── openai.js
│       ├── anthropic.js
│       └── ollama.js
│
├── MEHRO.md                  # [user-created] project system prompt + inline rules/workflows/agents
├── RULES.md                  # [user-created] prose + structured rules
├── WORKFLOWS.md              # [user-created] inline workflow definitions
│
├── skills/                   # Markdown instruction bundles
│   ├── builtin/
│   │   ├── web-researcher.md
│   │   ├── code-reviewer.md
│   │   └── task-planner.md
│   └── user/                 # hot-reloaded, user-defined
│
├── rules/                    # Declarative execution policies
│   ├── builtin/              # always-active: sandbox, allowlist, PII scan, depth
│   └── user/                 # hot-reloaded, user-defined
│
├── workflows/                # Named, triggerable Graph definitions
│   ├── builtin/
│   └── user/                 # hot-reloaded, user-defined
│
├── agents/                   # Agent definition files (.yaml or .md)
│   ├── builtin/
│   │   ├── researcher.yaml
│   │   ├── code-reviewer.md
│   │   └── summariser.yaml
│   └── user/                 # hot-reloaded, user-defined
│
├── tools/
│   ├── core/
│   │   ├── log.js
│   │   ├── calculate.js
│   │   ├── delay.js
│   │   ├── string-transform.js
│   │   └── token-context.js
│   ├── io/
│   │   ├── read-file.js
│   │   ├── write-file.js
│   │   └── shell.js
│   ├── network/
│   │   ├── http-request.js
│   │   └── web-search.js
│   ├── data/
│   │   ├── query.js
│   │   └── query-adapter/
│   │       ├── sqlite.js
│   │       ├── elasticsearch.js
│   │       └── postgres.js
│   ├── tasks/
│   │   ├── task-create.js
│   │   ├── task-list.js
│   │   ├── task-update.js
│   │   └── task-delete.js
│   ├── agent/
│   │   ├── recursive-agent.js
│   │   ├── spawn-agent.js        # spawns a named AgentRunner
│   │   └── agent-runner.js       # isolated execution context per agent def
│   └── privacy/
│       ├── mask.js
│       └── unmask.js
│
├── security/
│   ├── sandbox.js
│   ├── allowlist.js
│   ├── confirm.js            # Approval gate: review | auto | allow-all
│   └── approval.js           # resolveMode(): config → MEHRO.md → session → rule override
│
└── tui/
    └── tui.js
```

---

## Critical Path: Input → Output

```
Inbound trigger (TUI slash command / POST /api/run / POST /trigger/:event / cron)
  → command resolution      [/slash → workflow id, or raw prompt]
  → prompt-files.js         [re-check mtimes; hot-reload any changed MEHRO.md / RULES.md]
  → privacy/mask.js         [mask PII before anything else]
  → skills activation       [trigger-match → inject into planning prompt]
  → token-context.js        [budget: history + skills + tool manifest]
  → rules: pre-plan         [reject disallowed tool combos before LLM call]
  → planner/planner.js      [LLM via model-adapter → Graph artifact JSON]
  → rules: post-plan        [validate generated graph structure]
  → runtime/dispatch.js     [library.push(graph) → scheduler.run(graphId, input)]
  → engine executes graph   [each node = one Process tool, local or via MCP]
      → rules: pre-tool     [sandbox, allowlist, scope, custom guards]
      → tool executes
      → rules: post-tool    [anomaly detection, output blocking]
      → audit log per node
  → rules: pre-output       [PII scan, content filter]
  → privacy/unmask.js       [restore PII placeholders]
  → TUI / API response / outbound webhooks / workflow run history updated
```

---

## Key Design Decisions

### 1. Tool = Nodaic Process

Every tool is `async (input, state, cb) => cb({output})`. No special framework. Testable in isolation with `nodaic_check.js`. Push to library via `library.push()`.

### 2. Plan = Nodaic Graph

The planner's job: translate NL → valid Graph JSON (NDL). The LLM is given the tool manifest (all registered Process ids + their `interface`). Output is a graph — not arbitrary code.

### 3. Model Adapter = Provider-Agnostic by Default

```js
// config.yaml
model:
  provider: openai   # openai | anthropic | ollama | any registered adapter
  model: gpt-4o
  temperature: 0.2

// planner/model-adapter.js
import { loadProvider } from './providers/index.js'
const provider = loadProvider(config.model.provider)
export const complete = (messages) => provider.complete(messages, config.model)

// providers/index.js — registry, not an enum
const registry = { openai, anthropic, ollama }
export const loadProvider = (name) => {
  if (!registry[name]) throw new Error(`Unknown provider: ${name}`)
  return registry[name]
}
```

No default provider. No refactor to swap. Register a new adapter in providers/index.js and name it in config.yaml.

### 4. Privacy Layer = In-process masking

```
mask(text) → { masked: string, vault: Map<placeholder, original> }
unmask(text, vault) → original text
```

PII (emails, phone numbers, names, keys via regex + NER) replaced with `{{PII_0}}` before the LLM sees any input. Restored after. The vault never leaves the process.

### 5. Security = Structural, Not Optional

- **File tools**: `path.resolve(input.path)` must start with `WORKSPACE_DIR` or call is rejected with `{error: 'path_violation'}`
- **Shell tool**: requires `state.confirmationToken` set by the user confirmation gate. Missing token → rejected with `{error: 'confirmation_required'}`. TUI shows command + asks Y/N.
- **Secrets**: stored encrypted in SQLite (AES-256-GCM). Never in env or config files. Retrieved via `state.secret:KEY_NAME` in graph NDL.

### 6. DAG Execution = Parallel Where Possible

The Nodaic engine resolves dependency order. Independent nodes (no shared edges) run via `Promise.all()`. The planner prompt instructs the LLM to express true parallelism as parallel nodes.

### 7. Task Manager = Persistent State via memory/state

Tasks live in the variables store (backed by SQLite). Tools `task-create/list/update/delete` are thin wrappers over `memory/state` with a `tasks:` namespace. IDs are UUIDs (not array-length).

### 8. Recursive Agent = Graph Node

```
recursive-agent process:
  input: { prompt, context }
  → calls planner.js internally
  → pushes sub-graph to library
  → runs sub-graph via scheduler
  → returns { output: subResult }
```

Depth is bounded by `state.depth` (default max 3). Prevents runaway recursion.

### 9. Query Tool — DAG-Aware Search

```js
// tools/data/query.js
// Runs a structured query against any configured backend.
// The query shape mirrors a DAG: filters, projections, joins — not raw ES DSL.

input: {
  backend: 'sqlite' | 'elasticsearch' | 'postgres',  // from config.yaml
  operation: 'search' | 'get' | 'insert' | 'update' | 'delete',
  index: string,          // table name or ES index
  filter: object,         // { field, op, value } — backend-translated
  fields: string[],       // projection
  limit: number
}
state:
  backendUrl = env:QUERY_BACKEND_URL
  apiKey     = secret:QUERY_API_KEY

output: { rows, total, error }

// The adapter pattern applies here too:
// query-adapter.js routes input.backend → SQLiteQuery | ESQuery | PgQuery
// Each adapter translates the common filter schema to native query format.
```

### 10. Token Context Tool

Manages what goes into the model's context window — how much history, which tool outputs, how they're ranked. Runs as a Process step before the planner call.

```js
// tools/core/token-context.js
input: {
  items: Array<{ id, content, priority, tokens }>,  // candidates
  budget: number       // from config.yaml: model.contextBudget
}
output: {
  selected: Array<{ id, content }>,  // fits within budget
  dropped: string[],                 // ids that didn't fit
  usedTokens: number
}

// Strategy: priority-ranked greedy fill.
// items sorted by priority desc; each added until budget reached.
// Token count: content.length / 4 (heuristic) or tiktoken if available.
// config.yaml controls budget per provider:
model:
  contextBudget: 8000   # tokens reserved for context (rest for output)
```

This runs at two points in the critical path:

- **Pre-planner**: selects which task history / prior results feed the planning prompt
- **Pre-tool**: trims tool input payloads that risk overflowing the model's window

Token budget is a first-class config concern, not an afterthought.

## MCP — Model Context Protocol

The runtime operates on **both sides** of MCP: as a server (exposing its tools to any MCP client) and as a client (consuming external MCP servers as tool sources). This is the primary extension mechanism for adding tools without touching the codebase.

### Runtime as MCP Server

The runtime exposes every registered Process tool as an MCP tool. Any MCP-compatible client (Claude Code, Claude Desktop, Cursor, custom agents) can discover and call Mehro tools over the standard protocol.

```
GET  /mcp                 → capability manifest (tools, resources, prompts)
POST /mcp/tools/call      → { name, arguments } → runs the Process, returns output
GET  /mcp/tools/list      → all registered tools + schemas
GET  /mcp/resources/list  → exposed resources (task store, audit log, workspace files)
GET  /mcp/prompts/list    → available Skills as MCP prompts
```

Auth: MCP requests require a bearer token with scope `mcp`. The runtime's existing auth layer handles this — no separate auth system.

### Runtime as MCP Client

External MCP servers register as tool sources in `config.yaml`. At boot the runtime connects, discovers their tools, wraps each as a Process artifact, and pushes them into the library. From the planner's perspective, an external MCP tool is indistinguishable from a local one.

```yaml
# config.yaml
mcp:
  servers:
    - name: filesystem
      url: npx @modelcontextprotocol/server-filesystem
      transport: stdio
      scopes: [read]          # what this server is allowed to do
    - name: github
      url: https://mcp.github.com
      transport: http
      auth: secret:GITHUB_MCP_TOKEN
      scopes: [read, write]
    - name: custom-internal
      url: http://localhost:4000/mcp
      transport: http
```

### MCP Tool Wrapping

```js
// runtime/mcp-client.js
// For each tool discovered from an MCP server:
async function wrapMcpTool(serverName, mcpTool) {
  return {
    id: `mcp/${serverName}/${mcpTool.name}`,
    version: '1.0.0',
    artifactType: 'process',
    source: `async (input, state, cb) => {
      try {
        const result = await mcpCall('${serverName}', '${mcpTool.name}', input)
        cb({ output: result })
      } catch (e) {
        cb({ output: { error: e.message } })
      }
    }`,
    metadata: { name: mcpTool.name, description: mcpTool.description },
    interface: { inputs: mcpTool.inputSchema, outputs: {} }
  }
}
// Pushed to library → available to planner → appears in tool manifest
```

MCP servers reconnect with exponential backoff on disconnect. Tool availability is tracked — the planner prompt omits tools from disconnected servers rather than including them and failing at runtime.

## Skills

Skills are **loadable instruction bundles** — markdown files that inject context, constraints, and tool preferences into the planning prompt. Same concept as Claude Code's `CLAUDE.md`, Antigravity's skill registry, or system-prompt injection in Claude Desktop. They're not code — they're structured prose that shapes how the planner reasons.

### What a Skill Is

```
skills/
├── builtin/
│   ├── web-researcher.md     # how to chain search → fetch → summarize
│   ├── code-reviewer.md      # rules for reading/editing code files
│   └── task-planner.md       # how to decompose complex tasks into subtasks
└── user/                     # user-defined skills, hot-loaded at runtime
    ├── company-style.md
    └── data-pipeline.md
```

A skill file has a structured front-matter + body:

```markdown
---
name: web-researcher
version: 1.0.0
triggers:                # keywords that auto-activate this skill
  - search
  - research
  - find information
tools:                   # tools this skill expects to exist
  - web-search
  - http-request
scope: planner           # planner | tool | both
---

## Role
You are a web researcher. When asked to find information...

## Rules
- Always search before answering factual questions
- Fetch the full page for primary sources, not just the snippet
- Return structured output: { summary, sources[], confidence }

## Tool preference
Use web-search first. If the query needs a specific URL, use http-request directly.
```

### How Skills Load

```
Boot:
  → skills/ directory scanned, all .md files parsed + validated
  → loaded into runtime's skill registry (name → parsed skill)
  → MCP prompts endpoint exposes them (/mcp/prompts/list)

Per request:
  → trigger matching: skill.triggers ∩ prompt keywords → auto-activate
  → explicit: user prefixes prompt with /skill:web-researcher
  → active skills' bodies injected into system prompt before planner call
  → skills are ranked by relevance; token-context.js enforces budget
```

### Skill Loading in config.yaml

```yaml
skills:
  dirs:
    - ./skills/builtin
    - ./skills/user
  autoActivate: true       # trigger-based auto-loading
  maxActive: 3             # cap: prevent prompt bloat
  hotReload: true          # watch dirs, reload on file change
```

Skills compose with each other — if two active skills conflict on a tool preference, the more recently activated one wins (last-write). Skills never execute code; they only influence the planning prompt. A broken skill file degrades gracefully: it logs a warning and is skipped, not a boot failure.

## Rules

Rules are **declarative execution policies** — evaluated at defined hook points in the execution pipeline. They're the enforcement layer: skills say how to reason, rules say what is never allowed regardless of reasoning. Similar to Claude Code's auto-approve rules, Clawd's permission system, or a middleware chain.

### Rule Structure

```yaml
# rules/no-delete-outside-workspace.yaml
name: no-delete-outside-workspace
version: 1.0.0
hook: pre-tool              # pre-tool | post-tool | pre-plan | post-plan | pre-output
tool: write-file            # which tool(s) this applies to (* = all)
priority: 100               # higher = evaluated first; block rules should be high
action: block               # block | warn | transform | require-confirm
condition:
  field: input.path
  op: not-starts-with
  value: "{{config.runtime.workspaceDir}}"
message: "Write outside workspace blocked by policy."
```

### Hook Points

```
pre-plan:    runs before the LLM call         → can inject constraints into prompt
pre-tool:    runs before each tool executes   → can block, modify input, require confirm
post-tool:   runs after each tool returns     → can block output propagation, log anomalies
pre-output:  runs before result reaches user  → PII scan, content filter, format enforcement
post-plan:   runs after graph is generated    → can reject graphs with disallowed tool combos
```

### Rule Actions

| Action | Effect |
| --- | --- |
| `block` | Hard stop. Tool/plan aborted. Error returned to caller. |
| `warn` | Logged to audit. Execution continues. User notified. |
| `transform` | Rule mutates `input` or `output` before passing on (e.g. strip a field). |
| `require-confirm` | Pauses execution. Waits for `confirm.js` gate. Same flow as shell tool. |
| `emit-event` | Fires a named event (triggers webhooks, other workflows). |

### Builtin Rules (Always Active)

These ship with the runtime and cannot be disabled via config — only supplemented:

```
path-sandbox          pre-tool   write-file, read-file   block outside workspaceDir
shell-allowlist       pre-tool   shell                   block commands not in allowlist
pii-output-scan       pre-output *                       warn if unmasked PII in output
max-recursion-depth   pre-plan   recursive-agent         block depth > config.recursiveAgent.maxDepth
api-scope-check       pre-tool   *                       block if caller scope insufficient
```

### User Rules in config.yaml

```yaml
rules:
  dirs:
    - ./rules/builtin    # always loaded
    - ./rules/user       # user-defined, hot-reloaded
  strict: true           # if a rule file fails to parse, abort boot (not skip)
```

Rules are evaluated in priority order, highest first. The first `block` wins — subsequent rules don't run for that hook invocation. `warn` and `transform` rules always run regardless of earlier matches. This keeps the evaluation model predictable.

## Workflow System

Workflows are **named, persisted, triggerable Graph definitions** — the equivalent of Claude Code's slash commands, Antigravity's pipeline definitions, or Clawd's bot workflows. A workflow is a pre-authored Graph artifact with a name, a description, and a set of input parameters. Users invoke them by name; the runtime resolves the graph and runs it.

### What a Workflow Is

```yaml
# workflows/daily-standup.yaml
name: daily-standup
version: 1.0.0
description: Fetches open tasks, checks for blockers, drafts standup notes
trigger:
  slash: /standup             # invoked as /standup in TUI or API
  schedule: '0 9 * * 1-5'    # cron: weekdays at 9am
  webhook: standup.requested  # inbound event name
inputs:
  - name: team
    type: string
    default: engineering
graph: |
  graph workflows/daily-standup
  node list  @tasks/task-list:1.0.0
    state namespace = "tasks"
  node search @network/web-search:1.0.0
  node draft  @agent/recursive-agent:1.0.0
  list -> draft
  search -> draft
```

### How Workflows Register and Run

```
Boot:
  → workflows/ dirs scanned, .yaml files parsed + validated
  → each workflow's graph body pushed to library as Graph artifact
  → slash commands registered: /standup → workflow id
  → cron schedules registered: WorkflowScheduler.on(cron, workflowId)
  → webhook event names bound: trigger.bind(event, workflowId)

Invocation:
  /standup engineering
    → TUI/API parses slash command → resolves workflow id
    → input params validated against workflow.inputs schema
    → skills matching workflow.name auto-activated
    → scheduler.run(workflowId, { team: 'engineering' })
    → result returned + outbound webhooks fired
```

### Workflow API

```
GET  /api/workflows           → list all registered workflows
GET  /api/workflows/:name     → workflow definition + last run status
POST /api/workflows/:name/run → { inputs } → run now, returns { runId }
GET  /api/workflows/:name/runs → run history with status + outputs
```

### Slash Commands in TUI and API

All slash commands share the same resolution chain: local workflow → builtin command → error.

```
/standup [team]         → runs daily-standup workflow
/run [prompt]           → one-shot: plan + execute from NL prompt
/task [description]     → creates a task without running it
/skill [name]           → activates a skill for the session
/tools                  → lists available tools + their interfaces
/history                → shows recent run history
/clear                  → clears session context
```

Builtin commands (`/run`, `/task`, `/tools`, `/history`, `/clear`) are hardcoded in `runtime/commands.js`. User commands are workflows — they extend the command set without touching code.

### Workflow Config

```yaml
# config.yaml
workflows:
  dirs:
    - ./workflows/builtin
    - ./workflows/user
  hotReload: true
  history:
    maxRuns: 1000          # per workflow, stored in SQLite
    retentionDays: 90
  scheduler:
    enabled: true          # enable cron-based workflows
    timezone: UTC
```

### How MCP, Skills, Rules, and Workflows Compose

```
User: /standup engineering
│
├─ Command resolution       → workflows/daily-standup
├─ Skills auto-activate     → task-planner skill injected (trigger: "tasks")
├─ Token context budgeted   → task history + skill text fit within limit
├─ Planner called           → generates/reuses Graph artifact
├─ Rules evaluated          → pre-plan: no disallowed tool combos
│                           → pre-tool: sandbox + allowlist gates
│                           → pre-output: PII scan
├─ Graph executes           → nodes run (some via MCP external tools)
├─ Outbound webhooks fire   → workflow.completed event to configured endpoints
└─ Result returned          → TUI display + /api/workflows/daily-standup/runs updated
```

This is the full lifecycle: a named command → skill context → rule-gated execution → MCP-sourced tools → persisted result.

---

## Approval Modes

Every tool execution passes through the approval layer before it runs. The mode controls what happens at that gate — analogous to Claude Code's `--dangerously-skip-permissions` vs. default review vs. auto-approve rules.

### The Three Modes

| Mode | Behaviour | Use case |
| --- | --- | --- |
| `review` | Every tool call pauses and asks the user: show command, Y/N/edit | Unknown environments, sensitive projects, first run |
| `auto` | Rules decide: matching rules block/warn/confirm as configured; unmatched calls run silently | Default. Rules are the policy. |
| `allow-all` | All tool calls run without confirmation (builtin safety rules still enforce) | Fully trusted automation, CI, batch runs |

`allow-all` is not "no rules" — the builtin rules (sandbox, shell allowlist, PII scan, recursion depth) remain active regardless of mode. It only bypasses the interactive confirmation gate.

### Setting the Mode

Four places, resolved in this order (later overrides earlier):

```yaml
# 1. config.yaml — global default
security:
  approvalMode: auto     # review | auto | allow-all
```

```markdown
<!-- 2. MEHRO.md — project-level override -->
---
security:
  approvalMode: review
---
```

```
# 3. CLI / TUI flag — session-level override
mehro --approval review
mehro --approval allow-all

# Or toggled mid-session in TUI:
/approval review
/approval auto
/approval allow-all
```

```yaml
# 4. Per-tool override in rules — most specific wins
rules:
  - name: always-confirm-shell
    hook: pre-tool
    tool: shell
    action: require-confirm    # forces confirm regardless of session mode
    condition: true            # always
```

### How It Wires Into `confirm.js`

```js
// security/confirm.js
export async function gate(toolName, input, context) {
  const mode = resolveMode(context)   // config → MEHRO.md → session flag → rule override

  if (mode === 'allow-all') return { approved: true, token: signToken() }

  // 'auto': rules already ran (pre-tool hook). If we're here, no rule blocked or confirmed.
  // Run silently.
  if (mode === 'auto') return { approved: true, token: signToken() }

  // 'review': show the call, wait for input
  if (mode === 'review') {
    const decision = await tui.confirm({ tool: toolName, input })
    // decision: 'yes' | 'no' | 'edit' (user edits input inline before approving)
    if (decision.action === 'no')   return { approved: false, error: 'user_rejected' }
    if (decision.action === 'edit') input = decision.edited
    return { approved: true, token: signToken(), input }
  }
}
```

### Review Mode UI (TUI)

When a tool call arrives in `review` mode, the TUI pauses the run and shows:

```
┌─ Tool Call ──────────────────────────────────────┐
│ Tool:    shell                                   │
│ Command: git commit -m "fix: auth bug"           │
│ Step:    3 of 7 (deploy-staging workflow)        │
├──────────────────────────────────────────────────┤
│  [Y] Approve   [N] Reject   [E] Edit   [A] All  │
└──────────────────────────────────────────────────┘
```

`[A] All` — approves this call and switches the session to `allow-all` for the remainder of the run. `[E] Edit` — opens the input inline for the user to modify before approving. The edited input is what the tool receives; the original LLM-generated input is logged alongside it in the audit record.

### Approval Mode in Agent Definitions

Sub-agents (see Multi-Agent section) inherit the parent's approval mode by default but can override it in their definition file. An agent defined with `approvalMode: allow-all` running inside a parent session in `review` mode runs its own tools without pausing — but its outputs still flow through the parent's post-tool rules.

## Multi-Agent Spawning

Mehro can spawn **other agents** — each with its own model, tools, skills, rules, approval mode, and system prompt. The orchestrating agent (the root Mehro instance) treats spawned agents as tool calls: input goes in, structured output comes back. Spawned agents run in isolated contexts; they share nothing with the parent except what the parent explicitly passes as input.

This is the key distinction from recursive-agent (which re-uses the same runtime and model). Spawned agents are genuinely independent processes — different model provider, different personality, different permissions.

### Agent Definition Files

Users define agents as `.yaml` or `.md` files in an `agents/` directory. Front-matter is configuration; the rest of the file is the agent's system prompt and instructions.

**YAML format:**

```yaml
# agents/researcher.yaml
name: researcher
version: 1.0.0
description: Deep research agent — searches, fetches, synthesises sources

model:
  provider: anthropic
  model: claude-sonnet-4-6
  temperature: 0.3
  contextBudget: 12000

tools:
  allow: [web-search, http-request, read-file]   # whitelist — only these
  disabled: [shell, write-file]                  # explicit deny

skills:
  active: [web-researcher]

rules:
  - name: no-writes
    hook: pre-tool
    tool: write-file
    action: block
    condition: true

approvalMode: auto
maxTurns: 10          # max internal planning loops before returning
timeout: 120000       # ms; agent hard-stops and returns partial output

system: |
  You are a deep research specialist. Given a query, you search multiple
  sources, fetch primary documents, and return a structured report with
  citations. Never fabricate sources. If you cannot find reliable information,
  say so explicitly.
```

**Markdown format** (front-matter = config, body = system prompt):

```markdown
---
name: code-reviewer
version: 1.0.0
model:
  provider: openai
  model: gpt-4o
  temperature: 0.1
tools:
  allow: [read-file, calculate]
approvalMode: allow-all
maxTurns: 5
---

You are a strict code reviewer. When given a file path:
1. Read the file
2. Check for: security issues, logic errors, style violations, missing tests
3. Return structured output: { issues: [{line, severity, message}], summary }

Be terse. No praise. Flag every issue, no matter how minor.
Severity: critical | high | medium | low
```

The markdown body becomes the agent's system prompt exactly as written — no processing, no injection of tool manifests unless the agent's own planner adds them.

### Agent Discovery

```
agents/
├── builtin/
│   ├── researcher.yaml      # general-purpose web researcher
│   ├── code-reviewer.md     # strict code review
│   └── summariser.yaml      # condenses long outputs
└── user/                    # user-defined agents, hot-reloaded
    ├── my-data-analyst.md
    └── internal-api-agent.yaml
```

Also discovered from `~/.mehro/agents/` (global) and `MEHRO.md` inline definitions:

```markdown
<!-- MEHRO.md -->
---
agents:
  - name: quick-search
    model:
      provider: ollama
      model: llama3.2
    tools:
      allow: [web-search]
    system: Search the web and return a one-paragraph summary.
---
```

### The `spawn-agent` Tool

The planner treats agent spawning as a tool call. The `spawn-agent` process is registered in the library like any other tool:

```js
// tools/agent/spawn-agent.js
// input: { agent: string, prompt: string, context?: object }
// state: agentRegistry (loaded at boot from agents/ dirs)
//
// 1. Resolves agent definition by name
// 2. Applies parent approval mode unless agent overrides
// 3. Boots a lightweight AgentRunner with the definition's config
// 4. Runs: mask PII → token-context → planner → DAG → unmask
// 5. Returns { output, turns, toolCallCount, truncated }

async (input, state, cb) => {
  try {
    const def = state.agentRegistry[input.agent]
    if (!def) return cb({ output: { error: `Unknown agent: ${input.agent}` } })

    const runner = new AgentRunner(def, {
      approvalMode: def.approvalMode ?? state.parentApprovalMode,
      parentRules:  state.parentRules,     // parent post-tool rules always apply to output
      depth:        (state.depth ?? 0) + 1
    })

    if (runner.depth > state.maxAgentDepth) {
      return cb({ output: { error: 'max_agent_depth_exceeded' } })
    }

    const result = await runner.run(input.prompt, input.context ?? {})
    cb({ output: result })
  } catch (e) {
    cb({ output: { error: e.message } })
  }
}
```

### AgentRunner — Isolated Execution

`AgentRunner` is a self-contained runtime instance built from an agent definition. It is **not** a full Mehro boot — it reuses the engine and tool registry but gets its own:

```
AgentRunner(
  model adapter   → loaded from def.model (may differ from parent)
  tool filter     → only def.tools.allow, minus def.tools.disabled
  skill set       → def.skills.active only
  rule set        → def.rules + parent builtin rules (parent post-tool rules always wrap output)
  system prompt   → def.system (the markdown body)
  approval mode   → def.approvalMode, overridable by parent
  planner         → same planner.js, different system prompt
  store           → ephemeral (in-memory); no SQLite; state dies with the run
)
```

The parent's **builtin rules always wrap the spawned agent's output** — a child agent cannot bypass the parent's sandbox or PII rules. The child's own rules apply internally to its own tool calls.

### In a DAG / NDL Graph

Spawning agents in a workflow looks like any other node:

```
graph workflows/research-and-review
node research  @agent/spawn-agent:1.0.0
  state agent = "researcher"
node review    @agent/spawn-agent:1.0.0
  state agent = "code-reviewer"
node merge     @flow/merge:1.0.0

research -> merge
review   -> merge
```

The two agents run in parallel (independent nodes, no shared edges). Each gets the graph's run input as its `prompt`. Their outputs merge and flow downstream.

### Agent Config in config.yaml

```yaml
agents:
  dirs:
    - ./agents/builtin
    - ./agents/user
  hotReload: true
  maxDepth: 3            # max nested spawn depth (parent → child → grandchild)
  maxConcurrent: 5       # max agents running in parallel per root run
  ephemeralStore: true   # agents never write to parent's SQLite
  inheritRules:          # which parent rules always propagate to children
    - path-sandbox
    - pii-output-scan
    - api-scope-check
```

### How Agents + Approval + Prompt Files Compose

```
Parent Mehro (approval: review)
  spawns → researcher agent (approval: auto)
    ├─ researcher's own RULES apply internally
    ├─ researcher's model: claude-sonnet-4-6 (different from parent)
    ├─ researcher's tools: web-search, http-request only
    ├─ parent builtin rules wrap output (PII scan, sandbox)
    └─ result flows back to parent DAG
  spawns → code-reviewer agent (approval: allow-all)
    ├─ code-reviewer's model: gpt-4o
    ├─ code-reviewer's tools: read-file, calculate only
    ├─ no interactive confirmation (allow-all)
    ├─ parent builtin rules still apply
    └─ result flows back to parent DAG
  parent's review gate sees final merged output — not the internal sub-calls
```

Agent definitions are the user's primary lever for composing specialist capabilities without modifying the runtime. A `MEHRO.md` can define inline quick agents; a full `agents/my-analyst.md` file defines a persistent named agent reusable across workflows.

## Prompt Files

The runtime discovers and loads **plain markdown files** from the project directory and workspace. No config entry required — presence of a file is enough. This is the primary way users define system behaviour without writing code or editing `config.yaml`. The pattern follows Claude Code's `CLAUDE.md`, Antigravity's `.anti` instruction files, and Clawd's `SYSTEM.md`.

### File Discovery — Layered Loading

Files are loaded in priority order, later layers overriding earlier ones where they overlap:

```
Layer 1 — Global (user home)
  ~/.mehro/MEHRO.md         # user's personal defaults, any project
  ~/.mehro/rules/*.md
  ~/.mehro/workflows/*.yaml

Layer 2 — Project root (auto-discovered on boot + run)
  ./MEHRO.md                # main project-level system prompt
  ./RULES.md                # project rules in prose or YAML frontmatter
  ./WORKFLOWS.md            # workflow definitions inline
  ./.mehro/                 # structured alternative to inline files
      system.md
      rules/
      workflows/
      skills/

Layer 3 — Workspace / subdirectory (per-task context)
  ./workspace/MEHRO.md      # overrides for work happening in this directory
  ./workspace/.mehro/
```

All layers merge. Conflicts resolve by: Layer 3 > Layer 2 > Layer 1. Within a layer, more specific path > less specific.

### MEHRO.md — The Main Prompt File

The top-level instruction file. Same idea as `CLAUDE.md`. Sections are freeform prose that becomes part of the system prompt; structured front-matter sections are parsed as config.

```markdown
---
# Structured front-matter — parsed by the runtime
model:
  provider: anthropic
  model: claude-sonnet-4-6

skills:
  active: [web-researcher, code-reviewer]   # always-on for this project

tools:
  disabled: [shell]                         # never offer shell in this project
---

## System Role
You are an engineering assistant for the Acme backend team.
Always prefer Python over shell scripts. Use the internal API at
https://api.internal.acme.com for data queries — never query the DB directly.

## Rules
- Never commit to main directly. All file writes go to a feature branch.
- When reading files, always summarise before editing.
- If a task affects the billing module, add a note to the audit log.

## Context
This project uses a monorepo. The main packages are in /packages/*.
All tasks store results in ./workspace/outputs/.
```

Anything under `## System Role` injects into the LLM system prompt verbatim (after skills and tool manifest). Anything under `## Rules` is parsed as prose rules (see below). `## Context` injects as a fixed context block, not a rule.

### RULES.md — Prose and Structured Rules

Users can define rules in two styles, mixed freely in the same file:

**Prose style** (interpreted by the planner, not mechanically enforced):

```markdown
## Rules
- Always ask for confirmation before deleting files
- Prefer idempotent operations
- Log every external HTTP call with its response status
```

Prose rules are injected into the planning prompt. They guide the LLM's graph generation but don't create hard blocks.

**Frontmatter style** (mechanically enforced by the rules engine, same as YAML rule files):

```markdown
---
rules:
  - name: no-prod-writes
    hook: pre-tool
    tool: write-file
    action: block
    condition:
      field: input.path
      op: contains
      value: /prod/
    message: "Production writes blocked. Use staging."

  - name: confirm-deletes
    hook: pre-tool
    tool: shell
    action: require-confirm
    condition:
      field: input.command
      op: starts-with
      value: rm
---
```

Frontmatter rules are loaded into the rules engine exactly like `rules/user/*.yaml` files — they are hard blocks.

### WORKFLOWS.md — Inline Workflow Definitions

```markdown
---
workflows:
  - name: deploy-staging
    trigger:
      slash: /deploy
      webhook: deploy.requested
    inputs:
      - name: service
        type: string
    description: Build, test, and deploy a service to staging
    graph: |
      graph workflows/deploy-staging
      node build  @tools/shell:1.0.0
        state command = "npm run build"
      node test   @tools/shell:1.0.0
        state command = "npm test"
      node notify @tools/network/http-request:1.0.0
      build -> test
      test  -> notify
---
```

Inline workflow definitions register identically to `workflows/user/*.yaml` files. The workflow name is globally unique — a file-defined workflow with the same name as a directory-defined one takes precedence at the layer it belongs to.

### File Loading in the Runtime

```js
// runtime/prompt-files.js
// Called at boot AND on every run (checks mtimes, re-parses if changed)

export async function loadPromptFiles(rootDir) {
  const layers = [
    path.join(os.homedir(), '.mehro'),   // Layer 1: global
    rootDir,                              // Layer 2: project
    path.join(rootDir, 'workspace'),      // Layer 3: workspace
  ]
  const result = { system: [], rules: [], workflows: [], skills: [], config: {} }

  for (const layerDir of layers) {
    const files = await discoverFiles(layerDir)   // MEHRO.md, RULES.md, etc.
    for (const file of files) {
      const parsed = await parsePromptFile(file)  // frontmatter + sections
      merge(result, parsed, { layer: layerDir })  // later layer wins
    }
  }
  return result
}

// parsePromptFile extracts:
// { frontmatter: { model, skills, tools, rules, workflows },
//   sections: { 'System Role': string, 'Rules': string, 'Context': string, ... } }
```

### What Each Section Does at Runtime

| Section / key | Where it goes | Enforcement |
| --- | --- | --- |
| `## System Role` | Injected into LLM system prompt | Soft — guides planner |
| `## Rules` prose | Injected into LLM system prompt | Soft — guides planner |
| `frontmatter.rules[]` | Loaded into rules engine | Hard — block/warn/transform |
| `## Context` | Fixed context block before each run | Soft — informs planner |
| `frontmatter.workflows[]` | Registered as Graph artifacts + slash commands | Structural |
| `frontmatter.skills.active` | Skills force-activated for this project | Soft — prompt injection |
| `frontmatter.model` | Overrides config.yaml model section for this project | Structural |
| `frontmatter.tools.disabled` | Tools removed from manifest for this project | Hard — not offered to planner |

### File Watching and Hot-Reload

The runtime watches all discovered prompt files with `fs.watch`. On change:

- Prose sections → re-injected on next run (no restart)
- Frontmatter rules → reloaded into rules engine immediately
- Workflows → re-registered; existing in-flight runs use the old version
- `model` or `tools.disabled` changes → logged as requiring restart to take effect

```yaml
# config.yaml
promptFiles:
  enabled: true
  watch: true            # fs.watch for hot-reload
  strict: false          # false = warn on parse errors, skip file; true = abort boot
  globalDir: ~/.mehro    # Layer 1 source
```

### Resolution Order Summary

```
Final system prompt assembly (each run):

  [1] Builtin system prompt (runtime/prompt.js)
  [2] Tool manifest (all available tools + their interface)
  [3] Active skills bodies (trigger-matched + force-active from MEHRO.md)
  [4] MEHRO.md → ## Context section
  [5] MEHRO.md → ## System Role section
  [6] MEHRO.md / RULES.md → ## Rules prose sections
  [7] token-context.js → trims to fit model.contextBudget

Final rules evaluated (each tool call):

  [1] Builtin rules (always, cannot disable)
  [2] rules/builtin/*.yaml
  [3] rules/user/*.yaml
  [4] RULES.md frontmatter rules
  [5] MEHRO.md frontmatter rules  ← highest user priority
  Evaluated in priority order within each layer.
```

This means a user can progressively adopt the system: start with a single `MEHRO.md` in their project root (zero config), graduate to structured `RULES.md` for hard enforcement, and use dedicated `rules/` and `workflows/` directories only when they need fine-grained versioning or multiple files.

## Configuration: config.yaml as the Single Source

Every tuneable lives in one file. The runtime reads it at boot; a file-watcher hot-reloads non-structural changes (model provider, context budget, log level) without restart. Secrets are **not** in this file — they go in the runtime's encrypted store.

```yaml
# config.yaml

runtime:
  port: 3030
  wsEnabled: true
  logLevel: info           # debug | info | warn | error
  workspaceDir: ./workspace

model:
  provider: openai         # openai | anthropic | ollama | <registered adapter>
  model: gpt-4o
  temperature: 0.2
  contextBudget: 8000      # tokens reserved for context

security:
  shellAllowlist:          # explicit allowlist; empty = all denied
    - git
    - npm
    - node
  shellBlocklist:          # always denied even if in allowlist
    - rm -rf
    - mkfs
  requireConfirmation: true
  apiKeys:                 # hashed API keys for the HTTP API
    - name: ci-runner
      hash: sha256:abc123...  # never plaintext
      scopes: [run, read]

webhooks:
  enabled: true
  events:                  # which runtime events emit outbound webhooks
    - task.completed
    - task.failed
    - agent.run.started
    - agent.run.completed
  endpoints:
    - url: https://hooks.example.com/mehro
      secret: secret:WEBHOOK_SIGNING_KEY   # HMAC-SHA256 signed payload
      events: [task.completed, task.failed]

query:
  defaultBackend: sqlite   # sqlite | elasticsearch | postgres
  backends:
    elasticsearch:
      url: env:ES_URL
    postgres:
      url: env:PG_URL

privacy:
  enabled: true
  patterns:                # additional PII regex patterns beyond defaults
    - name: internal_id
      regex: 'EMP-[0-9]{6}'

tasks:
  namespace: tasks
  maxPerUser: 500

recursiveAgent:
  maxDepth: 3
```

The runtime validates this schema at boot with Zod. Unknown keys are rejected (not silently ignored). Missing required keys emit a clear error with the key path.

---

## API Endpoints + Webhooks

### HTTP API

The runtime exposes a secured REST API on top of the existing Nodaic `/nodaic/v1` RPC surface. All endpoints require a bearer token (from `config.yaml security.apiKeys`, hashed) or the runtime's HMAC token.

```
POST /api/run          → { taskId, graphId, input }   → starts a DAG run
GET  /api/run/:id      → { status, output, error }     → poll run result
GET  /api/tasks        → { tasks[] }                   → list tasks
POST /api/tasks        → { prompt }                    → create + enqueue task
PATCH /api/tasks/:id   → { status, result }            → update task
DELETE /api/tasks/:id  → 204                           → delete task
GET  /api/tools        → { tools[] }                   → list registered tools + interfaces
GET  /api/health       → { status, uptime, provider }  → healthcheck
```

All routes pass through `dispatch.js`. Auth is enforced before the action switch — not per-route. Scope `run` required for `/api/run`, `read` for GET routes, `admin` for tool registration.

**Rate limiting:** per API key, configurable. Default: 60 req/min. Excess → 429 with `Retry-After` header.

**Error envelope (all routes):**

```json
{ "error": true, "code": "auth_required", "reason": "Missing bearer token", "status": 401 }
```

### Outbound Webhooks

The runtime emits signed payloads to configured endpoints when events fire.

```js
// Event shape (consistent across all events)
{
  event: 'task.completed',
  timestamp: '2026-11-04T10:00:00Z',
  runId: 'uuid',
  payload: { taskId, result, durationMs }
}

// Signed with HMAC-SHA256:
// X-Mehro-Signature: sha256=<hmac(secret, JSON.stringify(body))>
// Receiver verifies before processing — same pattern as GitHub webhooks.
```

Webhooks are fire-and-forget with exponential backoff retry (3 attempts, 1s / 4s / 16s). Failures logged to audit store. No webhook failure blocks the agent run.

### Inbound Webhooks (Triggers)

External systems can trigger agent runs via:

```
POST /trigger/:eventName    → requires pub token (from config or runtime)
```

This maps directly to the Nodaic trigger system — an event binding routes to a registered Graph artifact. The agent runs asynchronously; caller gets `{ runId }` immediately.

## Fixes from Audit (Mapped to Architecture)

| Audit Issue | Resolution in v2 |
| --- | --- |
| Leaked API key | Revoke + scrub. Keys only via `secret:` in state. Never in .env or code. |
| Unrestricted shell | `confirm.js` gate + `allowlist.js`. Missing token = hard reject. |
| Unrestricted file access | `sandbox.js` path prefix check. Rejects outside WORKSPACE\_DIR. |
| 23 npm vulns | `npm audit fix`. Remove `@google/genai` + `node-llama-cpp` (unused). |
| http\_request ignores method | Rewritten using `fetch()` — method, headers, body all pass through. |
| shell.js missing Zod schema | All tools have `interface` + Zod schema. Validation is mandatory in dispatch. |
| Sequential DAG | Nodaic engine: parallel execution for independent nodes. |
| Task ID collisions | UUIDs via `crypto.randomUUID()`. |
| Single reference resolution | `resolveRefs()` does global replace: `/\{\{([^}]+)\}\}/g` with `replaceAll`. |
| Silent error swallowing | DAG executor checks `output.error`. Failing step aborts downstream by default; opt-in `{allowFail: true}` skips. |
| Monolithic index.js | Split into runtime/, planner/, tools/, security/, tui/. |
| console.log override | Proper logger instance (`src/logger.js`). TUI subscribes to log events. |
| TUI singleton | `new MehroTUI(options)` — explicitly instantiated. |
| No tests | Each tool tested with `nodaic_check.js`. DAG validator has unit tests. |

---

## Phase 3 — Build Order (Critical Path First)

1. **Runtime skeleton** — boot sequence, dispatch, SQLite store, token auth, config.yaml Zod validation
2. **Engine** — copy Nodaic engine assets unchanged
3. **Core tools** — log, calculate, delay (verify engine end-to-end)
4. **Rules engine — builtin rules (sandbox, allowlist, PII scan, depth) + hook system**
5. **Model adapter + planner — provider registry, no default; config.yaml names active provider**
6. **S**kills system — loader, trigger matching, prompt injection, hot-reload
7. **IO tools — read-file, write-file (sandbox gate), shell (confirmation gate)**
8. **Network + data tools — http-request, web-search, query.js with backend adapters**
9. **MCP layer — mcp-server.js (expose tools), mcp-client.js (consume external servers)**
10. **Task tools + privacy layer — CRUD via memory/state,** mask/unmask processes
11. **Workflow system — loader, slash commands, cron scheduler, workflow API**
12. **Recursive agent + API + webhooks — depth-bounded sub-planner, /api/\* routes, webhook emitter**
13. **TUI** — rewritten as explicit instance, subscribes to runtime events
14. **Tests** — nodaic\_check.js per tool, smoke test covers API + webhook endpoints
15. **config.yaml validation** — Zod schema at boot; file-watcher hot-reloads non-structural changes

---

## Phase 4 — Verify & Validate Checkpoints

| Checkpoint | Test |
| --- | --- |
| Tool isolation | Each Process passes `nodaic_check.js --input ...` |
| Security gates | File tool rejects `../../../etc/shadow`. Shell tool rejects without token. |
| Privacy roundtrip | `mask(unmask(mask(text).masked, vault))` === original |
| Model swap | Change `MODEL_PROVIDER=openai`, same prompt → same DAG structure |
| Parallel execution | Two independent nodes complete in \~same time, not sequentially |
| Task persistence | Tasks survive runtime restart (from SQLite) |
| Recursive depth | Agent with depth 4 returns `{error: 'max_depth_exceeded'}` |
| Audit log | Every tool call logged with timestamp, tool id, input hash, output hash |

---

## Interface Contracts

### Model Adapter

```js
// providers/{ollama|openai|anthropic}.js
export async function complete(messages: Message[]): Promise<string>
// returns: raw LLM text (planner parses it)
```

### Tool Process (Nodaic contract)

```js
async (input, state, cb) => {
  try {
    // do one thing
    cb({ output: { result, error: null } })
  } catch (e) {
    cb({ output: { result: null, error: e.message } })
  }
}
```

### Confirmation Gate

```js
// security/confirm.js
export async function requestConfirmation(action, details): Promise<token | null>
// TUI shows action+details, user presses Y → returns signed token
// N → returns null → tool rejects
```

### Privacy Layer

```js
// tools/privacy/mask.js
export function mask(text): { masked: string, vault: Map }
// tools/privacy/unmask.js  
export function unmask(text, vault): string
```
