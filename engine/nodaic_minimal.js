import { EventEmitter } from 'events';
import logger from '../src/logger.js';
import { variablesRepo, auditRepo } from '../runtime/store.js';
import { rulesEngine } from '../runtime/rules.js';
import { gate } from '../security/approval.js';

// Global reference resolution helper: uses /\{\{([^}]+)\}\}/g with replaceAll
export function resolveRefs(val, contextResults = {}) {
  if (typeof val === 'string') {
    if (!val.includes('{{')) return val;
    return val.replaceAll(/\{\{([^}]+)\}\}/g, (match, pathStr) => {
      const parts = pathStr.trim().split('.');
      let curr = contextResults;
      for (const part of parts) {
        if (curr === null || curr === undefined) return match;
        curr = curr[part];
      }
      return curr !== undefined && curr !== null ? String(curr) : match;
    });
  }

  if (Array.isArray(val)) {
    return val.map(item => resolveRefs(item, contextResults));
  }

  if (val && typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = resolveRefs(v, contextResults);
    }
    return res;
  }

  return val;
}

export class Process {
  constructor(fn, metadata = {}, interfaceDef = {}, computeTimeout = 30000) {
    this.fn = fn;
    this.metadata = metadata;
    this.interface = interfaceDef;
    this.computeTimeout = computeTimeout;
  }

  compute(input = {}, state = {}) {
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ output: { error: 'timeout' }, state, error: 'timeout' });
        }
      }, this.computeTimeout);

      const callback = (res) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);

        if (state.signal && state.signal.aborted) {
          return resolve({ output: { error: 'aborted' }, state, error: 'aborted' });
        }

        const out = res && typeof res === 'object' && 'output' in res ? res.output : (res || {});
        const nextState = res && typeof res === 'object' && 'state' in res ? res.state : state;
        resolve({ output: out, state: nextState });
      };

      try {
        const maybePromise = this.fn(input, state, callback);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch(err => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve({ output: { result: null, error: err.message }, state, error: err.message });
            }
          });
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ output: { result: null, error: err.message }, state, error: err.message });
        }
      }
    });
  }

  static fromArtifact(def) {
    if (!def) return null;
    let fn = null;

    if (typeof def.source === 'function') {
      fn = def.source;
    } else if (typeof def.source === 'string') {
      const src = def.source.trim();
      try {
        if (src.startsWith('async') || src.startsWith('(') || src.startsWith('function')) {
          fn = new Function(`return (${src})`)();
        } else {
          fn = new Function('input', 'state', 'cb', src);
        }
      } catch (err) {
        logger.error(`Failed to compile process source for [${def.id}]: ${err.message}`);
        return null;
      }
    }

    if (!fn) return null;
    const proc = new Process(fn, def.metadata || {}, def.interface || {});
    proc.id = def.id;
    proc.version = def.version || '1.0.0';
    return proc;
  }
}

export class Node {
  constructor(id, content = null) {
    this.id = id;
    this.content = content;
    this.state = {};
    this.inputs = []; // Array of { refId, mapping, data: {} }
    this.output = null;
    this.allowFail = false;
    this.dependencies = [];
  }

  connect(sourceNode, mapping = {}) {
    if (!this.dependencies.includes(sourceNode.id)) {
      this.dependencies.push(sourceNode.id);
    }
    this.inputs.push({
      refId: sourceNode.id,
      mapping,
      data: {}
    });
  }

