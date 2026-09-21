// MCP server entry point (stdio transport).

import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../core/config.js';
import { initDatabase } from '../core/db.js';
import { startAutoSnapshot } from '../core/autosnapshot.js';
import { VERSION } from '../version.js';
import { startWatcher } from '../watcher/watcher.js';
import { setClientPlatform } from './handlers.js';
import { TOOLS } from './tools.js';

function wrapResult(result: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig();
  initDatabase(config.db_path);

  // The MCP server already runs as a long-lived daemon (kept alive by its
  // client), so run the file watcher in-process to re-import memory files as
  // they change — no separate `m8m watch` needed. Watcher logs go to stderr;
  // stdout stays clean for the JSON-RPC transport.
  let closeWatcher = (): void => {};
  try {
    closeWatcher = await startWatcher(config);
  } catch (err) {
    console.error('[m8m watcher] failed to start:', err);
  }

  // Same for the periodic auto-snapshot (rollback baselines).
  const closeAutoSnapshot = startAutoSnapshot(config.auto_snapshot_interval_minutes);

  const server = new McpServer({ name: 'm8m', version: VERSION });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: any) => {
        try {
          return wrapResult(await tool.handler(args));
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );
  }

  // Record the client's self-reported name after the initialize handshake
  // completes. `connect()` only starts the transport and returns before the
  // initialize request has been handled, so reading getClientVersion() there
  // yields undefined. The SDK fires `oninitialized` once the client sends
  // `notifications/initialized`, which is guaranteed to be after `_oninitialize`
  // has captured clientInfo.
  server.server.oninitialized = () => {
    setClientPlatform(server.server.getClientVersion()?.name);
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // When the client disconnects (stdin closes), stop the watcher + snapshot
  // timer so the process exits cleanly instead of lingering on open handles.
  let shutdown = false;
  const onShutdown = (): void => {
    if (shutdown) return;
    shutdown = true;
    closeWatcher();
    closeAutoSnapshot();
  };
  process.stdin.on('end', onShutdown);
  process.stdin.on('close', onShutdown);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startMcpServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
