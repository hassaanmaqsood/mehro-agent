### OPERATING RULES (MANDATORY)
1. **Incremental Execution (Do Not One-Shot):** Execute the build strictly in the 15-step Phase 3 Build Order below. Complete ONE step at a time, run its verification command in the terminal, fix any errors, and only then move to the next step.
2. **No Silent Placeholders:** Never write `// TODO` or stub out core security, validation, or adapter logic. Every file created must be complete and runnable.
3. **Strict Dependencies:** Use Node.js 20+ built-ins (`fetch`, `crypto.randomUUID()`, `fs.watch`), `zod`, `better-sqlite3`, `express`, `ws`, and `yaml`. Do NOT install `@google/genai` or `node-llama-cpp`.
4. **Logger & TUI Separation:** Never override `console.log`. Implement `src/logger.js` as an event emitter that `tui/tui.js` (`new MehroTUI(options)`) subscribes to.

---

### CORE ARCHITECTURAL CONTRACTS (DO NOT DEVIATE)

1. **Nodaic Process Contract:**
   Every tool in `tools/**` and every MCP wrapper is a Nodaic Process artifact (`artifactType: 'process'`, `sourceType: 'application/javascript'`) with an explicit `interface` and Zod input validation in `dispatch.js`:
   ```js
   async (input, state, cb) => {
     try {
       // Never throw out of an async process; always call cb() once
       cb({ output: { result, error: null }, state })
     } catch (e) {
       cb({ output: { result: null, error: e.message }, state })
     }
   }

```

* State is ephemeral per run. Cross-run persistence MUST use the `memory/state` process backed by the SQLite `variables` table.
* Check `output.error` at each DAG step: abort downstream nodes on error unless the node has `{ allowFail: true }`.
* Always converge branching NDL graphs into a single sink node (`@flow/merge:1.0.0`) to avoid the Nodaic multi-sink fan-out false circular-dependency bug.
* Global reference resolution (`resolveRefs()`) must use `/\{\{([^}]+)\}\}/g` with `replaceAll`.

2. **Single Dispatch Seam (`runtime/dispatch.js`):**
* Every transport (REST `/api/*`, Nodaic RPC `/nodaic/v1`, WebSockets, inbound `/trigger/:eventName`, TUI slash commands) MUST route through `dispatch(action, payload, tokenOrAuth, emit)`.
* Enforce authentication and scope checks (`run`, `read`, `admin`, `mcp`) inside `dispatch` BEFORE the action switch.
* Uniform HTTP error envelope on all routes: `{ "error": true, "code": "<code_name>", "reason": "<message>", "status": <http_status> }`.


3. **Security & Approval Gate (`security/`):**
* `sandbox.js`: `path.resolve(input.path)` must start with `path.resolve(config.runtime.workspaceDir)` or reject with `{ error: 'path_violation' }`.
* `allowlist.js` & `confirm.js`: `shell.js` requires `input.command` to match `security.shellAllowlist`, never match `security.shellBlocklist`, and hold a valid signed `state.confirmationToken` from `confirm.js` (missing token -> `{ error: 'confirmation_required' }`).
* `approval.js`: `resolveMode(context)` resolves in exact priority order: `config.yaml` -> `MEHRO.md` frontmatter -> CLI/TUI session flag (`--approval` / `/approval`) -> per-tool rule override (`require-confirm`). Modes: `review` (TUI `[Y] Approve [N] Reject [E] Edit [A] All`), `auto`, `allow-all`. Builtin rules remain active even in `allow-all`.
* Secrets: Stored encrypted in SQLite `variables` (`AES-256-GCM`). Resolved in NDL graphs via `state key = secret:KEY_NAME` or `env:KEY_NAME`. Never store plaintext secrets in `config.yaml` or `.env`.


4. **Privacy Layer (`tools/privacy/mask.js` & `unmask.js`):**
* `mask(text)` replaces PII (emails, phones, keys, plus custom regexes from `config.yaml privacy.patterns`) with `{{PII_0}}`, `{{PII_1}}` and returns `{ masked: string, vault: Map }`.
* `unmask(text, vault)` restores original strings after `pre-output` rules run. The vault never leaves the process.


5. **Critical Execution Pipeline (Input -> Output):**
`Inbound trigger` -> `command resolution` -> `prompt-files.js (mtime check & 3-layer merge: ~/.mehro -> ./ -> ./workspace)` -> `privacy/mask.js` -> `skills activation (trigger-match + MEHRO.md active, capped at maxActive)` -> `token-context.js (greedy priority fill within model.contextBudget)` -> `rules: pre-plan` -> `planner/planner.js (via model-adapter.js)` -> `rules: post-plan` -> `runtime/dispatch.js (library.push -> scheduler.run)` -> `per-node: rules: pre-tool -> approval gate -> Process execution -> rules: post-tool -> SQLite audit log (timestamp, tool id, input sha256, output sha256)` -> `rules: pre-output` -> `privacy/unmask.js` -> `response + outbound HMAC-SHA256 webhooks`.
