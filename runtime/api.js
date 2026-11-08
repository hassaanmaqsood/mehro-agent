import express from 'express';
import { dispatch } from './dispatch.js';

export function createApiRouter(config = {}) {
  const router = express.Router();

  // Uniform response handler helper
  const sendResult = (res, result) => {
    if (result && result.error) {
      const status = result.status || (result.code === 'unauthorized' ? 401 : (result.code === 'forbidden' ? 403 : 500));
      return res.status(status).json({
        error: true,
        code: result.code || 'server_error',
        reason: result.reason || result.error,
        status
      });
    }
    return res.json(result);
  };

  // 1. POST /api/run
  router.post('/run', async (req, res) => {
    const { taskId, graphId, artifactId, input, state } = req.body;
    const targetId = artifactId || graphId;
    const result = await dispatch('run.start', { artifactId: targetId, input, state, taskId }, req);
    sendResult(res, result);
  });

  // 2. GET /api/run/:id
  router.get('/run/:id', async (req, res) => {
    const result = await dispatch('run.get', { id: req.params.id }, req);
    sendResult(res, result);
  });

  // 3. GET /api/tasks
  router.get('/tasks', async (req, res) => {
    const result = await dispatch('task.list', {}, req);
    sendResult(res, result);
  });

  // 4. POST /api/tasks
  router.post('/tasks', async (req, res) => {
    const result = await dispatch('task.create', req.body, req);
    if (result && !result.error) {
      return res.status(201).json(result.task || result);
    }
    sendResult(res, result);
  });

  // 5. PATCH /api/tasks/:id
  router.patch('/tasks/:id', async (req, res) => {
    const result = await dispatch('task.update', { ...req.body, id: req.params.id }, req);
    if (result && !result.error) {
      return res.json(result.task || result);
    }
    sendResult(res, result);
  });

  // 6. DELETE /api/tasks/:id
  router.delete('/tasks/:id', async (req, res) => {
    const result = await dispatch('task.delete', { id: req.params.id }, req);
    if (result && !result.error) {
      return res.status(204).end();
    }
    sendResult(res, result);
  });

  // 7. GET /api/tools
  router.get('/tools', async (req, res) => {
    const result = await dispatch('library.list', req.query, req);
    sendResult(res, result);
  });

  // 8. GET /api/health
  router.get('/health', async (req, res) => {
    const status = await dispatch('runtime.status', {}, req);
    sendResult(res, { status: 'ok', ...status });
  });

  // 9. GET /api/workflows
  router.get('/workflows', async (req, res) => {
    const result = await dispatch('workflow.list', {}, req);
    sendResult(res, result);
  });

  // 10. POST /api/workflows/:name/run
  router.post('/workflows/:name/run', async (req, res) => {
    const result = await dispatch('workflow.run', {
      name: req.params.name,
      inputs: req.body.inputs || req.body
    }, req);
    sendResult(res, result);
  });

  // 11. POST /trigger/:eventName
  router.post('/trigger/:eventName', async (req, res) => {
    const result = await dispatch('trigger.emit', {
      event: req.params.eventName,
      data: req.body
    }, req);
    sendResult(res, result);
  });

  return router;
}

export default {
  createApiRouter
};
