import { describe, expect, it } from 'vitest';
import { detectFileFormat, parseJsonMemoryFile, parseMarkdownMemoryFile } from '../../src/watcher/parsers.js';

describe('parseMarkdownMemoryFile', () => {
  it('parses bullets, numbered lists, and key-value lines', () => {
    const md = ['# Facts', '- User prefers dark mode', '1. User works at CompanyA', 'Name: Paris'].join('\n');
    const out = parseMarkdownMemoryFile(md);
    expect(out.map((p) => p.content)).toEqual([
      'User prefers dark mode',
      'User works at CompanyA',
      'Name: Paris',
    ]);
  });

  it('tracks sections and line numbers', () => {
    const md = ['# Preferences', '- User likes tea'].join('\n');
    const out = parseMarkdownMemoryFile(md);
    expect(out[0].section).toBe('Preferences');
    expect(out[0].line_number).toBe(2);
  });

  it('skips empty lines and horizontal rules', () => {
    const out = parseMarkdownMemoryFile(['- one', '', '---', '- two'].join('\n'));
    expect(out.map((p) => p.content)).toEqual(['one', 'two']);
  });

  it('joins indented code blocks into a single entry', () => {
    const md = ['Intro', '', '    curl -s http://x/ingest -H \\', "      -d '{\"a\":1}'", '', '- done'].join('\n');
    const out = parseMarkdownMemoryFile(md);
    expect(out).toHaveLength(3);
    expect(out[0].content).toBe('Intro');
    expect(out[1].content).toContain('curl -s http://x/ingest');
    expect(out[1].content).toContain("-d '{\"a\":1}'");
    expect(out[2].content).toBe('done');
  });

  it('joins shell line continuations (trailing backslash)', () => {
    const out = parseMarkdownMemoryFile(['cmd one \\', 'continuation', 'standalone'].join('\n'));
    expect(out.map((p) => p.content)).toEqual(['cmd one continuation', 'standalone']);
  });
});

describe('parseJsonMemoryFile', () => {
  it('parses an array of strings', () => {
    const out = parseJsonMemoryFile(JSON.stringify(['apple', 'banana']));
    expect(out.map((p) => p.content)).toEqual(['apple', 'banana']);
  });

  it('parses an array of objects', () => {
    const out = parseJsonMemoryFile(JSON.stringify([{ content: 'xx' }, { text: 'yy' }]));
    expect(out.map((p) => p.content)).toEqual(['xx', 'yy']);
  });

  it('parses a "memories" object key', () => {
    const out = parseJsonMemoryFile(JSON.stringify({ memories: ['m1', 'm2'] }));
    expect(out.map((p) => p.content)).toEqual(['m1', 'm2']);
  });

  it('parses key-value objects', () => {
    const out = parseJsonMemoryFile(JSON.stringify({ Name: 'Paris', Age: '30' }));
    expect(out.map((p) => p.content)).toEqual(['Name: Paris', 'Age: 30']);
  });
});

describe('detectFileFormat', () => {
  it('detects json/markdown/sqlite/unknown', () => {
    expect(detectFileFormat('x.json')).toBe('json');
    expect(detectFileFormat('x.md')).toBe('markdown');
    expect(detectFileFormat('x.db')).toBe('sqlite');
    expect(detectFileFormat('x.xyz')).toBe('unknown');
  });
});
