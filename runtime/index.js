import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { pathToFileURL } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import yaml from 'yaml';
import { z } from 'zod';
import logger from '../src/logger.js';
import { initStore, closeStore, getDb } from './store.js';
import { setSystemContext, dispatch } from './dispatch.js';
import { createNodaicSystem } from '../engine/nodaic_minimal.js';
import { WorkflowScheduler } from '../engine/nodaic_scheduler.js';
import { rulesEngine } from './rules.js';
import { skillsRegistry } from './skills.js';
import { workflowRegistry } from './workflows.js';
import { agentRegistry } from './agents.js';
import { mcpClientManager } from './mcp-client.js';
import { createApiRouter } from './api.js';
import { createMcpRouter } from './mcp-server.js';
import { MehroTUI } from '../tui/tui.js';

// Built-in tools
import calculateTool from '../tools/core/calculate.js';
import delayTool from '../tools/core/delay.js';
import logTool from '../tools/core/log.js';
import stringTransformTool from '../tools/core/string-transform.js';
import tokenContextTool from '../tools/core/token-context.js';
import readFileTool from '../tools/io/read-file.js';
import writeFileTool from '../tools/io/write-file.js';
import shellTool from '../tools/io/shell.js';
import queryTool from '../tools/data/query.js';
import httpRequestTool from '../tools/network/http-request.js';
import webSearchTool from '../tools/network/web-search.js';
import taskCreateTool from '../tools/tasks/task-create.js';
import taskListTool from '../tools/tasks/task-list.js';
import taskUpdateTool from '../tools/tasks/task-update.js';
import taskDeleteTool from '../tools/tasks/task-delete.js';
import maskTool from '../tools/privacy/mask.js';
import unmaskTool from '../tools/privacy/unmask.js';
import recursiveAgentTool from '../tools/agent/recursive-agent.js';
import spawnAgentTool from '../tools/agent/spawn-agent.js';

const BUILTIN_TOOLS = [
  calculateTool,
  delayTool,
  logTool,
  stringTransformTool,
  tokenContextTool,
  readFileTool,
  writeFileTool,
  shellTool,
  queryTool,
  httpRequestTool,
  webSearchTool,
  taskCreateTool,
  taskListTool,
  taskUpdateTool,
  taskDeleteTool,
  maskTool,
  unmaskTool,
  recursiveAgentTool,
  spawnAgentTool
];

// Strict Zod Configuration Schemas
export const runtimeConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3030),
  wsEnabled: z.boolean().default(true),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  workspaceDir: z.string().default('./workspace'),
  dbPath: z.string().default('./data/mehro.db'),
  runtimeId: z.string().optional()
}).strict();

export const modelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.2),
  contextBudget: z.number().int().min(500).default(8000)
}).strict();

export const apiKeyEntrySchema = z.object({
  name: z.string().min(1),
  hash: z.string().min(1),
  scopes: z.array(z.string()).default(['run', 'read'])
}).strict();

export const securityConfigSchema = z.object({
  approvalMode: z.enum(['review', 'auto', 'allow-all']).default('auto'),
  shellAllowlist: z.array(z.string()).default([]),
  shellBlocklist: z.array(z.string()).default([]),
  requireConfirmation: z.boolean().default(true),
  apiKeys: z.array(apiKeyEntrySchema).default([])
}).strict();

export const webhookEndpointSchema = z.object({
  url: z.string().min(1),
  secret: z.string().min(1),
  events: z.array(z.string()).default([])
}).strict();

export const webhooksConfigSchema = z.object({
  enabled: z.boolean().default(true),
  events: z.array(z.string()).default([]),
  endpoints: z.array(webhookEndpointSchema).default([])
}).strict();

export const backendConfigSchema = z.object({
  url: z.string().min(1)
}).strict();

export const queryConfigSchema = z.object({
  defaultBackend: z.enum(['sqlite', 'elasticsearch', 'postgres']).default('sqlite'),
  backends: z.record(z.string(), backendConfigSchema).default({})
}).strict();

export const privacyPatternSchema = z.object({
  name: z.string().min(1),
  regex: z.string().min(1)
}).strict();

export const privacyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  patterns: z.array(privacyPatternSchema).default([])
}).strict();

export const tasksConfigSchema = z.object({
  namespace: z.string().default('tasks'),
  maxPerUser: z.number().int().default(500)
}).strict();

export const recursiveAgentConfigSchema = z.object({
  maxDepth: z.number().int().min(1).default(3)
}).strict();

export const skillsConfigSchema = z.object({
  dirs: z.array(z.string()).default(['./skills/builtin', './skills/user']),
  autoActivate: z.boolean().default(true),
  maxActive: z.number().int().default(3),
  hotReload: z.boolean().default(true)
}).strict();

