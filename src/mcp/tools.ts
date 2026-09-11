// MCP tool definitions (zod input schemas + metadata).

import { z } from 'zod';
import { handleFlag, handleRecent, handleSearch, handleStatus, handleStore } from './handlers.js';

export interface McpToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  handler: (args: any) => unknown;
}

export const TOOLS: McpToolDef[] = [
  {
    name: 'mem8_store',
    description:
      'Store a memory observation. Call this when you learn something new about the user that should be remembered across sessions.',
    schema: z.object({
      content: z.string().describe('The memory to store'),
      source_type: z
        .enum(['conversation', 'document', 'email', 'web_page', 'tool_output', 'ai_derived', 'user_explicit'])
        .optional(),
      source_detail: z.string().optional().describe('Additional context about where this memory came from'),
    }),
    handler: (args) => handleStore(args),
  },
  {
    name: 'mem8_search',
    description: 'Search stored memories by keyword. Returns relevant memories about the user.',
    schema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
    }),
    handler: (args) => handleSearch(args),
  },
  {
    name: 'mem8_recent',
    description: 'Get recently added or modified memories.',
    schema: z.object({
      limit: z.number().optional().describe('Max results (default 10)'),
      since: z.string().optional().describe('ISO datetime to filter from'),
    }),
    handler: (args) => handleRecent(args),
  },
  {
    name: 'mem8_status',
    description: 'Get memory store status: total count, flagged items, recent changes.',
    schema: z.object({}),
    handler: () => handleStatus(),
  },
  {
    name: 'mem8_flag',
    description: 'Flag a specific memory entry as suspicious.',
    schema: z.object({
      memory_id: z.string(),
      reason: z.string(),
    }),
    handler: (args) => handleFlag(args),
  },
];
