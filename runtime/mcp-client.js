import logger from '../src/logger.js';

export class McpClientManager {
  constructor() {
    this.servers = new Map(); // serverName -> { config, status, tools, backoffMs }
    this.reconnectTimers = new Map();
  }

  async connectAll(serverConfigs = [], library = null) {
    for (const s of serverConfigs) {
      await this.connectServer(s, library);
    }
  }

  async connectServer(serverConfig, library = null) {
    const { name, url, transport = 'http' } = serverConfig;
    if (!name) return;

    logger.info(`[MCP-CLIENT] Connecting to external MCP server '${name}' (${url})`);

    try {
      // Connect / discover tools from remote server
      const tools = await this._discoverTools(serverConfig);
      this.servers.set(name, {
        config: serverConfig,
        status: 'connected',
        tools,
        backoffMs: 1000
      });

      // Wrap and push each tool to library
      if (library) {
        for (const tool of tools) {
          const artifact = this.wrapMcpTool(name, tool, async (callArgs) => {
            return this._callRemoteTool(serverConfig, tool.name, callArgs);
          });
          library.addArtifact(artifact);
        }
      }

      logger.info(`[MCP-CLIENT] Discovered ${tools.length} tools from server '${name}'`);
    } catch (err) {
      logger.warn(`[MCP-CLIENT] Failed to connect to '${name}': ${err.message}. Will retry.`);
      this.servers.set(name, {
        config: serverConfig,
        status: 'disconnected',
        tools: [],
        backoffMs: 1000
      });
      this._scheduleReconnect(serverConfig, library);
    }
  }

  wrapMcpTool(serverName, mcpTool, callerFn) {
    return {
      id: `mcp/${serverName}/${mcpTool.name}`,
      version: '1.0.0',
      artifactType: 'process',
      sourceType: 'application/javascript',
      metadata: {
        name: `${serverName}:${mcpTool.name}`,
        description: mcpTool.description || `MCP tool from ${serverName}`,
        tags: ['mcp', serverName]
      },
      interface: {
        inputs: mcpTool.inputSchema || {},
        outputs: {}
      },
      source: async (input, state, cb) => {
        try {
          const result = await callerFn(input);
          cb({ output: { result, error: null }, state });
        } catch (e) {
          cb({ output: { result: null, error: e.message }, state });
        }
      }
    };
  }

  getConnectedTools() {
    const activeTools = [];
    for (const [name, info] of this.servers.entries()) {
      if (info.status === 'connected') {
        activeTools.push(...info.tools.map(t => ({
          id: `mcp/${name}/${t.name}`,
          name: t.name,
          description: t.description,
          server: name,
          inputSchema: t.inputSchema || {}
        })));
      }
    }
    return activeTools;
  }

  async _discoverTools(serverConfig) {
    if (serverConfig.transport === 'http') {
      const res = await fetch(`${serverConfig.url}/tools/list`, {
        headers: serverConfig.auth ? { 'Authorization': `Bearer ${serverConfig.auth}` } : {}
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      return data.tools || [];
    }

    // Default or mock transport
    return serverConfig.mockTools || [];
  }

  async _callRemoteTool(serverConfig, toolName, args) {
    if (serverConfig.transport === 'http') {
      const res = await fetch(`${serverConfig.url}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(serverConfig.auth ? { 'Authorization': `Bearer ${serverConfig.auth}` } : {})
        },
        body: JSON.stringify({ name: toolName, arguments: args })
      });
      if (!res.ok) throw new Error(`Remote MCP error: ${res.statusText}`);
      return await res.json();
    }
    return { executed: true, server: serverConfig.name, tool: toolName, args };
  }

  _scheduleReconnect(serverConfig, library) {
    const name = serverConfig.name;
    const existing = this.servers.get(name);
    const backoff = Math.min((existing?.backoffMs || 1000) * 2, 30000);

    if (this.reconnectTimers.has(name)) {
      clearTimeout(this.reconnectTimers.get(name));
    }

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(name);
      await this.connectServer({ ...serverConfig, backoffMs: backoff }, library);
    }, backoff);

    this.reconnectTimers.set(name, timer);
  }

  disconnectAll() {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.servers.clear();
  }
}

export const mcpClientManager = new McpClientManager();
export default mcpClientManager;
