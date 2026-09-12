// Parsers for memory file formats (markdown, JSON, TOML, YAML).

import type { ParsedMemory } from '../core/types.js';

function pushLine(
  out: ParsedMemory[],
  content: string,
  raw: string,
  line_number?: number,
  section?: string,
): void {
  const trimmed = content.trim();
  if (trimmed.length < 2) return;
  out.push({ content: trimmed, line_number, section, raw_text: raw });
}

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

export type MemoryFileType =
  | 'fact_list'
  | 'structured_doc'
  | 'json_config'
  | 'toml_config'
  | 'yaml_config'
  | 'unknown';

export function detectFileType(content: string, filePath: string): MemoryFileType {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  if (ext === 'json') return 'json_config';
  if (ext === 'toml') return 'toml_config';
  if (ext === 'yml' || ext === 'yaml') return 'yaml_config';

  // Markdown / plain text: distinguish a fact list from a structured document.
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  const nonBlank = lines.filter((l) => l && !l.startsWith('<!--'));
  if (nonBlank.length === 0) return 'fact_list';

  const subHeaders = lines.filter((l) => /^#{2,6}\s+/.test(l)).length; // ## / ### / …
  const hasCode = content.includes('```');

  // Lines that look like discrete facts: bullets, numbered items, key: value.
  const factLike = nonBlank.filter(
    (l) => /^[-*+]\s+/.test(l) || /^\d+[.)]\s+/.test(l) || /^[A-Za-z_][\w.-]*\s*:\s+/.test(l),
  ).length;
  const ratio = factLike / nonBlank.length;

  if (hasCode) return 'structured_doc';
  if (subHeaders >= 2) return 'structured_doc';
  if (ratio >= 0.5) return 'fact_list';
  return 'fact_list'; // safe default for unrecognized formats
}

// ---------------------------------------------------------------------------
// Fact list (line-by-line, one fact per line)
// ---------------------------------------------------------------------------

function parseFactList(content: string): ParsedMemory[] {
  const lines = content.split(/\r?\n/);
  const out: ParsedMemory[] = [];
  let section: string | undefined;
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line || line.startsWith('<!--') || /^(---|\*\*\*|___)\s*$/.test(line)) {
      i++;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      section = line.replace(/^#{1,6}\s+/, '').trim();
      i++;
      continue;
    }

    let text = line;
    if (/^[-*+]\s+/.test(text)) text = text.replace(/^[-*+]\s+/, '');
    else if (/^\d+[.)]\s+/.test(text)) text = text.replace(/^\d+[.)]\s+/, '');
    const startLine = i + 1;
    const parts: string[] = [text];
    i++;

    // Merge continuations: indented lines, indented sub-bullets, shell `\`.
    while (i < lines.length) {
      const nl = lines[i];
      const t = nl.trim();
      if (!t || t.startsWith('<!--')) break;
      if (/^#{1,6}\s+/.test(t) || /^(---|\*\*\*|___)\s*$/.test(t)) break;
      if (/^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) break; // new top-level bullet
      const last = parts[parts.length - 1];
      const continues = last.endsWith('\\') || /^\s+/.test(nl);
      if (!continues) break;
      if (last.endsWith('\\')) parts[parts.length - 1] = last.slice(0, -1).trimEnd();
      parts.push(t);
      i++;
    }

    pushLine(out, parts.join(' '), raw, startLine, section);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structured markdown (sections, code blocks never split)
// ---------------------------------------------------------------------------

interface HeaderInfo {
  line: number;
  level: number;
  text: string;
}

function splitLongSection(body: string, section: string, startLine: number): ParsedMemory[] {
  if (body.length <= 2000) {
    return [{ content: body, section, line_number: startLine, raw_text: body }];
  }
  // Split at paragraph boundaries (best-effort for oversized sections).
  const out: ParsedMemory[] = [];
  for (const para of body.split(/\n\s*\n/)) {
    const p = para.trim();
    if (p) out.push({ content: p, section, line_number: startLine, raw_text: p });
  }
  return out;
}

function parseStructuredMarkdown(content: string): ParsedMemory[] {
  const lines = content.split(/\r?\n/);
  const headers: HeaderInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) headers.push({ line: i, level: m[1].length, text: m[2].trim() });
  }

  if (headers.length === 0) {
    // No headers: each paragraph is a section.
    const out: ParsedMemory[] = [];
    const paras = content.split(/\n\s*\n/);
    let lineNo = 1;
    for (const para of paras) {
      const p = para.trim();
      const lineCount = para.split('\n').length;
      if (p) out.push({ content: p, line_number: lineNo, raw_text: p });
      lineNo += lineCount + 1;
    }
    return out;
  }

  const out: ParsedMemory[] = [];

  // Preamble before the first header.
  if (headers[0].line > 0) {
    const preamble = lines.slice(0, headers[0].line).join('\n').trim();
    if (preamble) out.push({ content: preamble, line_number: 1, raw_text: preamble });
  }

  const minLevel = Math.min(...headers.map((h) => h.level));

  for (let h = 0; h < headers.length; h++) {
    const header = headers[h];
    let endLine = lines.length;
    for (let k = h + 1; k < headers.length; k++) {
      const next = headers[k];
      // End at a same-or-shallower header, or (for the shallowest/title level)
      // at the first deeper header so a document title doesn't swallow sections.
      const sameOrShallower = next.level <= header.level;
      const deeperFromTitle = header.level === minLevel && next.level === minLevel + 1;
      if (sameOrShallower || deeperFromTitle) {
        endLine = next.line;
        break;
      }
    }
    const body = lines.slice(header.line, endLine).join('\n').trim();
    if (!body) continue;
    out.push(...splitLongSection(body, header.text, header.line + 1));
  }

  return out;
}

