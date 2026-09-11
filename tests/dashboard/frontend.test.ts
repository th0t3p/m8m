// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'src/dashboard/public/index.html'), 'utf8');

const TABS = ['overview', 'constellation', 'river', 'heatmap', 'security', 'diff', 'decay'];

function jsonResponse(data: unknown): Partial<Response> {
  return { ok: true, status: 200, json: () => Promise.resolve(data) } as Partial<Response>;
}

// Set up DOM + fetch before importing the app module.
document.body.innerHTML = '<main id="app"></main>';
for (const v of TABS) {
  const b = document.createElement('button');
  b.className = 'tab' + (v === 'overview' ? ' active' : '');
  b.dataset.view = v;
  document.body.appendChild(b);
}

globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input).split('?')[0];
  switch (url) {
    case '/api/memories/stats':
      return jsonResponse({ total: 2, active: 2, quarantined: 0, flagged: 0, by_platform: { claude_code: 2 }, by_source_type: {}, by_category: {} });
    case '/api/changelog':
      return jsonResponse([]);
    case '/api/events':
      return jsonResponse([]);
    case '/api/memories':
      return jsonResponse([]);
    default:
      return jsonResponse({});
  }
}) as unknown as typeof fetch;

let app: Record<string, unknown>;

beforeAll(async () => {
  app = (await import('../../src/dashboard/public/app.js')) as unknown as Record<string, unknown>;
  // let the async overview render settle
  await new Promise((r) => setTimeout(r, 30));
});

describe('index.html structure', () => {
  it('exposes 7 tabs, D3 CDN, and the logo', () => {
    for (const v of TABS) expect(html).toContain(`data-view="${v}"`);
    expect(html).toContain('cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js');
    expect(html).toContain('logo.png');
    expect(html).toContain('type="module"');
  });
});

describe('overview renders against the API', () => {
  it('renders the stat cards into #app', () => {
    const text = document.querySelector('#app')?.textContent ?? '';
    expect(text).toContain('Total memories');
    expect(text).toContain('Active');
    expect(text).toContain('Quarantined');
  });
});

describe('pure helper functions', () => {
  it('maps trust levels to colors', () => {
    const f = app.trustColor as (t: number) => string;
    expect(f(0.9)).toBe('#22c55e');
    expect(f(0.5)).toBe('#f59e0b');
    expect(f(0.1)).toBe('#ef4444');
  });

  it('maps platform to color, with unknown fallback', () => {
    const f = app.platformColor as (p: string) => string;
    expect(f('cursor')).toBe('#3b82f6');
    expect(f('claude_code')).toBe('#7c3aed');
    expect(f('nonsense')).toBe('#ef4444');
  });

  it('truncates and escapes strings', () => {
    expect((app.truncate as (s: string, n: number) => string)('hello world', 8)).toBe('hello w…');
    expect((app.escapeHtml as (s: string) => string)('<b>&')).toBe('&lt;b&gt;&amp;');
  });

  it('computes rgba from hex + alpha', () => {
    expect((app.hexAlpha as (hex: string, a: number) => string)('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });
});
