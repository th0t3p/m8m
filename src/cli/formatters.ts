// Terminal output formatting helpers.

import { dirname } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import Table from 'cli-table3';
import type {
  ChangelogEntry,
  EventSeverity,
  MemoryDiff,
  MemoryEntry,
  M8mStats,
  ProviderConfig,
  RollbackPreview,
  SecurityEvent,
} from '../core/types.js';
import type { DiscoveredMemoryFile } from '../core/scanner.js';
import {
  dim,
  header,
  inProgress,
  pad,
  summary,
  truncatePath,
} from './ui.js';

export function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function flagBadges(entry: MemoryEntry): string {
  if (entry.flags.length === 0) return '';
  const labels = entry.flags.map((f) => f.type.replace(/^contains_|_detected$/, '').replace(/_/g, ' '));
  return chalk.yellow(`⚠ ${labels.join(', ')}`);
}

export function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return chalk.green(status);
    case 'quarantined':
      return chalk.red(status);
    case 'dismissed':
      return chalk.gray(status);
    case 'deleted':
      return chalk.strikethrough(chalk.gray(status));
    default:
      return status;
  }
}

export function formatStatBlock(stats: M8mStats, unresolvedEvents: number): string {
  const lines: string[] = [];
  const row = (label: string, value: string | number): string => `    ${label.padEnd(13)} ${value}`;

  lines.push('');
  lines.push(chalk.bold('  m8m — Memory Observatory'));
  lines.push(chalk.gray('  ─────────────────────────'));

  lines.push('');
  lines.push(chalk.bold('  Agent memories'));
  lines.push(row('Total:', stats.agent));
  lines.push(row('Active:', stats.active));
  lines.push(row('Quarantined:', stats.quarantined));
  lines.push(row('Flagged:', stats.flagged));

  lines.push('');
  lines.push(chalk.bold('  File memories'));
  lines.push(row('Files:', stats.file));
  lines.push(row('Nodes:', stats.file_nodes));
  lines.push(row('Flagged:', stats.file_flagged));

  lines.push('');
  lines.push(chalk.bold('  By platform:'));
  for (const [k, v] of Object.entries(stats.by_platform).sort((a, b) => b[1] - a[1])) {
    lines.push(`    ${k.padEnd(18)} ${v}`);
  }
  lines.push('');
  lines.push(`  Security events:    ${unresolvedEvents} unresolved`);
  return lines.join('\n');
}

export function formatMemoryList(entries: MemoryEntry[]): string {
  if (entries.length === 0) return chalk.gray('  (no memories)');
  const table = new Table({
    head: ['ID', 'Content', 'Platform', 'Source', 'Trust', 'Flags'],
    colWidths: [10, 44, 14, 12, 7, 22],
    wordWrap: true,
    style: { head: ['cyan'] },
  });
  for (const e of entries) {
    table.push([
      e.id.slice(0, 8),
      e.content,
      e.source_platform,
      e.source_type,
      e.trust_level.toFixed(1),
      e.flags.length ? e.flags.map((f) => f.type.replace(/^contains_/, '')).join(', ') : '',
    ]);
  }
  return table.toString();
}

export function formatMemoryDetail(entry: MemoryEntry, changelog: ChangelogEntry[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold(`  ${entry.content}`));
  lines.push(chalk.gray(`  id: ${entry.id}`));
  lines.push(`  platform:     ${entry.source_platform}`);
  lines.push(`  source_type:  ${entry.source_type}`);
  lines.push(`  status:       ${statusColor(entry.status)}`);
  lines.push(`  category:     ${entry.category}`);
  lines.push(`  trust_level:  ${entry.trust_level}`);
  lines.push(`  anomaly:      ${entry.anomaly_score}`);
  lines.push(`  version:      ${entry.version}`);
  lines.push(`  first_seen:   ${entry.first_seen}`);
  lines.push(`  last_seen:    ${entry.last_seen}`);
  if (entry.source_url) lines.push(`  source_url:   ${entry.source_url}`);
  if (entry.source_detail) lines.push(`  source_detail:${entry.source_detail}`);
  if (entry.entities.length) lines.push(`  entities:     ${entry.entities.join(', ')}`);
  if (entry.tags.length) lines.push(`  tags:         ${entry.tags.join(', ')}`);
  if (entry.flags.length) {
    lines.push('');
    lines.push(chalk.yellow.bold('  Flags:'));
    for (const f of entry.flags) lines.push(`    - [${f.type}] ${f.detail}`);
  }
  if (changelog.length) {
    lines.push('');
    lines.push(chalk.bold('  History:'));
    for (const c of changelog) {
      lines.push(`    ${c.changed_at}  ${c.change_type.padEnd(8)} ${truncate(c.new_content ?? c.old_content ?? '', 40)}`);
    }
  }
  return lines.join('\n');
}

