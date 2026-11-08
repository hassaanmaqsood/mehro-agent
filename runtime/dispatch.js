import crypto from 'crypto';
import logger from '../src/logger.js';
import { resolveAuth, hasScope } from './auth.js';
import { getDb, variablesRepo, auditRepo, workflowRunsRepo } from './store.js';
import { workflowRegistry } from './workflows.js';

let systemContext = {
  library: null,
  scheduler: null,
  config: {}
};

export function setSystemContext(ctx) {
  systemContext = { ...systemContext, ...ctx };
}

export function getSystemContext() {
  return systemContext;
}

const ACTION_SCOPES = {
  'whoami': null,
  'manifest': null,
  'runtime.status': 'read',
  'library.list': 'read',
  'library.get': 'read',
  'library.push': 'admin',
  'library.remove': 'admin',
  'run.start': 'run',
  'run.list': 'read',
  'run.get': 'read',
  'run.cancel': 'run',
  'trigger.emit': 'run',
  'trigger.bind': 'admin',
  'trigger.unbind': 'admin',
  'trigger.list': 'read',
  'variable.get': 'read',
  'variable.list': 'read',
  'variable.set': 'run',
  'variable.delete': 'admin',
  'secret.get': 'admin',
  'secret.set': 'admin',
  'secret.delete': 'admin',
  'secret.list': 'read',
  'audit.list': 'read',
  'workflow.list': 'read',
  'workflow.run': 'run',
  'workflow.get': 'read',
  'task.list': 'read',
  'task.create': 'run',
  'task.update': 'run',
  'task.delete': 'admin',
  'mcp.tools.list': 'mcp',
  'mcp.tools.call': 'mcp'
};

