// Importers for Claude/ChatGPT exports and local memory files.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getAllMemories, upsertMemory } from './db.js';
import { hashContent } from './hasher.js';
import {
  detectFileFormat,
  parseJsonConfig,
  parseJsonMemoryFile,
  parseMarkdownMemoryFile,
  parseTomlConfig,
  parseYamlConfig,
} from '../watcher/parsers.js';
import type {
  DetectionSource,
  ImportResult,
  MemoryEntry,
  SourcePlatform,
  SourceType,
} from './types.js';

function loadJson(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in file: ${filePath}`);
  }
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

/** Recursively collect memory-like strings from an export payload. */
function extractMemoryStrings(data: unknown, max = 500): string[] {
  const out = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 12 || out.size >= max || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const s = value.trim();
      if (s.length >= 3 && s.length <= 4000) out.add(s);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const memoryKeys = Object.keys(obj).filter((k) => /memor/i.test(k));
      if (memoryKeys.length > 0) {
        for (const k of memoryKeys) visit(obj[k], depth + 1);
        return;
      }
      for (const k of Object.keys(obj)) {
        if (/^(content|text|message|summary|note|title|value|items|entries|records)$/i.test(k)) {
          visit(obj[k], depth + 1);
        }
      }
    }
  };
  visit(data, 0);
  return [...out];
}

function buildCandidate(
  content: string,
  sourceType: SourceType,
  sourcePlatform: SourcePlatform,
  trust: number,
  sourceDetail: string,
): MemoryEntry {
  const ts = new Date().toISOString();
  return {
    id: randomUUID(),
    content,
    content_hash: hashContent(content, sourceType),
    source_type: sourceType,
    source_platform: sourcePlatform,
    source_detail: sourceDetail,
    trust_level: trust,
    anomaly_score: 0,
    status: 'active',
    flags: [],
    category: 'unknown',
    entities: [],
    first_seen: ts,
    last_seen: ts,
    version: 1,
    tags: [],
  };
}

/** Parse a Claude data export into memory candidates. */
export function importClaudeExport(filePath: string): MemoryEntry[] {
  const data = loadJson(filePath);
  const strings = extractMemoryStrings(data);
  return strings.map((content, i) =>
    buildCandidate(content, 'conversation', 'claude_web', 0.6, `${basename(filePath)}#${i}`),
  );
}

/** Parse a ChatGPT data export into memory candidates. */
export function importChatGPTExport(filePath: string): MemoryEntry[] {
  const data = loadJson(filePath);
  const strings = extractMemoryStrings(data);
  return strings.map((content, i) =>
    buildCandidate(content, 'conversation', 'chatgpt_web', 0.6, `${basename(filePath)}#${i}`),
  );
}

/** Parse a local memory file (markdown, JSON, TOML, or YAML) into memory candidates. */
export function importLocalMemoryFile(filePath: string, platform: string): MemoryEntry[] {
  const format = detectFileFormat(filePath);
  const text = readText(filePath);
  let parsed: { content: string; line_number?: number; section?: string; raw_text: string }[];
  switch (format) {
    case 'json':
      parsed = parseJsonConfig(text);
      break;
    case 'toml':
      parsed = parseTomlConfig(text);
      break;
    case 'yaml':
      parsed = parseYamlConfig(text);
      break;
    default:
      parsed = parseMarkdownMemoryFile(text, filePath);
  }

  const srcPlatform = (platform || 'local_file') as SourcePlatform;
  return parsed.map((p, i) =>
    buildCandidate(
      p.content,
      'document',
      srcPlatform,
      0.5,
      `${basename(filePath)}#${p.line_number ?? i}`,
    ),
  );
}

/** Upsert a batch of candidate entries into the database. */
export function importBatch(entries: MemoryEntry[], detectedBy: DetectionSource): ImportResult {
  const existingHashes = new Set(getAllMemories().map((e) => e.content_hash));
  const result: ImportResult = { imported: 0, updated: 0, flagged: 0 };
  for (const entry of entries) {
    const isNew = !existingHashes.has(entry.content_hash);
    const saved = upsertMemory(entry, detectedBy);
    if (saved.flags.length > 0) result.flagged++;
    if (isNew) result.imported++;
    else result.updated++;
    existingHashes.add(saved.content_hash);
  }
  return result;
}