export function formatDiff(diff: MemoryDiff): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('  Memory changes'));
  lines.push(chalk.gray('  ─────────────────────────────'));
  for (const e of diff.added) {
    lines.push(chalk.green(`  + [${e.id.slice(0, 8)}] "${truncate(e.content)}"`));
    lines.push(chalk.gray(`    Source: ${e.source_platform} (${e.source_type}) · Trust: ${e.trust_level}`));
  }
  for (const m of diff.modified) {
    lines.push(chalk.yellow(`  ~ [${m.after.id.slice(0, 8)}] "${truncate(m.before.content)}" → "${truncate(m.after.content)}"`));
    const flags = m.after.flags.map((f) => f.type).join(', ');
    lines.push(chalk.gray(`    Flag: ${flags || '—'}`));
  }
  for (const e of diff.deleted) {
    lines.push(chalk.red(`  - [${e.id.slice(0, 8)}] "${truncate(e.content)}"`));
  }
  const summary = `${diff.added.length} added, ${diff.modified.length} modified, ${diff.deleted.length} deleted`;
  lines.push('');
  lines.push(chalk.bold(`  Summary: ${summary}`));
  return lines.join('\n');
}

/** Preview of what a snapshot rollback will do (restore/revert/remove). */
export function formatRollbackPreview(preview: RollbackPreview): string {
  const diff = preview.entries;
  const docs = preview.documents;
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('  Rollback preview'));
  lines.push(chalk.gray('  ────────────────'));

  lines.push(chalk.bold('  Agent memories'));
  for (const e of diff.added) {
    lines.push(chalk.green(`  ↺ restore  [${e.id.slice(0, 8)}] "${truncate(e.content)}"`));
  }
  for (const m of diff.modified) {
    lines.push(chalk.yellow(`  ↺ revert   [${m.after.id.slice(0, 8)}] "${truncate(m.after.content)}" → "${truncate(m.before.content)}"`));
  }
  for (const e of diff.deleted) {
    lines.push(chalk.red(`  ✕ remove   [${e.id.slice(0, 8)}] "${truncate(e.content)}"`));
  }
  if (!diff.added.length && !diff.modified.length && !diff.deleted.length) {
    lines.push(chalk.gray('  (no agent-memory changes)'));
  }

  lines.push('');
  lines.push(chalk.bold('  File memories'));
  for (const d of docs.restored) {
    lines.push(chalk.green(`  ↺ restore  ${d.file_name}  (${d.file_path})`));
  }
  for (const d of docs.removed) {
    lines.push(chalk.red(`  ✕ remove   ${d.file_name}  (${d.file_path})`));
  }
  if (!docs.restored.length && !docs.removed.length) {
    lines.push(chalk.gray('  (no file-memory changes)'));
  }

  const total = diff.added.length + diff.modified.length + diff.deleted.length + docs.restored.length + docs.removed.length;
  lines.push('');
  lines.push(chalk.bold(`  Will apply ${total} change(s)`));
  return lines.join('\n');
}