  async compute(rootInput = {}, rootState = {}, contextResults = {}) {
    if (!this.content) {
      return { output: {}, state: this.state };
    }

    // Merge rootInput with upstream outputs
    const upstreamData = {};
    for (const inp of this.inputs) {
      Object.assign(upstreamData, inp.data);
    }
    let mergedInput = { ...rootInput, ...upstreamData };

    // Apply global reference resolution
    mergedInput = resolveRefs(mergedInput, contextResults);

    const mergedState = { ...this.state, ...rootState };
    const toolId = this.content.id || this._artifactRef || this.id;
    const isInternalFlow = String(toolId).includes('flow/merge') || String(toolId).includes('memory/state');

    // 1. Rules: pre-tool hook
    if (!isInternalFlow && rulesEngine) {
      const preCheck = rulesEngine.evaluateHook('pre-tool', {
        tool: toolId,
        input: mergedInput,
        state: mergedState,
        config: mergedState.config || {}
      });

      if (preCheck.blocked) {
        const err = preCheck.error || `Blocked by pre-tool rule: ${preCheck.rule}`;
        this.output = { result: null, error: err };
        this._recordAudit(toolId, mergedInput, this.output, 'blocked', err, mergedState.runId);
        return { output: this.output, state: mergedState, error: err };
      }

      mergedInput = preCheck.input || mergedInput;
      if (preCheck.requireConfirm) {
        mergedState.requireConfirm = true;
      }
    }

    // 2. Security Approval Gate
    if (!isInternalFlow && gate) {
      const approvalContext = {
        config: mergedState.config,
        mehroFrontmatter: mergedState.mehroFrontmatter,
        sessionApprovalMode: mergedState.approvalMode || mergedState.sessionApprovalMode,
        requireConfirm: mergedState.requireConfirm,
        tuiConfirm: mergedState.tuiConfirm
      };

      const gateRes = await gate(toolId, mergedInput, approvalContext);
      if (!gateRes.approved) {
        const err = gateRes.error || 'confirmation_required';
        this.output = { result: null, error: err };
        this._recordAudit(toolId, mergedInput, this.output, 'approval_failed', err, mergedState.runId);
        return { output: this.output, state: mergedState, error: err };
      }

      mergedInput = gateRes.input || mergedInput;
      if (gateRes.token) {
        mergedState.confirmationToken = gateRes.token;
      }
    }

    // 3. Process Execution
    const res = await this.content.compute(mergedInput, mergedState);

    this.output = res.output ?? {};
    this.state = res.state ?? this.state;

    // 4. Rules: post-tool hook
    if (!isInternalFlow && rulesEngine) {
      const postCheck = rulesEngine.evaluateHook('post-tool', {
        tool: toolId,
        input: mergedInput,
        output: this.output,
        state: this.state,
        config: mergedState.config || {}
      });

      if (postCheck.blocked) {
        const err = postCheck.error || `Blocked by post-tool rule: ${postCheck.rule}`;
        this.output = { result: null, error: err };
      } else if (postCheck.output) {
        this.output = postCheck.output;
      }
    }

    // 5. Per-node SQLite audit log
    this._recordAudit(
      toolId,
      mergedInput,
      this.output,
      (this.output?.error || res.error) ? 'error' : 'success',
      this.output?.error || res.error || null,
      mergedState.runId
    );

    return { output: this.output, state: this.state, error: this.output?.error || res.error };
  }

  _recordAudit(toolId, input, output, status, error, runId = null) {
    try {
      auditRepo.log({
        runId,
        toolId,
        input,
        output,
        status,
        error
      });
    } catch {
      // ignore if store is ephemeral or not yet booted
    }
  }
}

export class Graph {
  constructor(id = 'graph', version = '1.0.0') {
    this.id = id;
    this.version = version;
    this.nodes = new Map();
    this.edges = [];
  }

  addNode(node) {
    this.nodes.set(node.id, node);
  }

  addEdge(fromId, toId, config = {}) {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    if (!fromNode || !toNode) {
      logger.warn(`Skipping edge ${fromId} -> ${toId}: node not found`);
      return;
    }
    toNode.connect(fromNode, config);
    this.edges.push({ from: fromId, to: toId, config });
  }

