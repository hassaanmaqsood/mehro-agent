import logger from '../src/logger.js';

function stripPrivate(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_')) {
      clean[k] = v;
    }
  }
  return clean;
}

export class WorkflowScheduler {
  constructor(library, options = {}) {
    this.library = library;
    this.maxConcurrent = options.maxConcurrent || 10;
    this._bindings = new Map(); // event -> [{ artifactId, state, filter, once }]
    this._running = new Map();  // artifactId -> count
  }

  on(event, artifactId, { state = {}, filter = null, once = false } = {}) {
    if (!this._bindings.has(event)) {
      this._bindings.set(event, []);
    }
    this._bindings.get(event).push({ artifactId, state, filter, once });
  }

  off(event, artifactId = null) {
    if (!this._bindings.has(event)) return;
    if (!artifactId) {
      this._bindings.delete(event);
      return;
    }
    const list = this._bindings.get(event).filter(b => b.artifactId !== artifactId);
    if (list.length === 0) {
      this._bindings.delete(event);
    } else {
      this._bindings.set(event, list);
    }
  }

  bindings() {
    const res = {};
    for (const [event, list] of this._bindings.entries()) {
      res[event] = list.map(b => b.artifactId);
    }
    return res;
  }

  async emit(event, data = {}) {
    const list = this._bindings.get(event) || [];
    const toRun = [];
    const remaining = [];

    for (const b of list) {
      let matches = true;
      if (typeof b.filter === 'function') {
        try {
          matches = Boolean(b.filter(data));
        } catch {
          matches = false;
        }
      }
      if (matches) {
        toRun.push(b);
        if (!b.once) {
          remaining.push(b);
        }
      } else {
        remaining.push(b);
      }
    }

    if (remaining.length === 0) {
      this._bindings.delete(event);
    } else {
      this._bindings.set(event, remaining);
    }

    // Check implicit event binding
    if (this.library && this.library.has(event) && !toRun.some(b => b.artifactId === event)) {
      toRun.push({ artifactId: event, state: {}, once: false });
    }

    if (toRun.length === 0) {
      return [];
    }

    const results = await Promise.all(
      toRun.map(b => this._execute(b.artifactId, data, b.state))
    );

    return results;
  }

  async run(artifactId, input = {}, state = {}) {
    const res = await this._execute(artifactId, input, state);
    if (res.error && !res.output) {
      throw new Error(`Workflow execution failed: ${res.error}`);
    }
    return res.output;
  }

  async _execute(id, input = {}, seed = {}) {
    if (!this.library) {
      return { artifactId: id, output: null, error: 'Library not configured' };
    }

    const instance = this.library.getInstance(id);
    if (!instance) {
      return { artifactId: id, output: null, error: `Artifact not found: ${id}` };
    }

    const currRunning = this._running.get(id) || 0;
    if (currRunning >= this.maxConcurrent) {
      return { artifactId: id, output: null, error: 'concurrency limit' };
    }

    this._running.set(id, currRunning + 1);

    const controller = new AbortController();
    const cleanSeed = stripPrivate(seed);
    const executionState = {
      ...cleanSeed,
      _emit: (eventName, d) => this.emit(eventName, d),
      signal: seed.signal || controller.signal
    };

    try {
      const res = await instance.compute(input, executionState);
      const out = res && typeof res === 'object' && 'output' in res ? res.output : (res || {});
      return {
        artifactId: id,
        output: out,
        error: res.error || (out && out.error) || null
      };
    } catch (err) {
      logger.error(`Error during execution of [${id}]: ${err.message}`);
      return {
        artifactId: id,
        output: null,
        error: err.message
      };
    } finally {
      const count = this._running.get(id) || 1;
      if (count <= 1) {
        this._running.delete(id);
      } else {
        this._running.set(id, count - 1);
      }
    }
  }
}