export function formatSecurityEvents(events: SecurityEvent[]): string {
  const lines: string[] = [];
  lines.push(header('Security Audit'));
  lines.push('');

  if (events.length === 0) {
    lines.push(dim('(no security events)'));
    return lines.join('\n');
  }

  const fileCount = new Set(events.map((e) => e.document_id).filter(Boolean)).size;
  lines.push(dim(fileCount ? `${events.length} events across ${fileCount} file(s)` : `${events.length} events`));
  lines.push('');

  for (const e of events) {
    const sevIcon = e.severity === 'critical' ? '🔴' : e.severity === 'warning' ? '⚠ ' : 'ℹ ';
    const sevWord = e.severity.toUpperCase();
    const sevColor = e.severity === 'critical' ? chalk.red.bold : e.severity === 'warning' ? chalk.yellow : chalk.blue;
    lines.push(`  ${sevIcon} ${sevColor(sevWord.padEnd(8))}  ${chalk.white(truncate(e.title, 42))}  ${chalk.dim(shortDate(e.detected_at))}`);

    if (e.details?.detail) {
      lines.push(`${' '.repeat(15)}${chalk.dim(truncate(String(e.details.detail), 60))}`);
    }
    const source = eventSource(e);
    if (source) lines.push(`${' '.repeat(15)}${chalk.dim(source)}`);

    lines.push('');
  }

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const e of events) counts[e.severity] = (counts[e.severity] ?? 0) + 1;
  lines.push(summary('Summary', [
    { text: `${counts.critical} critical`, style: counts.critical ? 'warn' : 'dim' },
    { text: `${counts.warning} warning`, style: 'dim' },
    { text: `${counts.info} info`, style: 'dim' },
  ]));

  return lines.join('\n');
}

