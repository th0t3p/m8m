// Parsers for memory file formats (markdown, JSON, TOML, YAML).

import type { NodeType, ParsedDocument, ParsedMemory, ParsedNode } from '../core/types.js';

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

// ---------------------------------------------------------------------------
// Document tree parsers (structured documents)
// ---------------------------------------------------------------------------

interface Block {
  type: NodeType;
  heading?: string;
  content: string;
  line_start: number;
  line_end: number;
  depth: number;
}

function buildNodeTree(blocks: Block[]): ParsedNode[] {
  const roots: ParsedNode[] = [];
  const stack: { depth: number; node: ParsedNode }[] = [];

  for (const b of blocks) {
    const node: ParsedNode = {
      node_type: b.type,
      content: b.content,
      line_start: b.line_start,
      line_end: b.line_end,
      children: [],
    };
    if (b.heading !== undefined) node.heading = b.heading;

    if (b.type === 'section') {
      const depth = Math.max(0, b.depth);
      while (stack.length > depth) stack.pop();
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].node.children.push(node);
      stack.push({ depth, node });
    } else {
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].node.children.push(node);
    }
  }
  return roots;
}

export function parseDocumentTree(content: string, filePath: string): ParsedDocument {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  if (ext === 'json') return parseJsonTree(content);
  if (ext === 'toml') return parseTomlTree(content);
  if (ext === 'yml' || ext === 'yaml') return parseYamlTree(content);
  return parseMarkdownTree(content);
}

export function parseMarkdownTree(content: string): ParsedDocument {
  const lines = content.split(/\r?\n/);

  let title: string | undefined;
  let minHeaderLevel = 7;
  for (const line of lines) {
    const m = line.trim().match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (!title && m[1].length === 1) title = m[2].trim();
      else minHeaderLevel = Math.min(minHeaderLevel, m[1].length);
    }
  }
  const baseLevel = minHeaderLevel === 7 ? 1 : minHeaderLevel;

  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Code fence — always one node, never split.
    if (trimmed.startsWith('```')) {
      const start = i + 1;
      const buf = [raw];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        buf.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code_block', content: buf.join('\n'), line_start: start, line_end: i, depth: 0 });
      continue;
    }

    // Header → section.
    const hm = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const level = hm[1].length;
      blocks.push({ type: 'section', heading: hm[2].trim(), content: raw, line_start: i + 1, line_end: i + 1, depth: level - baseLevel });
      i++;
      continue;
    }

    // Bullet (with indented continuation lines).
    if (/^[-*+]\s+/.test(trimmed)) {
      const start = i + 1;
      const buf = [raw];
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) break;
        if (/^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t) || /^#{1,6}\s+/.test(t) || t.startsWith('```')) break;
        if (/^\s+/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        } else break;
      }
      blocks.push({ type: 'bullet', content: buf.join('\n'), line_start: start, line_end: i, depth: 0 });
      continue;
    }

    // Numbered item (with indented continuation lines).
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const start = i + 1;
      const buf = [raw];
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) break;
        if (/^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t) || /^#{1,6}\s+/.test(t) || t.startsWith('```')) break;
        if (/^\s+/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        } else break;
      }
      blocks.push({ type: 'numbered', content: buf.join('\n'), line_start: start, line_end: i, depth: 0 });
      continue;
    }

    // Paragraph — consecutive non-blank, non-special lines.
    const start = i + 1;
    const buf = [raw];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (/^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t) || /^#{1,6}\s+/.test(t) || t.startsWith('```')) break;
      buf.push(lines[i]);
      i++;
    }
    const joined = buf.join('\n').trim();
    const isKeyValue = buf.length === 1 && /^[A-Za-z_][\w.-]*\s*:\s+/.test(joined);
    blocks.push({ type: isKeyValue ? 'key_value' : 'paragraph', content: buf.join('\n'), line_start: start, line_end: i, depth: 0 });
  }

  return { title, nodes: buildNodeTree(blocks) };
}

