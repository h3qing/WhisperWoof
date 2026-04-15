/**
 * PluginManager — MCP Client Implementation
 *
 * Uses the official @modelcontextprotocol/sdk to connect to MCP servers.
 * Each plugin is an MCP server process. WhisperWoof is the MCP client.
 *
 * Connection: StdioClientTransport spawns the server command and communicates
 * via JSON-RPC 2.0 over stdin/stdout (the MCP wire protocol).
 */

import type { PluginConfig, PluginResult, PluginStatus } from './types';

// MCP SDK types — dynamic import to avoid breaking if SDK not installed
type McpClient = {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  listTools: () => Promise<{ tools: Array<{ name: string; description?: string }> }>;
};

interface PluginEntry {
  readonly config: PluginConfig;
  client: McpClient | null;
  transport: unknown | null;
  connected: boolean;
  tools: string[];
  error?: string;
}

export class PluginManager {
  private readonly plugins: Map<string, PluginEntry> = new Map();

  /**
   * Register a plugin config. Does not connect yet.
   */
  registerPlugin(config: PluginConfig): void {
    this.validateConfig(config);

    if (this.plugins.has(config.id)) {
      throw new Error(`Plugin already registered: "${config.id}"`);
    }

    this.plugins.set(config.id, {
      config: { ...config },
      client: null,
      transport: null,
      connected: false,
      tools: [],
    });
  }

  /**
   * Connect to a plugin's MCP server using the real MCP SDK.
   * Spawns the command as a child process with StdioClientTransport.
   */
  async connectPlugin(pluginId: string): Promise<void> {
    const entry = this.getEntryOrThrow(pluginId);

    if (entry.connected && entry.client) {
      throw new Error(`Plugin "${pluginId}" is already connected`);
    }

    const { config } = entry;

    try {
      // Dynamic import of MCP SDK (avoids compile-time dependency issues)
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

      // Create transport — spawns the MCP server process
      const [command = "", ...args] = config.command.split(/\s+/);
      const transport = new StdioClientTransport({
        command,
        args: [...args, ...(config.args ?? [])],
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      });

      // Create MCP client
      const client = new Client(
        { name: 'whisperwoof', version: '1.5.0' },
        { capabilities: {} }
      );

      // Connect
      await client.connect(transport);

      // List available tools
      let tools: string[] = [];
      try {
        const toolList = await client.listTools();
        tools = toolList.tools.map((t: { name: string }) => t.name);
      } catch {
        // Some servers may not support listTools
      }

      this.plugins.set(pluginId, {
        config: entry.config,
        client: client as unknown as McpClient,
        transport,
        connected: true,
        tools,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      this.plugins.set(pluginId, {
        config: entry.config,
        client: null,
        transport: null,
        connected: false,
        tools: [],
        error: message,
      });
      throw new Error(`Failed to connect plugin "${pluginId}": ${message}`);
    }
  }

  /**
   * Disconnect a plugin by closing the MCP client connection.
   */
  async disconnectPlugin(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;

    if (entry.client) {
      try {
        await entry.client.close();
      } catch {
        // Ignore close errors
      }
    }

    this.plugins.set(pluginId, {
      config: entry.config,
      client: null,
      transport: null,
      connected: false,
      tools: [],
    });
  }

  /**
   * Execute a tool on a connected plugin via MCP's callTool method.
   * If the plugin has a tool named "execute", uses that.
   * Otherwise uses the first available tool.
   */
  async executePlugin(
    pluginId: string,
    text: string,
    metadata?: Record<string, unknown>,
  ): Promise<PluginResult> {
    const entry = this.plugins.get(pluginId);

    if (!entry) {
      return { success: false, error: `Plugin not registered: "${pluginId}"` };
    }

    if (!entry.connected || !entry.client) {
      return { success: false, error: `Plugin "${pluginId}" is not connected` };
    }

    try {
      // Find the best tool to call
      const toolName = entry.tools.includes('execute')
        ? 'execute'
        : entry.tools[0] ?? 'execute';

      const result = await entry.client.callTool({
        name: toolName,
        arguments: { text, ...(metadata ?? {}) },
      });

      // Extract text from MCP tool result
      const textContent = result.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text ?? '')
        .join('\n');

      return {
        success: true,
        message: textContent || 'Action completed',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      return { success: false, error: message };
    }
  }

  /**
   * Get available tools for a connected plugin.
   */
  getPluginTools(pluginId: string): readonly string[] {
    return this.plugins.get(pluginId)?.tools ?? [];
  }

  /**
   * Get connection status of every registered plugin.
   */
  getStatuses(): readonly PluginStatus[] {
    return Array.from(this.plugins.values()).map((entry) => ({
      id: entry.config.id,
      name: entry.config.name,
      connected: entry.connected,
      ...(entry.error ? { error: entry.error } : {}),
    }));
  }

  /**
   * Disconnect all plugins.
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.plugins.keys());
    await Promise.all(ids.map((id) => this.disconnectPlugin(id)));
  }

  // --- Private ---

  private getEntryOrThrow(pluginId: string): PluginEntry {
    const entry = this.plugins.get(pluginId);
    if (!entry) {
      throw new Error(`Plugin not registered: "${pluginId}"`);
    }
    return entry;
  }

  private validateConfig(config: PluginConfig): void {
    if (!config.id) throw new Error('Plugin config must have an id');
    if (!config.name) throw new Error('Plugin config must have a name');
    if (!config.command) throw new Error('Plugin config must have a command');
  }
}