export const rulesConfigSchema = z.object({
  dirs: z.array(z.string()).default(['./rules/builtin', './rules/user']),
  strict: z.boolean().default(true)
}).strict();

export const workflowsHistorySchema = z.object({
  maxRuns: z.number().int().default(1000),
  retentionDays: z.number().int().default(90)
}).strict();

export const workflowsSchedulerSchema = z.object({
  enabled: z.boolean().default(true),
  timezone: z.string().default('UTC')
}).strict();

export const workflowsConfigSchema = z.object({
  dirs: z.array(z.string()).default(['./workflows/builtin', './workflows/user']),
  hotReload: z.boolean().default(true),
  history: workflowsHistorySchema.default({ maxRuns: 1000, retentionDays: 90 }),
  scheduler: workflowsSchedulerSchema.default({ enabled: true, timezone: 'UTC' })
}).strict();

export const agentsConfigSchema = z.object({
  dirs: z.array(z.string()).default(['./agents/builtin', './agents/user']),
  hotReload: z.boolean().default(true),
  maxDepth: z.number().int().default(3),
  maxConcurrent: z.number().int().default(5),
  ephemeralStore: z.boolean().default(true),
  inheritRules: z.array(z.string()).default(['path-sandbox', 'pii-output-scan', 'api-scope-check'])
}).strict();

export const promptFilesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  watch: z.boolean().default(true),
  strict: z.boolean().default(false),
  globalDir: z.string().default('~/.mehro')
}).strict();

export const mcpServerConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  transport: z.enum(['stdio', 'http']).default('http'),
  auth: z.string().optional(),
  scopes: z.array(z.string()).default(['read'])
}).strict();

export const mcpConfigSchema = z.object({
  servers: z.array(mcpServerConfigSchema).default([])
}).strict();

// Master Root Config Schema
export const configSchema = z.object({
  runtime: runtimeConfigSchema,
  model: modelConfigSchema,
  security: securityConfigSchema,
  webhooks: webhooksConfigSchema.default({ enabled: true, events: [], endpoints: [] }),
  query: queryConfigSchema.default({ defaultBackend: 'sqlite', backends: {} }),
  privacy: privacyConfigSchema.default({ enabled: true, patterns: [] }),
  tasks: tasksConfigSchema.default({ namespace: 'tasks', maxPerUser: 500 }),
  recursiveAgent: recursiveAgentConfigSchema.default({ maxDepth: 3 }),
  skills: skillsConfigSchema.default({ dirs: ['./skills/builtin', './skills/user'], autoActivate: true, maxActive: 3, hotReload: true }),
  rules: rulesConfigSchema.default({ dirs: ['./rules/builtin', './rules/user'], strict: true }),
  workflows: workflowsConfigSchema.default({
    dirs: ['./workflows/builtin', './workflows/user'],
    hotReload: true,
    history: { maxRuns: 1000, retentionDays: 90 },
    scheduler: { enabled: true, timezone: 'UTC' }
  }),
  agents: agentsConfigSchema.default({
    dirs: ['./agents/builtin', './agents/user'],
    hotReload: true,
    maxDepth: 3,
    maxConcurrent: 5,
    ephemeralStore: true,
    inheritRules: ['path-sandbox', 'pii-output-scan', 'api-scope-check']
  }),
  promptFiles: promptFilesConfigSchema.default({ enabled: true, watch: true, strict: false, globalDir: '~/.mehro' }),
  mcp: mcpConfigSchema.default({ servers: [] })
}).strict();

let currentConfig = null;
let fileWatcher = null;

export function loadAndValidateConfig(configPath = './config.yaml') {
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found at: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8');
  let parsed;
  try {
    parsed = yaml.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse YAML from ${resolvedPath}: ${err.message}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const errorDetails = result.error.issues.map(iss => {
      const fieldPath = iss.path.join('.') || 'root';
      return `[${fieldPath}] ${iss.message}`;
    }).join('; ');
    throw new Error(`Config validation failed: ${errorDetails}`);
  }

  return result.data;
}

export function watchConfig(configPath = './config.yaml', onUpdate = null) {
  const resolvedPath = path.resolve(configPath);
  if (fileWatcher) {
    fileWatcher.close();
  }

  let debounceTimer = null;
  fileWatcher = fs.watch(resolvedPath, (eventType) => {
    if (eventType === 'change') {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          const updated = loadAndValidateConfig(resolvedPath);
          currentConfig = updated;
          logger.setLevel(updated.runtime.logLevel);
          setSystemContext({ config: updated });
          logger.info(`Hot-reloaded configuration from ${resolvedPath}`);
          if (onUpdate) onUpdate(updated);
        } catch (err) {
          logger.warn(`Config hot-reload ignored invalid update: ${err.message}`);
        }
      }, 100);
    }
  });

  return fileWatcher;
}

let activeHttpServer = null;
let activeWss = null;

