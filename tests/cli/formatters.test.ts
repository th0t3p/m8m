import { describe, expect, it } from 'vitest';
import { formatAudit, formatScanAnalysis, humanizePlatform } from '../../src/cli/formatters.js';
import type { AuditProviderStat, ScanProviderStat } from '../../src/cli/formatters.js';
import type { SecurityEvent } from '../../src/core/types.js';

function event(over: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 'evt-1',
    event_type: 'credential_detected',
    severity: 'critical',
    title: 'Credential detected',
    detected_at: '2026-09-22T00:00:00.000Z',
    ...over,
  };
}

describe('humanizePlatform', () => {
  it('maps known platforms to display names', () => {
    expect(humanizePlatform('claude_code')).toBe('Claude Code');
    expect(humanizePlatform('dsh-mcp-client')).toBe('DeepSeek Harness');
    expect(humanizePlatform('codex')).toBe('Codex');
  });

  it('title-cases unknown platforms', () => {
    expect(humanizePlatform('my_custom_agent')).toBe('My Custom Agent');
  });
});

describe('formatScanAnalysis', () => {
  it('lists per-provider entry counts', () => {
    const stats: ScanProviderStat[] = [
      { name: 'Codex', path: '/tmp/mem/AGENTS.md', entries: 53, files: 1, configFiles: 0, flagged: 0 },
    ];
    const out = formatScanAnalysis(stats, [], { entries: 53, providers: 1, flagged: 0 });
    expect(out).toContain('Codex');
    expect(out).toContain('53 entries');
    expect(out).toContain('Scan complete');
    expect(out).toContain('53 entries across 1 provider');
  });

  it('shows config-file counts for config-only providers', () => {
    const stats: ScanProviderStat[] = [
      { name: 'DeepSeek Harness', path: '/tmp/.dsh/cordis.patch.yml', entries: 0, files: 0, configFiles: 2, flagged: 0 },
    ];
    const out = formatScanAnalysis(stats, [], { entries: 0, providers: 1, flagged: 0 });
    expect(out).toContain('DeepSeek Harness');
    expect(out).toContain('2 config files');
  });

  it('renders findings with ▲ severity and masks secrets', () => {
    const e = event({
      severity: 'critical',
      details: {
        flag_type: 'contains_credential',
        detail: 'secret token (sk-)',
        file_name: 'profile.md',
        line_start: 14,
        provider: 'Claude Code',
        node_content: 'key is sk_example_abcdefghijklmnop',
      },
    });
    const out = formatScanAnalysis([], [e], { entries: 0, providers: 0, flagged: 0 });
    expect(out).toContain('▲ CRITICAL');
    expect(out).toContain('API key');
    expect(out).toContain('profile.md:14');
    expect(out).toContain('sk_exa****');
    expect(out).not.toContain('abcdefghijklmnop');
  });

  it('shows the no-findings state and a meter', () => {
    const out = formatScanAnalysis([], [], { entries: 0, providers: 0, flagged: 0 });
    expect(out).toContain('(no sensitive findings)');
    expect(out).toContain('Sensitivity');
    expect(out).toContain('0 critical · 0 high · 0 medium');
  });

  it('reports the total harness count when provided', () => {
    const stats: ScanProviderStat[] = [
      { name: 'Codex', path: '/tmp/a', entries: 5, files: 1, configFiles: 0, flagged: 0 },
    ];
    const out = formatScanAnalysis(stats, [], { entries: 5, providers: 1, flagged: 0, totalProviders: 12 });
    expect(out).toContain('of 12 harnesses');
  });
});

describe('formatAudit', () => {
  it('shows combined provenance, providers, and categories', () => {
    const providers: AuditProviderStat[] = [
      {
        name: 'Claude Code',
        entries: 3,
        files: 0,
        oldest: '2026-01-01T00:00:00.000Z',
        newest: '2026-02-01T00:00:00.000Z',
        categories: { preference: 2, credential: 1 },
      },
    ];
    const out = formatAudit(providers, [], '/home/paris/.m8m/audit-20260922.json');
    expect(out).toContain('Entries');
    expect(out).toContain('Claude Code');
    expect(out).toContain('Memory by category');
    expect(out).toContain('preferences');
    expect(out).toContain('credentials');
    expect(out).toContain('.m8m/audit-20260922.json');
  });

  it('renders findings with ▲ severity', () => {
    const e = event({
      severity: 'warning',
      details: { flag_type: 'contains_instruction', detail: 'Reads as a directive…', memory_id: 'mem-123' },
    });
    const out = formatAudit([], [e], '/tmp/audit.json');
    expect(out).toContain('▲ HIGH');
    expect(out).toContain('Instruction');
  });
});
