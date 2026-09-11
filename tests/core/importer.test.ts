import { beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { importBatch, importChatGPTExport, importClaudeExport, importLocalMemoryFile } from '../../src/core/importer.js';
import { getAllMemories, initDatabase } from '../../src/core/db.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

beforeEach(() => {
  initDatabase(':memory:');
});

describe('importClaudeExport', () => {
  it('extracts memories with claude_web platform and 0.6 trust', () => {
    const entries = importClaudeExport(fixture('claude_export_sample.json'));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].source_platform).toBe('claude_web');
    expect(entries[0].source_type).toBe('conversation');
    expect(entries[0].trust_level).toBe(0.6);
  });
});

describe('importChatGPTExport', () => {
  it('extracts memories with chatgpt_web platform', () => {
    const entries = importChatGPTExport(fixture('chatgpt_export_sample.json'));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].source_platform).toBe('chatgpt_web');
  });
});

describe('importLocalMemoryFile', () => {
  it('parses markdown files', () => {
    const entries = importLocalMemoryFile(fixture('memory_file_markdown.md'), 'local_file');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].source_platform).toBe('local_file');
    expect(entries[0].source_type).toBe('document');
  });

  it('parses JSON files', () => {
    const entries = importLocalMemoryFile(fixture('memory_file_json.json'), 'local_file');
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('importBatch', () => {
  it('upserts entries and reports flagged count', () => {
    const entries = importLocalMemoryFile(fixture('malicious_memory.md'), 'local_file');
    const result = importBatch(entries, 'manual_import');
    expect(result.imported).toBeGreaterThan(0);
    expect(result.flagged).toBeGreaterThan(0);
    expect(getAllMemories().length).toBe(entries.length);
  });
});