export function boot(options = {}) {
  const configPath = options.configPath || './config.yaml';
  const config = loadAndValidateConfig(configPath);
  currentConfig = config;

  logger.setLevel(config.runtime.logLevel);
  logger.info(`Booting Mehro Agent v2 [Runtime Port: ${config.runtime.port}, Provider: ${config.model.provider}]`);

  // Ensure workspace directory exists
  const workspacePath = path.resolve(config.runtime.workspaceDir);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  // Initialize SQLite store
  const dbPath = options.inMemory ? ':memory:' : config.runtime.dbPath;
  const db = initStore(dbPath, { verbose: config.runtime.logLevel === 'debug' });
  logger.info(`Store initialized cleanly at ${dbPath}`);

  // Initialize Nodaic engine & scheduler
  const { library } = createNodaicSystem();
  const scheduler = new WorkflowScheduler(library);

  // Register built-in tools in library
  for (const tool of BUILTIN_TOOLS) {
    if (tool && tool.id) {
      library.addArtifact(tool);
    }
  }

  // Load rules, skills, workflows, agents
  rulesEngine.loadAllRules(config);
  skillsRegistry.loadDirs(config.skills?.dirs);
  workflowRegistry.loadDirs(config.workflows?.dirs, library, scheduler);
  agentRegistry.loadDirs(config.agents?.dirs);

  // Set system context
  setSystemContext({
    config,
    library,
    scheduler,
    agentRegistry: Object.fromEntries(agentRegistry.agents)
  });

  // Watch config if enabled
  if (options.watch !== false) {
    watchConfig(configPath);
  }

  let server = null;
  let wss = null;

  if (options.server) {
    const app = express();
    app.use(express.json());

    // CORS middleware
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.status(204).end();
      next();
    });

    // Mount API and MCP routers
    app.use('/api', createApiRouter(config));
    app.use('/mcp', createMcpRouter(config));

    // Fallback error handler
    app.use((err, req, res, next) => {
      logger.error(`Unhandled HTTP error: ${err.message}`);
      res.status(500).json({ error: true, code: 'server_error', reason: err.message, status: 500 });
    });

    server = createServer(app);

    if (config.runtime.wsEnabled) {
      wss = new WebSocketServer({ server });
      activeWss = wss;

      wss.on('connection', (ws, req) => {
        logger.debug(`[WS] Client connected from ${req.socket.remoteAddress}`);

        ws.on('message', async (data) => {
          try {
            const msg = JSON.parse(data.toString());
            const { action, payload = {}, token = null } = msg;

            const emitCallback = (eventData) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'event', data: eventData }));
              }
            };

            const result = await dispatch(action, payload, token || req, emitCallback);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'response', action, result }));
            }
          } catch (err) {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                error: true,
                code: 'ws_error',
                reason: err.message
              }));
            }
          }
        });

        ws.on('close', () => {
          logger.debug('[WS] Client disconnected');
        });
      });
    }

    const port = options.port || config.runtime.port;
    activeHttpServer = server;
    server.listen(port, '0.0.0.0', () => {
      logger.info(`Mehro Agent v2 HTTP server listening on http://0.0.0.0:${port}`);
      if (config.runtime.wsEnabled) {
        logger.info(`Mehro Agent v2 WebSocket listening on ws://0.0.0.0:${port}`);
      }
    });

    // Connect external MCP servers if configured
    if (config.mcp?.servers?.length > 0) {
      mcpClientManager.connectAll(config.mcp.servers, library);
    }
  }

  return { config, db, library, scheduler, server, wss };
}

export function shutdown() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  if (activeWss) {
    activeWss.close();
    activeWss = null;
  }
  if (activeHttpServer) {
    activeHttpServer.close();
    activeHttpServer = null;
  }
  closeStore();
  logger.info('Mehro Agent v2 runtime shutdown complete');
}

export function start(options = {}) {
  try {
    const booted = boot({ server: true, ...options });
    const isTTY = Boolean(process.stdout.isTTY);
    const disableTUI = process.argv.includes('--no-tui') || Boolean(process.env.HEADLESS) || options.tui === false;

    let tui = null;
    if (isTTY && !disableTUI) {
      tui = new MehroTUI({ approvalMode: booted.config?.security?.approvalMode || 'auto' });
    } else {
      logger.info('Mehro Agent v2 daemon running. Press Ctrl+C to terminate.');
    }

    const cleanExit = () => {
      if (tui) {
        tui.destroy();
        tui = null;
      }
      shutdown();
      process.exit(0);
    };

    process.on('SIGINT', cleanExit);
    process.on('SIGTERM', cleanExit);

    return { ...booted, tui };
  } catch (err) {
    logger.error(`Fatal startup failure: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

// Auto-start daemon when executed directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}

export { currentConfig };