  async compute(rootInput = {}, rootState = {}) {
    const completed = new Set();
    const nodeResults = {};
    const failedNodes = new Set();
    let mergedOutput = {};

    // Check for circular dependency
    if (this._hasCircularDependency()) {
      return { output: { error: 'Circular dependency detected' }, state: rootState, error: 'Circular dependency' };
    }

    // Execution loop: parallel execution of independent nodes via Promise.all
    while (completed.size < this.nodes.size) {
      const readyNodes = [];

      for (const [nodeId, node] of this.nodes.entries()) {
        if (completed.has(nodeId)) continue;

        // Check if any dependency failed and didn't allow fail
        const depFailed = node.dependencies.some(depId => failedNodes.has(depId));
        if (depFailed && !node.allowFail) {
          failedNodes.add(nodeId);
          completed.add(nodeId);
          nodeResults[nodeId] = { error: 'upstream_dependency_failed' };
          continue;
        }

        // Check if all dependencies are completed
        const depsReady = node.dependencies.every(depId => completed.has(depId));
        if (depsReady) {
          readyNodes.push(node);
        }
      }

      if (readyNodes.length === 0) {
        // No ready nodes remaining but not all completed (e.g. all remaining blocked by failures)
        break;
      }

      // Execute independent ready nodes concurrently with Promise.all
      const results = await Promise.all(
        readyNodes.map(async (node) => {
          // Fill upstream data from context
          for (const inp of node.inputs) {
            inp.data = nodeResults[inp.refId] || {};
          }

          try {
            const res = await node.compute(rootInput, rootState, nodeResults);
            return { nodeId: node.id, res, error: null };
          } catch (err) {
            return { nodeId: node.id, res: { output: { error: err.message } }, error: err.message };
          }
        })
      );

      for (const item of results) {
        const { nodeId, res, error } = item;
        completed.add(nodeId);

        const out = res?.output ?? {};
        nodeResults[nodeId] = out;
        Object.assign(mergedOutput, out);

        // Check output.error at each DAG step: abort downstream nodes on error unless allowFail: true
        const node = this.nodes.get(nodeId);
        const hasError = error || (out && out.error !== null && out.error !== undefined);
        if (hasError && !node?.allowFail) {
          failedNodes.add(nodeId);
        }
      }
    }

    return { output: mergedOutput, state: rootState };
  }

  _hasCircularDependency() {
    const visited = new Set();
    const recStack = new Set();

    const isCyclic = (nodeId) => {
      if (recStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (isCyclic(depId)) return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (isCyclic(nodeId)) return true;
    }
    return false;
  }

  static fromArtifact(def, library = null) {
    if (!def) return null;
    const graph = new Graph(def.id, def.version || '1.0.0');

    if (def.sourceType === 'application/json' || def.sourceType === 'text/json') {
      const parsed = typeof def.source === 'string' ? JSON.parse(def.source) : def.source;
      const nodesMap = parsed.nodes || {};
      for (const [nodeId, nodeConfig] of Object.entries(nodesMap)) {
        let content = null;
        if (library && nodeConfig.artifactRef) {
          content = library.getInstance(nodeConfig.artifactRef, nodeConfig.version || 'latest');
        }
        const node = new Node(nodeId, content);
        if (nodeConfig.state) node.state = { ...nodeConfig.state };
        if (nodeConfig.allowFail) node.allowFail = Boolean(nodeConfig.allowFail);
        graph.addNode(node);
      }

      const edges = parsed.edges || [];
      for (const edge of edges) {
        graph.addEdge(edge.from, edge.to, edge.config || {});
      }
      return graph;
    }

    // Default to NDL parser (text/x-ndl)
    return parseNDL(def.source || '', graph, library);
  }
}

function parseNDL(source, graph, library) {
  const lines = source.split(/\r?\n/);
  let currentNode = null;

  for (let rawLine of lines) {
    // Strip comments
    const hashIdx = rawLine.indexOf('#');
    if (hashIdx !== -1) {
      rawLine = rawLine.slice(0, hashIdx);
    }
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('graph ')) continue;

    const isIndented = rawLine.startsWith(' ') || rawLine.startsWith('\t');

    if (!isIndented) {
      if (trimmed.startsWith('node ')) {
        const match = trimmed.match(/^node\s+(\S+)\s+@([^:\s]+)(?::(\S+))?/);
        if (match) {
          const [, nodeId, artifactRef, version] = match;
          let content = null;
          if (library) {
            content = library.getInstance(artifactRef, version || 'latest');
          }
          const node = new Node(nodeId, content);
          node._artifactRef = artifactRef;
          node._version = version || 'latest';
          graph.addNode(node);
          currentNode = node;
          continue;
        }
      }

      currentNode = null;

      // Check for edge: a -> b
      if (trimmed.includes('->')) {
        const parts = trimmed.split('->');
        if (parts.length === 2) {
          const fromPart = parts[0].trim().split('.')[0];
          const toPart = parts[1].trim().split('@')[0].trim().split('.')[0];
          graph.addEdge(fromPart, toPart);
        }
      }
    } else if (currentNode) {
      // Indented line under current node
      if (trimmed.startsWith('state ')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(6, eqIdx).trim();
          const rawVal = trimmed.slice(eqIdx + 1).trim();
          currentNode.state[key] = parseValue(rawVal);
        }
      } else if (trimmed.startsWith('allowFail')) {
        currentNode.allowFail = true;
      }
    }
  }

  return graph;
}

