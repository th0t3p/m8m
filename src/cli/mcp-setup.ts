// Auto-configure mem8 in common MCP clients (Codex, Claude Code, Cursor, DSH).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type McpClient = 'codex' | 'claude' | 'cursor' | 'dsh';

export const SUPPORTED_CLIENTS: McpClient[] = ['codex', 'claude', 'cursor', 'dsh'];

export interface AddResult {
  path: string;
  already: boolean;
  manualSnippet?: string;
}

interface ServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function serverSpec(dataDir?: string): ServerSpec {
  const spec: ServerSpec = { command: 'npx', args: ['-y', '@th0t3p/mem8', 'mcp'] };
  if (dataDir) spec.env = { MEM8_HOME: dataDir };
  return spec;
}

function ensureDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}

function readJson(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function jsonServerValue(spec: ServerSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { command: spec.command, args: spec.args };
  if (spec.env) out.env = spec.env;
  return out;
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function codexPath(): string {
  return join(homedir(), '.codex', 'config.toml');
}

function claudePath(): string {
  return join(homedir(), '.claude.json');
}

function cursorPath(): string {
  return join(homedir(), '.cursor', 'mcp.json');
}

function dshPath(): string {
  return join(dshHome(), 'cordis.patch.yml');
}

function addCodex(spec: ServerSpec): AddResult {
  const file = codexPath();
  ensureDir(file);
  if (existsSync(file) && /\[mcp_servers\.mem8\]/.test(readFileSync(file, 'utf8'))) {
    return { path: file, already: true };
  }
  let section = `\n[mcp_servers.mem8]\ncommand = "npx"\nargs = ["-y", "@th0t3p/mem8", "mcp"]\nstartup_timeout_sec = 30\n`;
  if (spec.env) {
    section += `\n[mcp_servers.mem8.env]\n`;
    for (const [k, v] of Object.entries(spec.env)) section += `${k} = "${v}"\n`;
  }
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, existing.trimEnd() + section, 'utf8');
  return { path: file, already: false };
}

function addClaude(spec: ServerSpec): AddResult {
  const file = claudePath();
  ensureDir(file);
  const data = readJson(file);
  const servers = (data.mcpServers as Record<string, unknown>) ?? {};
  if (servers.mem8) return { path: file, already: true };
  servers.mem8 = jsonServerValue(spec);
  data.mcpServers = servers;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return { path: file, already: false };
}

function addCursor(spec: ServerSpec): AddResult {
  const file = cursorPath();
  ensureDir(file);
  const data = readJson(file);
  const servers = (data.mcpServers as Record<string, unknown>) ?? {};
  if (servers.mem8) return { path: file, already: true };
  servers.mem8 = jsonServerValue(spec);
  data.mcpServers = servers;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return { path: file, already: false };
}

function dshYaml(spec: ServerSpec): string {
  const lines: string[] = [
    '- insert:',
    '    - id: mcp-mem8',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: mem8',
    '        transport: stdio',
    `        command: ${spec.command}`,
    '        args:',
  ];
  for (const a of spec.args) lines.push(`          - ${JSON.stringify(a)}`);
  if (spec.env) {
    lines.push('        env:');
    for (const [k, v] of Object.entries(spec.env)) lines.push(`          ${k}: ${v}`);
  }
  return lines.join('\n') + '\n';
}

function addDsh(spec: ServerSpec): AddResult {
  const file = dshPath();
  ensureDir(file);
  const existing = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  if (existing === '' || existing === '[]') {
    writeFileSync(file, dshYaml(spec), 'utf8');
    return { path: file, already: false };
  }
  if (existing.includes('mcp-mem8')) {
    return { path: file, already: true };
  }
  // Existing, non-empty patch — hand the user the exact YAML to merge in.
  return { path: file, already: false, manualSnippet: dshYaml(spec) };
}

export function addMem8ToClient(client: McpClient, dataDir?: string): AddResult {
  const spec = serverSpec(dataDir);
  switch (client) {
    case 'codex':
      return addCodex(spec);
    case 'claude':
      return addClaude(spec);
    case 'cursor':
      return addCursor(spec);
    case 'dsh':
      return addDsh(spec);
  }
}
