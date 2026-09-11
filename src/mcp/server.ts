// MCP server entry point (stdio transport).

import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../core/config.js';
import { initDatabase } from '../core/db.js';
import { TOOLS } from './tools.js';

function wrapResult(result: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig();
  initDatabase(config.db_path);

  const server = new McpServer({ name: 'm8m', version: '0.1.0' });
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startMcpServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