function parseValue(raw) {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  return raw;
}

export class Library {
  constructor() {
    this.artifacts = new Map(); // id -> Map<version, def>
    this.secretsResolver = null;
  }

  setSecretsResolver(fn) {
    this.secretsResolver = fn;
  }

  resolveSecret(key) {
    if (this.secretsResolver) {
      const res = this.secretsResolver(key);
      if (res !== null && res !== undefined) return res;
    }
    return process.env[key] ?? null;
  }

  addArtifact(def) {
    if (!def || !def.id) throw new Error('Artifact definition must have an id');
    const version = def.version || '1.0.0';
    if (!this.artifacts.has(def.id)) {
      this.artifacts.set(def.id, new Map());
    }
    const stored = { ...def, version };
    this.artifacts.get(def.id).set(version, stored);
    return stored;
  }

  getArtifact(id, version = 'latest') {
    const versions = this.artifacts.get(id);
    if (!versions || versions.size === 0) return null;
    if (version === 'latest') {
      const sorted = Array.from(versions.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return versions.get(sorted[sorted.length - 1]);
    }
    return versions.get(version) || null;
  }

  has(id) {
    return this.artifacts.has(id);
  }

  list() {
    const list = [];
    for (const [id, versions] of this.artifacts.entries()) {
      for (const [version, def] of versions.entries()) {
        const copy = { ...def };
        delete copy.source;
        list.push(copy);
      }
    }
    return list;
  }

  removeArtifact(id, version = null) {
    if (!this.artifacts.has(id)) return false;
    if (version) {
      const verMap = this.artifacts.get(id);
      const res = verMap.delete(version);
      if (verMap.size === 0) this.artifacts.delete(id);
      return res;
    }
    return this.artifacts.delete(id);
  }

  getInstance(id, version = 'latest') {
    const def = this.getArtifact(id, version);
    if (!def) {
      logger.warn(`Artifact not found in library: ${id}:${version}`);
      return null;
    }

    if (def.artifactType === 'process') {
      return Process.fromArtifact(def);
    }

    if (def.artifactType === 'graph') {
      const graph = Graph.fromArtifact(def, this);
      this.injectSecrets(graph);
      return graph;
    }

    return null;
  }

  injectSecrets(graph) {
    if (!graph || !graph.nodes) return;
    const SECRET_REGEX = /^(?:env:|secret:|@key:|@secret:)(.+)$/;

    for (const node of graph.nodes.values()) {
      if (!node.state) continue;
      for (const [k, v] of Object.entries(node.state)) {
        if (typeof v === 'string') {
          const match = v.match(SECRET_REGEX);
          if (match) {
            const secretKey = match[1].trim();
            const resolved = this.resolveSecret(secretKey);
            if (resolved !== null && resolved !== undefined) {
              node.state[k] = resolved;
            }
          }
        }
      }
    }
  }
}

export function createNodaicSystem() {
  const library = new Library();

  // Register built-in memory/state process
  library.addArtifact({
    id: 'memory/state',
    version: '1.0.0',
    artifactType: 'process',
    sourceType: 'application/javascript',
    metadata: { name: 'State', description: 'Persistent state over SQLite variables table' },
    source: async (input, state, cb) => {
      try {
        const ns = input.namespace || state.namespace || 'default';
        const key = input.key || state.key;
        if (!key) {
          return cb({ output: { error: 'key_required' }, state });
        }

        // Check if write
        const inputKeys = Object.keys(input).filter(k => k !== 'key' && k !== 'namespace');
        if (inputKeys.length > 0) {
          const valueToStore = inputKeys.length === 1 && 'value' in input ? input.value : input;
          variablesRepo.set(ns, key, valueToStore, 'state');
          return cb({ output: { key, value: valueToStore, error: null }, state });
        }

        // Read
        const existing = variablesRepo.get(ns, key);
        return cb({ output: { key, value: existing ? existing.value : null, error: null }, state });
      } catch (err) {
        return cb({ output: { error: err.message }, state });
      }
    }
  });

  // Register built-in flow/merge process
  library.addArtifact({
    id: 'flow/merge',
    version: '1.0.0',
    artifactType: 'process',
    sourceType: 'application/javascript',
    metadata: { name: 'Flow Merge', description: 'Converges branching nodes into single sink' },
    source: (input, state, cb) => {
      cb({ output: { ...input, error: null }, state });
    }
  });

  return { library };
}
