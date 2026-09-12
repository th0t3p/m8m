// MCP tool definitions (zod input schemas + metadata).

import { z } from 'zod';
import { handleDelete, handleFlag, handleRecent, handleSearch, handleStatus, handleStore } from './handlers.js';

export interface McpToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  handler: (args: any) => unknown;
}

export const TOOLS: McpToolDef[] = [
  {
    name: 'm8m_store',
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
    name: 'm8m_search',
    description: 'Search stored memories by keyword. Returns relevant memories about the user.',
    schema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
    }),
    handler: (args) => handleSearch(args),
  },
  {
    name: 'm8m_recent',
    description: 'Get recently added or modified memories.',
    schema: z.object({
      limit: z.number().optional().describe('Max results (default 10)'),
      since: z.string().optional().describe('ISO datetime to filter from'),
    }),
    handler: (args) => handleRecent(args),
  },
  {
    name: 'm8m_status',
    description: 'Get memory store status: total count, flagged items, recent changes.',
    schema: z.object({}),
    handler: () => handleStatus(),
  },
  {
    name: 'm8m_flag',
    description: 'Flag a specific memory entry as suspicious.',
    schema: z.object({
      memory_id: z.string(),
      reason: z.string(),
    }),
    handler: (args) => handleFlag(args),
  },
  {
    name: 'm8m_delete',
    description:
      'Soft-delete a memory by id. Reversible — the row and its history are retained with status "deleted".',
    schema: z.object({
      memory_id: z.string(),
    }),
    handler: (args) => handleDelete(args),
  },
];