export function parseJsonTree(content: string): ParsedDocument {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { title: undefined, nodes: [] };
  }

  const jsonToNodes = (value: unknown): ParsedNode[] => {
    if (value == null) return [];
    if (Array.isArray(value)) {
      return value.map((item, idx) => {
        if (typeof item === 'string') return { node_type: 'bullet' as NodeType, content: item, children: [] };
        if (item && typeof item === 'object') {
          return { node_type: 'section' as NodeType, heading: `[${idx}]`, content: JSON.stringify(item), children: jsonToNodes(item) };
        }
        return { node_type: 'text' as NodeType, content: String(item), children: [] };
      });
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const nodes: ParsedNode[] = [];
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
          nodes.push({ node_type: 'section', heading: k, content: JSON.stringify(v), children: jsonToNodes(v) });
        } else {
          nodes.push({ node_type: 'key_value', heading: k, content: `${k}: ${JSON.stringify(v)}`, children: [] });
        }
      }
      return nodes;
    }
    return [{ node_type: 'text', content: String(value), children: [] }];
  };

  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (obj && (obj.mcpServers || obj.mcp_servers)) {
    const servers = (obj.mcpServers ?? obj.mcp_servers) as Record<string, unknown>;
    const nodes: ParsedNode[] = [];
    for (const [name, cfg] of Object.entries(servers)) {
      if (cfg && typeof cfg === 'object') {
        const c = cfg as Record<string, unknown>;
        const command = c.command ? String(c.command) : '';
        const args = Array.isArray(c.args) ? (c.args as unknown[]).map(String).join(' ') : c.args ? String(c.args) : '';
        nodes.push({
          node_type: 'section',
          heading: name,
          content: `MCP server: ${name} → ${[command, args].filter(Boolean).join(' ')}`.trim(),
          children: jsonToNodes(cfg),
        });
      } else {
        nodes.push({ node_type: 'section', heading: name, content: `MCP server: ${name} → ${String(cfg)}`, children: [] });
      }
    }
    return { title: undefined, nodes };
  }

  return { title: undefined, nodes: jsonToNodes(data) };
}

export function parseTomlTree(content: string): ParsedDocument {
  const lines = content.split(/\r?\n/);
  const nodes: ParsedNode[] = [];
  let current: ParsedNode | null = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const sec = t.match(/^\[(.+)\]$/);
    if (sec) {
      current = { node_type: 'section', heading: sec[1], content: `[${sec[1]}]`, children: [] };
      nodes.push(current);
      continue;
    }
    if (/^[A-Za-z_][\w.-]*\s*=/.test(t)) {
      const node: ParsedNode = { node_type: 'key_value', content: t, children: [] };
      (current ? current.children : nodes).push(node);
    }
  }
  return { title: undefined, nodes };
}

export function parseYamlTree(content: string): ParsedDocument {
  const lines = content.split(/\r?\n/);
  const nodes: ParsedNode[] = [];
  const stack: { indent: number; node: ParsedNode }[] = [];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = (line.match(/^\s*/) ?? [''])[0].length;
    const t = line.trim();

    const item = t.match(/^-\s+(.*)$/);
    const kv = t.match(/^([A-Za-z_][\w.-]*):(?:\s+(.*))?$/);

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();

    if (item) {
      const node: ParsedNode = { node_type: 'bullet', content: item[1], children: [] };
      if (stack.length) stack[stack.length - 1].node.children.push(node);
      else nodes.push(node);
      stack.push({ indent, node });
    } else if (kv) {
      const value = kv[2] ?? '';
      if (value === '') {
        const node: ParsedNode = { node_type: 'section', heading: kv[1], content: `${kv[1]}:`, children: [] };
        if (stack.length) stack[stack.length - 1].node.children.push(node);
        else nodes.push(node);
        stack.push({ indent, node });
      } else {
        const node: ParsedNode = { node_type: 'key_value', heading: kv[1], content: `${kv[1]}: ${value}`, children: [] };
        if (stack.length) stack[stack.length - 1].node.children.push(node);
        else nodes.push(node);
      }
    }
  }
  return { title: undefined, nodes };
}