function eventSource(e: SecurityEvent): string {
  const fileName = e.details?.file_name ? String(e.details.file_name) : '';
  const provider = e.details?.provider ? String(e.details.provider) : '';
  const line = e.details?.line_start != null ? String(e.details.line_start) : '';
  if (fileName) {
    return [provider, line ? `${fileName}:${line}` : fileName].filter(Boolean).join(' › ');
  }
  if (e.memory_id) return `agent memory › ${e.memory_id.slice(0, 8)}`;
  return '';
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${M[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function dirLabel(path: string): string {
  const home = homedir();
  const dir = dirname(path);
  const label = dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
  return label.endsWith('/') ? label : `${label}/`;
}

/** Discovery table for `m8m scan`: one row per provider (found or not). */
export function formatScanDiscovery(files: DiscoveredMemoryFile[], providers: ProviderConfig[]): string {
  const byProvider = new Map<string, DiscoveredMemoryFile[]>();
  for (const f of files) {
    const list = byProvider.get(f.provider) ?? [];
    list.push(f);
    byProvider.set(f.provider, list);
  }

  const lines: string[] = [];
  lines.push(header('Memory Scanner'));
  lines.push('');
  lines.push(inProgress('Scanning AI memory providers...'));
  lines.push('');

  for (const p of providers) {
    const found = byProvider.get(p.name) ?? [];
    // Only list providers that were found — an empty "not found" row for every
    // configured-but-absent harness is noise.
    if (found.length === 0) continue;
    const total = found.reduce((s, f) => s + f.size, 0);
    const count = `${found.length} file${found.length === 1 ? '' : 's'}`;
    lines.push(`  ${chalk.green('✓')} ${chalk.bold.white(pad(p.name, 20))} ${chalk.dim(pad(truncatePath(dirLabel(found[0].path), 33), 35))} ${pad(count, 9, true)} ${pad(formatBytes(total), 9, true)}`);
  }

  lines.push('');
  lines.push(dim(`Found ${files.length} file(s) across ${byProvider.size} provider(s)`));
  return lines.join('\n');
}

/** Per-provider totals collected while importing during `m8m scan`. */
export interface ScanProviderStat {
  name: string;
  path: string;
  entries: number;
  files: number;
  flagged: number;
}

/** Display names for the scan sensitivity report (critical/high/medium). */
const SCAN_SEVERITY_LABEL: Record<EventSeverity, string> = {
  critical: 'CRITICAL',
  warning: 'HIGH',
  info: 'MEDIUM',
};

const FLAG_LABEL: Record<string, string> = {
  contains_credential: 'Credential',
  contains_email: 'Email address',
  contains_url: 'URL',
  contains_instruction: 'Instruction',
  hidden_character: 'Hidden character',
  contradicts_existing: 'Contradiction',
  source_unknown: 'Unknown source',
};

/** Mask a secret/email so the scan report never re-prints the plaintext. */
function maskValue(v: string): string {
  if (v.includes('@')) {
    const at = v.indexOf('@');
    const local = v.slice(0, at);
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}****@${v.slice(at + 1)}`;
  }
  if (v.length <= 8) return `${v.slice(0, 2)}****`;
  return `${v.slice(0, 6)}****…${v.slice(-4)}`;
}

/** Pull the sensitive token out of node content and mask it. */
function sensitiveExcerpt(content: string): string {
  const patterns = [
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/,
    /\bgh[pous]_[A-Za-z0-9]{20,}\b/,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) return maskValue(m[0]);
  }
  return maskValue(content.replace(/\s+/g, ' ').trim().slice(0, 40));
}

function credentialLabel(detail: string): string {
  if (/aws/i.test(detail)) return 'AWS credentials';
  if (/api key|secret token|sk[-_]|pk[-_]/i.test(detail)) return 'API key';
  return 'Credential';
}

function sensitivityMeter(counts: { critical: number; high: number; medium: number }): string {
  const total = counts.critical + counts.high + counts.medium;
  const width = 20;
  const filled = Math.max(0, Math.min(width, total));
  const barColor = counts.critical > 0 ? chalk.red : counts.high > 0 ? chalk.yellow : chalk.dim;
  const bar = barColor('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
  const parts = `${counts.critical} critical · ${counts.high} high · ${counts.medium} medium`;
  return `  ${chalk.bold.white('Sensitivity')} ${bar} ${chalk.dim(parts)}`;
}

/**
 * Post-import output for `m8m scan`: per-provider entry counts, then the
 * sensitivity findings (masked, file:line) and a severity meter.
 */
export function formatScanAnalysis(
  providerStats: ScanProviderStat[],
  events: SecurityEvent[],
  totals: { entries: number; providers: number; flagged: number },
): string {
  const lines: string[] = [];

  lines.push('');
  for (const p of providerStats) {
    lines.push(
      `  ${chalk.green('✓')} ${chalk.bold.white(pad(p.name, 20))} ${chalk.dim(pad(truncatePath(dirLabel(p.path), 33), 35))} ${pad(`${p.entries} entries`, 12, true)}`,
    );
  }

  lines.push('');
  lines.push(inProgress('Analyzing sensitivity...'));
  lines.push('');

  const docEvents = events.filter((e) => e.details?.file_name != null);
  const findings = docEvents.filter((e) => e.severity !== 'info');

  if (findings.length === 0) {
    lines.push(dim('(no sensitive findings)'));
  } else {
    for (const e of findings) {
      const sev = e.severity;
      const sevColor = sev === 'critical' ? chalk.red.bold : chalk.yellow;
      const flagType = String(e.details?.flag_type ?? '');
      const provider = String(e.details?.provider ?? 'file');
      let label = FLAG_LABEL[flagType] ?? 'Finding';
      if (flagType === 'contains_credential') label = credentialLabel(String(e.details?.detail ?? ''));
      const title = `${label} found in ${provider} memory`;
      const excerpt = sensitiveExcerpt(String(e.details?.node_content ?? e.details?.detail ?? ''));
      const file = String(e.details?.file_name ?? '');
      const line = e.details?.line_start != null ? String(e.details.line_start) : '';
      lines.push(`  ${sevColor(`▲ ${SCAN_SEVERITY_LABEL[sev].padEnd(8)}`)}  ${chalk.white(title)}`);
      lines.push(`    ${chalk.dim(`"${excerpt}"  →  ${file}${line ? ':' + line : ''}`)}`);
      lines.push('');
    }
  }

  const counts = { critical: 0, high: 0, medium: 0 };
  for (const e of docEvents) {
    if (e.severity === 'critical') counts.critical++;
    else if (e.severity === 'warning') counts.high++;
    else counts.medium++;
  }
  lines.push(sensitivityMeter(counts));
  lines.push('');
  lines.push(
    `  ${chalk.green('✓')} ${chalk.bold.white('Scan complete.')} ${chalk.white(`${totals.entries} entries across ${totals.providers} providers.`)} ${chalk.dim('Report saved.')}`,
  );

  return lines.join('\n');
}
