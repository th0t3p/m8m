import { describe, expect, it } from 'vitest';
import {
  detectFileFormat,
  detectFileType,
  parseJsonConfig,
  parseJsonMemoryFile,
  parseMarkdownMemoryFile,
  parseTomlConfig,
  parseYamlConfig,
} from '../../src/watcher/parsers.js';

describe('detectFileType', () => {
  it('detects by extension', () => {
    expect(detectFileType('{}', 'x.json')).toBe('json_config');
    expect(detectFileType('[]', 'x.toml')).toBe('toml_config');
    expect(detectFileType('', 'x.yaml')).toBe('yaml_config');
  });

  it('detects structured docs (headers + code blocks)', () => {
    const md = ['## A', 'paragraph', '', '## B', 'more'].join('\n');
    expect(detectFileType(md, 'x.md')).toBe('structured_doc');
    expect(detectFileType('```\ncode\n```', 'x.md')).toBe('structured_doc');
  });

  it('detects fact lists (bullets, no headers)', () => {
    expect(detectFileType('- a\n- b\n- c', 'x.md')).toBe('fact_list');
  });
});

describe('parseMarkdownMemoryFile — fact list', () => {
  it('parses bullets, numbered lists, and key-value lines line-by-line', () => {
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

  it('skips empty lines, horizontal rules, and comments', () => {
    const md = ['<!-- comment -->', '- one', '', '---', '- two'].join('\n');
    expect(parseMarkdownMemoryFile(md).map((p) => p.content)).toEqual(['one', 'two']);
  });

  it('merges indented continuation lines', () => {
    const md = ['- Main point', '  continued on next line', '  and another', '- standalone'].join('\n');
    const out = parseMarkdownMemoryFile(md);
    expect(out[0].content).toBe('Main point continued on next line and another');
    expect(out[1].content).toBe('standalone');
  });

  it('merges shell line continuations within list items', () => {
    const out = parseMarkdownMemoryFile(['- cmd one \\', '  continued', '- standalone'].join('\n'));
    expect(out.map((p) => p.content)).toEqual(['cmd one continued', 'standalone']);
  });
});

describe('parseMarkdownMemoryFile — structured document', () => {
  it('produces one entry per section', () => {
    const md = ['## Design principles', '- Palette: few colours.', '- Typography: tracking-tight.', '', '## Process', '- Critique before styling.'].join('\n');
    const out = parseMarkdownMemoryFile(md);
    expect(out).toHaveLength(2);
    expect(out[0].section).toBe('Design principles');
    expect(out[0].content).toContain('Palette: few colours.');
    expect(out[1].section).toBe('Process');
  });

  it('keeps code blocks intact within a section', () => {
    const md = [
      '## Usage',
      'Some text.',
      '',
      '```typescript',
      'const x = 1;',
      'const y = 2;',
      'const z = 3;',
      '```',
      '',
      'More text.',
    ].join('\n');
    const out = parseMarkdownMemoryFile(md);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('const x = 1;');
    expect(out[0].content).toContain('const z = 3;');
  });

  it('splits oversized sections at paragraph boundaries', () => {
    const long = 'x'.repeat(1200);
    const md = [`## Big`, `${long}`, '', `${long}`].join('\n');
    const out = parseMarkdownMemoryFile(md);
    expect(out.length).toBeGreaterThan(1);
  });
});

describe('parseJsonConfig', () => {
  it('extracts MCP servers', () => {
    const out = parseJsonConfig(JSON.stringify({ mcpServers: { m8m: { command: 'npx', args: ['@th0t3p/m8m', 'mcp'] } } }));
    expect(out.map((p) => p.content)).toEqual(['MCP server: m8m → npx @th0t3p/m8m mcp']);
  });

  it('extracts key-value settings', () => {
    const out = parseJsonConfig(JSON.stringify({ db_path: 'x.db', port: 8080 }));
    expect(out.some((p) => p.content.includes('db_path'))).toBe(true);
  });
});

describe('parseTomlConfig', () => {
  it('extracts MCP servers', () => {
    const toml = ['[mcp_servers.m8m]', 'command = "npx"', 'args = ["-y", "@th0t3p/m8m", "mcp"]'].join('\n');
    const out = parseTomlConfig(toml);
    expect(out.map((p) => p.content)).toEqual(['MCP server: m8m → npx -y @th0t3p/m8m mcp']);
  });
});

describe('parseYamlConfig', () => {
  it('extracts top-level keys', () => {
    const out = parseYamlConfig(['key1: value1', 'key2: value2'].join('\n'));
    expect(out.map((p) => p.content)).toEqual(['key1: value1', 'key2: value2']);
  });
});

describe('parseJsonMemoryFile', () => {
  it('parses arrays of strings and objects', () => {
    expect(parseJsonMemoryFile(JSON.stringify(['apple', 'banana'])).map((p) => p.content)).toEqual(['apple', 'banana']);
    expect(parseJsonMemoryFile(JSON.stringify([{ content: 'xx' }, { text: 'yy' }])).map((p) => p.content)).toEqual(['xx', 'yy']);
  });
});

describe('detectFileFormat', () => {
  it('detects json/markdown/toml/yaml/sqlite/unknown', () => {
    expect(detectFileFormat('x.json')).toBe('json');
    expect(detectFileFormat('x.md')).toBe('markdown');
    expect(detectFileFormat('x.toml')).toBe('toml');
    expect(detectFileFormat('x.yaml')).toBe('yaml');
    expect(detectFileFormat('x.db')).toBe('sqlite');
    expect(detectFileFormat('x.xyz')).toBe('unknown');
  });
});