export async function dispatch(action, payload = {}, tokenOrAuth = null, emit = null) {
  const config = systemContext.config || {};

  // 1. Check if action is known or public
  const requiredScope = action in ACTION_SCOPES ? ACTION_SCOPES[action] : 'run';

  let auth = null;
  if (requiredScope !== null) {
    if (tokenOrAuth && typeof tokenOrAuth === 'object' && tokenOrAuth.valid !== undefined) {
      auth = tokenOrAuth;
    } else {
      auth = resolveAuth(tokenOrAuth, config);
    }

    if (!auth.valid) {
      return {
        error: true,
        code: auth.code || 'unauthorized',
        reason: auth.reason || 'Authentication required',
        status: auth.status || 401
      };
    }

    // 2. Enforce scope check BEFORE action switch
    if (!auth.isAdmin && !hasScope(auth.scopes, requiredScope)) {
      return {
        error: true,
        code: 'forbidden',
        reason: `Insufficient scope: required '${requiredScope}'`,
        status: 403
      };
    }
  } else {
    // Public / optional auth
    if (tokenOrAuth) {
      if (typeof tokenOrAuth === 'object' && tokenOrAuth.valid !== undefined) {
        auth = tokenOrAuth;
      } else {
        const res = resolveAuth(tokenOrAuth, config);
        if (res.valid) auth = res;
      }
    }
    if (!auth) {
      auth = { valid: false, role: 'none', keyId: 'anonymous', scopes: [], isAdmin: false };
    }
  }

  // 3. Action switch
  try {
    switch (action) {
      case 'whoami': {
        return {
          role: auth.role || 'none',
          keyId: auth.keyId || 'anonymous',
          isAdmin: Boolean(auth.isAdmin),
          scopes: auth.scopes || []
        };
      }

      case 'manifest': {
        return {
          runtime_type: 'mehro-v2-node',
          transport: 'http+ws',
          persistent_state: true,
          live_logs: true,
          secrets_revealable: false,
          artifact_deploy: true,
          concurrency_check: true,
          role_management: true,
          max_payload_bytes: 2097152,
          poll_interval_hint_ms: 1000,
          api: 'unified-v1',
          capabilities: {
            persistent: true,
            writable: true,
            interpreter: true,
            artifact_deploy: true,
            maxValueSize: 65536,
            sourceTypes: ['application/javascript', 'text/x-ndl', 'application/json'],
            languages: ['javascript', 'ndl']
          }
        };
      }

      case 'runtime.status': {
        return {
          runtimeId: config.runtime?.runtimeId || 'mehro-local',
          environment: process.env.NODE_ENV || 'development',
          uptime: process.uptime(),
          provider: config.model?.provider || 'ollama',
          logLevel: config.runtime?.logLevel || 'info'
        };
      }

      case 'library.list': {
        if (!systemContext.library) {
          return { artifacts: [], total: 0, offset: 0, limit: 50 };
        }
        const offset = Number(payload.offset) || 0;
        const limit = Number(payload.limit) || 50;
        const all = systemContext.library.list();
        const artifacts = all.slice(offset, offset + limit);
        return { artifacts, total: all.length, offset, limit };
      }

      case 'library.get': {
        if (!systemContext.library) {
          return { error: true, code: 'not_found', reason: 'Library not initialized', status: 404 };
        }
        const art = systemContext.library.getArtifact(payload.id, payload.version || 'latest');
        if (!art) {
          return { error: true, code: 'not_found', reason: `Artifact not found: ${payload.id}`, status: 404 };
        }
        // Only return source for admin role
        const copy = { ...art };
        if (!auth.isAdmin) {
          delete copy.source;
        }
        return copy;
      }

      case 'library.push': {
        if (!systemContext.library) {
          return { error: true, code: 'server_error', reason: 'Library not initialized', status: 500 };
        }
        const { artifact } = payload;
        if (!artifact || !artifact.id) {
          return { error: true, code: 'bad_request', reason: 'Missing artifact or artifact.id', status: 400 };
        }
        const saved = systemContext.library.addArtifact(artifact);
        return { id: saved.id, version: saved.version, status: 'saved', artifact: saved };
      }

      case 'library.remove': {
        if (!systemContext.library) {
          return { error: true, code: 'server_error', reason: 'Library not initialized', status: 500 };
        }
        const removed = systemContext.library.removeArtifact(payload.id, payload.version);
        return { id: payload.id, status: removed ? 'deleted' : 'not_found' };
      }

      case 'run.start': {
        if (!systemContext.scheduler) {
          return { error: true, code: 'server_error', reason: 'Scheduler not initialized', status: 500 };
        }
        const { artifactId, input = {}, state = {} } = payload;
        if (!artifactId) {
          return { error: true, code: 'bad_request', reason: 'Missing artifactId', status: 400 };
        }

        const runId = workflowRunsRepo.create(artifactId, input);
        const startTime = Date.now();

        try {
          const res = await systemContext.scheduler.run(artifactId, input, state);
          const duration = Date.now() - startTime;
          workflowRunsRepo.complete(runId, res, duration);
          return { runId, output: res, durationMs: duration };
        } catch (err) {
          const duration = Date.now() - startTime;
          workflowRunsRepo.fail(runId, err.message, duration);
          return { error: true, code: 'execution_failed', reason: err.message, status: 500, runId };
        }
      }

      case 'variable.set': {
        const { namespace = 'default', key, value, type = 'variable', encrypted = false, roles = null } = payload;
        if (!key) {
          return { error: true, code: 'bad_request', reason: 'Missing variable key', status: 400 };
        }
        const result = variablesRepo.set(namespace, key, value, type, encrypted, roles);
        return { status: 'saved', ...result };
      }

      case 'variable.get': {
        const { namespace = 'default', key } = payload;
        if (!key) {
          return { error: true, code: 'bad_request', reason: 'Missing variable key', status: 400 };
        }
        const result = variablesRepo.get(namespace, key);
        if (!result) {
          return { error: true, code: 'not_found', reason: `Variable not found: ${namespace}:${key}`, status: 404 };
        }
        return result;
      }

      case 'variable.delete': {
        const { namespace = 'default', key } = payload;
        if (!key) {
          return { error: true, code: 'bad_request', reason: 'Missing variable key', status: 400 };
        }
        const deleted = variablesRepo.delete(namespace, key);
        return { status: deleted ? 'deleted' : 'not_found' };
      }

      case 'variable.list': {
        const { namespace = null } = payload;
        const list = variablesRepo.list(namespace);
        return { variables: list };
      }

      case 'audit.list': {
        const { toolId, runId, limit, offset } = payload;
        const entries = auditRepo.query({ toolId, runId, limit, offset });
        return { entries };
      }

      case 'run.list': {
        const limit = Number(payload.limit) || 50;
        const list = workflowRunsRepo.list(limit);
        return { runs: list, total: list.length };
      }

      case 'run.get': {
        const id = payload.id || payload.runId;
        if (!id) return { error: true, code: 'bad_request', reason: 'Missing run id', status: 400 };
        const run = workflowRunsRepo.get(id);
        if (!run) return { error: true, code: 'not_found', reason: `Run not found: ${id}`, status: 404 };
        return run;
      }

      case 'run.cancel': {
        const id = payload.id || payload.runId;
        if (!id) return { error: true, code: 'bad_request', reason: 'Missing run id', status: 400 };
        workflowRunsRepo.fail(id, 'Cancelled by user', 0);
        return { id, status: 'cancelled' };
      }

      case 'trigger.emit': {
        if (!systemContext.scheduler) {
          return { error: true, code: 'server_error', reason: 'Scheduler not initialized', status: 500 };
        }
        const { event, data = {} } = payload;
        if (!event) return { error: true, code: 'bad_request', reason: 'Missing event name', status: 400 };
        const results = await systemContext.scheduler.emit(event, data);
        return { event, dispatched: true, results };
      }

      case 'trigger.bind': {
        if (!systemContext.scheduler) {
          return { error: true, code: 'server_error', reason: 'Scheduler not initialized', status: 500 };
        }
        const { event, artifactId, once = false } = payload;
        if (!event || !artifactId) return { error: true, code: 'bad_request', reason: 'Missing event or artifactId', status: 400 };
        systemContext.scheduler.on(event, artifactId, { once });
        return { status: 'bound', event, artifactId };
      }

      case 'trigger.unbind': {
        if (!systemContext.scheduler) {
          return { error: true, code: 'server_error', reason: 'Scheduler not initialized', status: 500 };
        }
        const { event, artifactId } = payload;
        if (!event) return { error: true, code: 'bad_request', reason: 'Missing event', status: 400 };
        systemContext.scheduler.off(event, artifactId);
        return { status: 'unbound', event, artifactId };
      }

      case 'trigger.list': {
        if (!systemContext.scheduler) {
          return { bindings: {} };
        }
        return { bindings: systemContext.scheduler.bindings() };
      }

      case 'secret.set': {
        const { key, value } = payload;
        if (!key) return { error: true, code: 'bad_request', reason: 'Missing secret key', status: 400 };
        variablesRepo.set('secrets', key, value, 'secret', true);
        return { status: 'saved', key, type: 'secret' };
      }

      case 'secret.get': {
        const { key } = payload;
        if (!key) return { error: true, code: 'bad_request', reason: 'Missing secret key', status: 400 };
        const result = variablesRepo.get('secrets', key);
        if (!result) return { error: true, code: 'not_found', reason: `Secret not found: ${key}`, status: 404 };
        return result;
      }

      case 'secret.delete': {
        const { key } = payload;
        if (!key) return { error: true, code: 'bad_request', reason: 'Missing secret key', status: 400 };
        const deleted = variablesRepo.delete('secrets', key);
        return { status: deleted ? 'deleted' : 'not_found' };
      }

      case 'secret.list': {
        const list = variablesRepo.list('secrets');
        return { secrets: list.map(s => ({ key: s.key, type: s.type, updatedAt: s.updated_at })) };
      }

      case 'workflow.list': {
        return { workflows: workflowRegistry.list() };
      }

      case 'workflow.get': {
        const { name } = payload;
        if (!name) return { error: true, code: 'bad_request', reason: 'Missing workflow name', status: 400 };
        const wf = workflowRegistry.get(name);
        if (!wf) return { error: true, code: 'not_found', reason: `Workflow not found: ${name}`, status: 404 };
        return wf;
      }

      case 'workflow.run': {
        const { name, inputs = {} } = payload;
        if (!name) return { error: true, code: 'bad_request', reason: 'Missing workflow name', status: 400 };
        const wf = workflowRegistry.get(name);
        if (!wf) return { error: true, code: 'not_found', reason: `Workflow not found: ${name}`, status: 404 };
        const validation = workflowRegistry.validateInputs(wf, inputs);
        if (!validation.valid) {
          return { error: true, code: 'bad_request', reason: validation.error, status: 400 };
        }
        return dispatch('run.start', { artifactId: `workflows/${wf.name}`, input: validation.inputs }, auth);
      }

      case 'task.list': {
        const rows = variablesRepo.list('tasks');
        const tasks = rows.map(r => variablesRepo.get('tasks', r.key)?.value).filter(Boolean);
        return { tasks, total: tasks.length };
      }

      case 'task.create': {
        const { prompt, priority = 1, metadata = {} } = payload;
        if (!prompt) return { error: true, code: 'bad_request', reason: 'Missing task prompt', status: 400 };
        const taskId = crypto.randomUUID();
        const taskRecord = {
          id: taskId,
          prompt,
          status: 'pending',
          priority,
          metadata,
          createdAt: new Date().toISOString()
        };
        variablesRepo.set('tasks', taskId, taskRecord, 'state');
        return { status: 'created', task: taskRecord };
      }

      case 'task.update': {
        const { id } = payload;
        if (!id) return { error: true, code: 'bad_request', reason: 'Missing task id', status: 400 };
        const existing = variablesRepo.get('tasks', id);
        if (!existing || !existing.value) {
          return { error: true, code: 'not_found', reason: `Task not found: ${id}`, status: 404 };
        }
        const updated = { ...existing.value, ...payload, id, updatedAt: new Date().toISOString() };
        variablesRepo.set('tasks', id, updated, 'state');
        return { status: 'updated', task: updated };
      }

      case 'task.delete': {
        const { id } = payload;
        if (!id) return { error: true, code: 'bad_request', reason: 'Missing task id', status: 400 };
        const deleted = variablesRepo.delete('tasks', id);
        return { status: deleted ? 'deleted' : 'not_found' };
      }

      case 'mcp.tools.list': {
        const { library } = systemContext;
        const artifacts = library ? library.list() : [];
        const tools = artifacts
          .filter(a => a.artifactType === 'process')
          .map(a => ({
            name: a.id,
            description: a.metadata?.description || '',
            inputSchema: a.interface?.inputs || {}
          }));
        return { tools };
      }

      case 'mcp.tools.call': {
        const { library } = systemContext;
        if (!library) return { error: true, code: 'server_error', reason: 'Library not ready', status: 500 };
        const { name, arguments: toolArgs = {} } = payload;
        if (!name) return { error: true, code: 'bad_request', reason: 'Missing tool name', status: 400 };
        const proc = library.getInstance(name);
        if (!proc) return { error: true, code: 'not_found', reason: `Tool not found: ${name}`, status: 404 };
        const res = await proc.compute(toolArgs, { caller: auth.keyId });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res.output)
            }
          ],
          isError: Boolean(res.error || res.output?.error)
        };
      }

      default: {
        return {
          error: true,
          code: 'not_implemented',
          reason: `Action '${action}' not implemented or recognized`,
          status: 400
        };
      }
    }
  } catch (err) {
    logger.error(`Error in dispatch [${action}]: ${err.message}`, { stack: err.stack });
    return {
      error: true,
      code: 'server_error',
      reason: err.message,
      status: 500
    };
  }
}
