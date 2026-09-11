// Parsers for memory file formats (markdown and JSON).

import type { ParsedMemory } from '../core/types.js';

function pushLine(out: ParsedMemory[], content: string, raw: string, line_number?: number, section?: string): void {
  const trimmed = content.trim();
  if (trimmed.length < 2) return;
  out.push({ content: trimmed, line_number, section, raw_text: raw });
}

/** Split a markdown memory file into individual memory entries. */
export function parseMarkdownMemoryFile(content: string): ParsedMemory[] {
  const out: ParsedMemory[] = [];
  const lines = content.split(/\r?\n/);
  let section: string | undefined;
  let inFence = false;
  let fenceBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (line.startsWith('```')) {
      if (inFence) {
        pushLine(out, fenceBuffer.join('\n'), raw, i + 1, section);
        fenceBuffer = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceBuffer.push(line);
      continue;
    }

    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) {
      section = line.replace(/^#{1,6}\s+/, '').trim();
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) continue;
    if (/^\s*[-*>]+\s*$/.test(line)) continue;

    let text = line;
    if (/^[-*+]\s+/.test(text)) text = text.replace(/^[-*+]\s+/, '');
    else if (/^\d+[.)]\s+/.test(text)) text = text.replace(/^\d+[.)]\s+/, '');
    pushLine(out, text, raw, i + 1, section);
  }

  if (inFence && fenceBuffer.length) {
    pushLine(out, fenceBuffer.join('\n'), '', lines.length, section);
  }
  return out;
}

function pushJsonString(out: ParsedMemory[], value: unknown): void {
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length >= 2) out.push({ content: t, raw_text: t });
  }
}

/** Parse a JSON memory file (array of strings/objects, or an object). */
export function parseJsonMemoryFile(content: string): ParsedMemory[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const out: ParsedMemory[] = [];

  const handleItem = (item: unknown): void => {
    if (typeof item === 'string') {
      pushJsonString(out, item);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const candidate = obj.content ?? obj.text ?? obj.memory ?? obj.value ?? obj.title;
      if (typeof candidate === 'string') {
        pushJsonString(out, candidate);
      } else if (obj.key !== undefined && obj.value !== undefined) {
        pushJsonString(out, `${String(obj.key)}: ${String(obj.value)}`);
      }
    }
  };

  if (Array.isArray(data)) {
    for (const item of data) handleItem(item);
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    let foundArray = false;
    for (const key of ['memories', 'memory', 'entries', 'items', 'records']) {
      if (Array.isArray(obj[key])) {
        foundArray = true;
        for (const item of obj[key] as unknown[]) handleItem(item);
      }
    }
    if (!foundArray) {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') pushJsonString(out, `${k}: ${v}`);
      }
    }
  }

  return out;
}

/** Detect a memory file format from its filename/extension. */
export function detectFileFormat(filePath: string): 'markdown' | 'json' | 'sqlite' | 'unknown' {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'markdown';
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return 'sqlite';
  return 'unknown';
}
