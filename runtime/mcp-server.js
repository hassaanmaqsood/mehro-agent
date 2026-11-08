import express from 'express';
import logger from '../src/logger.js';
import { resolveAuth, hasScope } from './auth.js';
import { getSystemContext, dispatch } from './dispatch.js';
import { skillsRegistry } from './skills.js';
import { auditRepo, variablesRepo } from './store.js';

export function createMcpRouter(config = {}) {
  const router = express.Router();

  // Scope check middleware for MCP routes: requires 'mcp' or 'admin'
  router.use((req, res, next) => {
    const auth = resolveAuth(req, config);
    if (!auth.valid) {
      return res.status(auth.status || 401).json({
        error: true,
        code: auth.code || 'unauthorized',
        reason: auth.reason || 'Authentication required',
        status: auth.status || 401
      });
    }

    if (!auth.isAdmin && !hasScope(auth.scopes, 'mcp')) {
      return res.status(403).json({
        error: true,
        code: 'forbidden',
        reason: "Insufficient scope: requires 'mcp'",
        status: 403
      });
    }

    req.auth = auth;
    next();
  });

  // 1. GET /mcp - Capability manifest
  router.get('/', (req, res) => {
    res.json({
      name: 'mehro-mcp-server',
      version: '2.0.0',
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: true }
      }
    });
  });

  // 2. GET /mcp/tools/list - All registered tools
  router.get('/tools/list', async (req, res) => {
    const result = await dispatch('mcp.tools.list', {}, req);
    if (result && result.error) {
      return res.status(result.status || 500).json(result);
    }
    res.json(result);
  });

  // 3. POST /mcp/tools/call - Call a tool
  router.post('/tools/call', async (req, res) => {
    const { name, arguments: toolArgs = {} } = req.body;
    if (!name) {
      return res.status(400).json({
        error: true,
        code: 'bad_request',
        reason: 'Missing tool "name" in request body',
        status: 400
      });
    }

    const result = await dispatch('mcp.tools.call', { name, arguments: toolArgs }, req);
    if (result && result.error) {
      return res.status(result.status || 500).json(result);
    }
    res.json(result);
  });

  // 4. GET /mcp/resources/list - Exposed resources
  router.get('/resources/list', (req, res) => {
    res.json({
      resources: [
        {
          uri: 'mehro://store/variables',
          name: 'Variables Store',
          description: 'Persistent key-value variables store',
          mimeType: 'application/json'
        },
        {
          uri: 'mehro://store/audit-log',
          name: 'Audit Log',
          description: 'Historical audit log of tool and execution events',
          mimeType: 'application/json'
        },
        {
          uri: 'mehro://workspace',
          name: 'Workspace Directory',
          description: 'Sandboxed files within workspace',
          mimeType: 'text/directory'
        }
      ]
    });
  });

  // 5. GET /mcp/prompts/list - Skills as MCP prompts
  router.get('/prompts/list', (req, res) => {
    const prompts = Array.from(skillsRegistry.skills.values()).map(skill => ({
      name: skill.name,
      description: `Skill: ${skill.name}`,
      arguments: [
        {
          name: 'prompt',
          description: 'User prompt or task for this skill',
          required: false
        }
      ]
    }));

    res.json({ prompts });
  });

  return router;
}

export default {
  createMcpRouter
};