export function parseMarkdownMemoryFile(content: string, filePath?: string): ParsedMemory[] {
  const type = detectFileType(content, filePath ?? '');
  return type === 'structured_doc' ? parseStructuredMarkdown(content) : parseFactList(content);
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** Generic JSON memory file (array of strings/objects, or key-value object). */
export function parseJsonMemoryFile(content: string): ParsedMemory[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const out: ParsedMemory[] = [];
  const pushStr = (s: string) => {
    const t = s.trim();
    if (t.length >= 2) out.push({ content: t, raw_text: t });
  };
  const handleItem = (item: unknown) => {
    if (typeof item === 'string') {
      pushStr(item);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const c = obj.content ?? obj.text ?? obj.memory ?? obj.value ?? obj.title;
      if (typeof c === 'string') pushStr(c);
      else if (obj.key !== undefined && obj.value !== undefined) pushStr(`${String(obj.key)}: ${String(obj.value)}`);
    }
  };

  if (Array.isArray(data)) {
    for (const item of data) handleItem(item);
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    let found = false;
    for (const key of ['memories', 'memory', 'entries', 'items', 'records']) {
      if (Array.isArray(obj[key])) {
        found = true;
        for (const item of obj[key] as unknown[]) handleItem(item);
      }
    }
    if (!found) {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') pushStr(`${k}: ${v}`);
        else pushStr(`${k}: ${JSON.stringify(v)}`);
      }
    }
  }
  return out;
}

/** JSON config file — extracts MCP servers and top-level key-value entries. */
export function parseJsonConfig(content: string): ParsedMemory[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const out: ParsedMemory[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t) out.push({ content: t, raw_text: t });
  };

  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (obj && obj.mcpServers && typeof obj.mcpServers === 'object') {
    for (const [name, cfg] of Object.entries(obj.mcpServers as Record<string, unknown>)) {
      if (cfg && typeof cfg === 'object') {
        const c = cfg as Record<string, unknown>;
        const command = c.command ? String(c.command) : '';
        const args = Array.isArray(c.args) ? (c.args as unknown[]).map(String).join(' ') : c.args ? String(c.args) : '';
        push(`MCP server: ${name} → ${[command, args].filter(Boolean).join(' ')}`.trim());
      } else if (typeof cfg === 'string') {
        push(`MCP server: ${name} → ${cfg}`);
      }
    }
    return out;
  }

  // Fall back to generic key-value / array handling.
  return parseJsonMemoryFile(content);
}

// ---------------------------------------------------------------------------
// TOML / YAML (lightweight regex extraction — MCP configs + key-value)
// ---------------------------------------------------------------------------

export function parseTomlConfig(content: string): ParsedMemory[] {
  const out: ParsedMemory[] = [];
  const lines = content.split(/\r?\n/);
  let section: string | null = null;
  let sectionLines: string[] = [];

  const flush = () => {
    if (section === null) return;
    const body = sectionLines.join('\n').trim();
    const kvLines = sectionLines;
    sectionLines = [];
    if (!body) return;
    const mcp = section.match(/^mcp_servers\.(.+)$/);
    if (mcp) {
      const kv = (key: string) => kvLines.find((l) => new RegExp(`^${key}\\s*=`).test(l));
      const command = kv('command')?.split('=').slice(1).join('=').trim().replace(/^"(.*)"$/, '$1') ?? '';
      const args = kv('args')?.split('=').slice(1).join('=').trim()
        .replace(/^\[|\]$/g, '')
        .replace(/["']/g, '')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ?? '';
      out.push({ content: `MCP server: ${mcp[1]} → ${[command, args].filter(Boolean).join(' ')}`.trim(), raw_text: `[${section}]\n${body}` });
    } else {
      out.push({ content: `[${section}]\n${body}`, raw_text: `[${section}]\n${body}` });
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const sec = t.match(/^\[(.+)\]$/);
    if (sec) {
      flush();
      section = sec[1];
      continue;
    }
    if (section !== null) sectionLines.push(t);
    else if (t.includes('=')) out.push({ content: t, raw_text: t });
  }
  flush();
  return out;
}

export function parseYamlConfig(content: string): ParsedMemory[] {
  const out: ParsedMemory[] = [];
  const lines = content.split(/\r?\n/);
  let key: string | null = null;
  let valueLines: string[] = [];

  const flush = () => {
    if (key === null) return;
    const val = valueLines.join(' ').trim();
    valueLines = [];
    if (!val) return;
    if (key === 'mcpServers' || key === 'mcp_servers') {
      // servers appear as indented keys; extract the simplest server list
      out.push({ content: `${key}: ${val}`, raw_text: `${key}: ${val}` });
    } else {
      out.push({ content: `${key}: ${val}`, raw_text: `${key}: ${val}` });
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z_][\w.-]*):(?:\s+(.*))?$/);
    if (m) {
      flush();
      key = m[1];
      valueLines = m[2] ? [m[2]] : [];
    } else if (key !== null && /^\s/.test(line)) {
      valueLines.push(t);
    } else if (key !== null) {
      flush();
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function detectFileFormat(filePath: string): 'markdown' | 'json' | 'sqlite' | 'toml' | 'yaml' | 'unknown' {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt') || lower.endsWith('.mdc')) return 'markdown';
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return 'sqlite';
  return 'unknown';
}
