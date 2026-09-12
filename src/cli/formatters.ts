// Terminal output formatting helpers.

import chalk from 'chalk';
import Table from 'cli-table3';
import type {
  ChangelogEntry,
  MemoryDiff,
  MemoryEntry,
  M8mStats,
  SecurityEvent,
} from '../core/types.js';

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
export function formatRollbackPreview(diff: MemoryDiff): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('  Rollback preview'));
  lines.push(chalk.gray('  ────────────────'));
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
    lines.push(chalk.gray('  (no changes — the store already matches this snapshot)'));
  } else {
    const parts: string[] = [];
    if (diff.added.length) parts.push(`restore ${diff.added.length}`);
    if (diff.modified.length) parts.push(`revert ${diff.modified.length}`);
    if (diff.deleted.length) parts.push(`remove ${diff.deleted.length}`);
    lines.push('');
    lines.push(chalk.bold(`  Will ${parts.join(', ')}`));
  }
  return lines.join('\n');
}

export function formatSecurityEvents(events: SecurityEvent[]): string {
  if (events.length === 0) return chalk.gray('  (no security events)');
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('  Security Events'));
  lines.push(chalk.gray('  ───────────────'));
  for (const e of events) {
    const sev = e.severity === 'critical' ? chalk.red('🔴 CRITICAL') : e.severity === 'warning' ? chalk.yellow('⚠ WARNING') : chalk.cyan('ℹ INFO');
    lines.push(`${sev} [${e.detected_at}] ${e.title}`);
    if (e.memory_id) lines.push(chalk.gray(`     Memory: ${e.memory_id.slice(0, 8)}`));
    if (e.details?.detail) lines.push(chalk.gray(`     ${String(e.details.detail)}`));
    lines.push('');
  }
  return lines.join('\n');
}
