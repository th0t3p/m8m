#!/usr/bin/env node
// m8m CLI entry point.

import { Command } from 'commander';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { initConfigDir, loadConfig, m8mHomeDir, saveConfig } from '../core/config.js';
import {
  clearAllMemories,
  createSnapshot,
  flagMemory,
  getAllMemories,
  getAllSnapshots,
  getChangelog,
  getMemory,
  getSecurityEvents,
  getStats,
  initDatabase,
  searchMemories,
  unflagMemory,
  updateMemoryStatus,
} from '../core/db.js';
import { diffMemories, diffSnapshots } from '../core/diff.js';
import { importBatch, importChatGPTExport, importClaudeExport, importLocalMemoryFile } from '../core/importer.js';
import { formatDiscovery, isImportablePath, scanForMemoryFiles } from '../core/scanner.js';
import { startDashboard } from '../dashboard/server.js';
import { startMcpServer } from '../mcp/server.js';
import { addM8mToClient, SUPPORTED_CLIENTS, type McpClient } from './mcp-setup.js';
import { startWatcher } from '../watcher/watcher.js';
import {
  formatDiff,
  formatMemoryDetail,
  formatMemoryList,
  formatSecurityEvents,
  formatStatBlock,
  truncate,
} from './formatters.js';
import type { MemoryStatus } from '../core/types.js';

const program = new Command();

program
  .name('m8m')
  .description('AI memory observability, provenance & security. Eight eyes. Nothing gets past.')
  .version('0.1.0');

function ensureDb() {
  const config = loadConfig();
  initDatabase(config.db_path);
  return config;
}

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function parseValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  const num = Number(v);
  if (v.trim() !== '' && !Number.isNaN(num)) return num;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function parseTimeAgo(input: string): string {
  const direct = new Date(input);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const m = input.match(/^(\d+)\s+(minute|minutes|min|hour|hours|day|days|week|weeks)\s+ago$/i);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const ms: Record<string, number> = {
      minute: 60_000, minutes: 60_000, min: 60_000,
      hour: 3_600_000, hours: 3_600_000,
      day: 86_400_000, days: 86_400_000,
      week: 604_800_000, weeks: 604_800_000,
    };
    return new Date(Date.now() - n * (ms[unit] ?? 0)).toISOString();
  }
  return input;
}

function renderChangelogSince(cl: ReturnType<typeof getChangelog>): string {
  if (cl.length === 0) return '  (no changes since that time)';
  const lines = ['', '  Memory changes', '  ─────────────────────────────'];
  for (const c of cl) {
    const sigil = c.change_type === 'created' ? '+' : c.change_type === 'deleted' ? '-' : '~';
    const text = c.new_content ?? c.old_content ?? '';
    lines.push(`  ${sigil} [${c.memory_id.slice(0, 8)}] ${truncate(text, 60)}`);
  }
  lines.push('', `  Summary: ${cl.length} change(s)`);
  return lines.join('\n');
}

// --- Init ---------------------------------------------------------------
program
  .command('init')
  .description('Initialize the m8m config directory and database')
  .action(() => {
    initConfigDir();
    const config = loadConfig();
    initDatabase(config.db_path);
    console.log(`m8m initialized at ${m8mHomeDir()}`);
  });

// --- Status -------------------------------------------------------------
program
  .command('status')
  .description('Overview: total memories, flagged, security events')
  .action(() => {
    ensureDb();
    const stats = getStats();
    const unresolved = getSecurityEvents({ resolved: false }).length;
    console.log(formatStatBlock(stats, unresolved));
    const lastChange = getChangelog()[0];
    const lastSnapshot = getAllSnapshots()[0];
    if (lastChange) console.log(`\n  Last change:         ${lastChange.changed_at}`);
    if (lastSnapshot) console.log(`  Last snapshot:       ${lastSnapshot.taken_at} (${lastSnapshot.platform})`);
  });

// --- List ---------------------------------------------------------------
program
  .command('list')
  .description('List memories with filters')
  .option('--platform <p>', 'Filter by source platform')
  .option('--status <s>', 'Filter by status')
  .option('--source-type <t>', 'Filter by source type')
  .option('--flagged', 'Only show flagged memories')
  .action((opts) => {
    ensureDb();
    let entries = getAllMemories({
      source_platform: opts.platform,
      status: opts.status as MemoryStatus | undefined,
    });
    if (opts.sourceType) entries = entries.filter((e) => e.source_type === opts.sourceType);
    if (opts.flagged) entries = entries.filter((e) => e.flags.length > 0);
    console.log(formatMemoryList(entries));
  });

// --- Show ---------------------------------------------------------------
program
  .command('show <id>')
  .description('Show full detail of one memory entry')
  .action((id) => {
    ensureDb();
    const entry = getMemory(id);
    if (!entry) {
      console.error(`Memory not found: ${id}`);
      process.exit(1);
    }
    console.log(formatMemoryDetail(entry, getChangelog({ memory_id: id })));
  });

// --- Search -------------------------------------------------------------
program
  .command('search <query>')
  .description('Search memories by keyword')
  .option('--limit <n>', 'Max results (default 10)')
  .action((query, opts) => {
    ensureDb();
    const results = searchMemories(query, Number.parseInt(opts.limit ?? '10', 10));
    console.log(formatMemoryList(results));
  });

// --- Flag / unflag ------------------------------------------------------
program
  .command('flag <id>')
  .description('Manually flag a memory as suspicious')
  .requiredOption('--reason <reason>', 'Reason for flagging')
  .action((id, opts) => {
    ensureDb();
    flagMemory(id, opts.reason, 'cli');
    console.log(`Flagged ${id}`);
  });

program
  .command('unflag <id>')
  .description('Remove flags / dismiss a memory')
  .action((id) => {
    ensureDb();
    unflagMemory(id, 'cli');
    console.log(`Unflagged ${id}`);
  });

// --- Status mutations ---------------------------------------------------
program
  .command('quarantine <id>')
  .description('Quarantine a suspicious memory')
  .action((id) => {
    ensureDb();
    updateMemoryStatus(id, 'quarantined', 'cli');
    console.log(`Quarantined ${id}`);
  });

program
  .command('restore <id>')
  .description('Restore a quarantined memory to active')
  .action((id) => {
    ensureDb();
    updateMemoryStatus(id, 'active', 'cli');
    console.log(`Restored ${id}`);
  });

program
  .command('dismiss <id>')
  .description('Dismiss a memory (clear flags + mark dismissed)')
  .action((id) => {
    ensureDb();
    unflagMemory(id, 'cli');
    updateMemoryStatus(id, 'dismissed', 'cli');
    console.log(`Dismissed ${id}`);
  });

// --- Clear --------------------------------------------------------------
program
  .command('clear')
  .description('Clear all stored memories (soft-delete)')
  .option('-f, --force', 'Skip the confirmation prompt')
  .action(async (opts: { force?: boolean }) => {
    ensureDb();
    const count = getAllMemories().filter((m) => m.status !== 'deleted').length;
    if (count === 0) {
      console.log('No active memories to clear.');
      return;
    }
    if (!opts.force) {
      const ok = await confirm(`Clear all ${count} memories? This soft-deletes them (kept in changelog). [y/N] `);
      if (!ok) {
        console.log('Aborted. Re-run with -f to skip this prompt.');
        return;
      }
    }
    const cleared = clearAllMemories('cli');
    console.log(`Cleared ${cleared} memories (soft-deleted). Run \`m8m audit\` to review.`);
  });

// --- Import -------------------------------------------------------------
program
  .command('import <file>')
  .description('Import from Claude/ChatGPT export or a local memory file')
  .option('--source <s>', 'claude | chatgpt | local (default: auto by extension)')
  .option('--platform <p>', 'Platform label for local files (default local_file)')
  .action((file, opts) => {
    ensureDb();
    const src = String(opts.source ?? '').toLowerCase();
    let entries;
    if (src === 'claude' || src === 'claude_web') entries = importClaudeExport(file);
    else if (src === 'chatgpt' || src === 'chatgpt_web') entries = importChatGPTExport(file);
    else entries = importLocalMemoryFile(file, opts.platform ?? 'local_file');
    const result = importBatch(entries, 'manual_import');
    console.log(`Imported ${result.imported}, updated ${result.updated}, flagged ${result.flagged}`);
  });

// --- Scan ---------------------------------------------------------------
program
  .command('scan')
  .description('Discover + import memory files from all AI providers')
  .option('--dry-run', 'Only show discovered files, do not import')
  .option('--yes', 'Import without prompting for confirmation')
  .action(async (opts: { dryRun?: boolean; yes?: boolean }) => {
    ensureDb();
    const files = scanForMemoryFiles();
    console.log(formatDiscovery(files));

    if (opts.dryRun) return;

    const importable = files.filter((f) => isImportablePath(f.path));
    if (importable.length === 0) {
      console.log('\n  No importable memory files found.');
      return;
    }

    if (!opts.yes) {
      const ok = await confirm(`\n  Import ${importable.length} file(s)? [y/N] `);
      if (!ok) {
        console.log('  Aborted.');
        return;
      }
    }

    let imported = 0;
    let updated = 0;
    let flagged = 0;
    for (const f of importable) {
      const entries = importLocalMemoryFile(f.path, f.platform);
      const result = importBatch(entries, 'manual_import');
      const flagNote = result.flagged > 0 ? `, ${result.flagged} flagged ⚠` : '';
      console.log(`  ✓ ${f.provider}: ${basename(f.path)} — ${result.imported} new, ${result.updated} updated${flagNote}`);
      imported += result.imported;
      updated += result.updated;
      flagged += result.flagged;
    }

    console.log('');
    console.log(`  Done: ${imported} imported, ${updated} updated, ${flagged} flagged`);
    if (flagged > 0) console.log('  Run `m8m audit` to review flagged entries.');
  });

// --- Snapshot -----------------------------------------------------------
program
  .command('snapshot')
  .description('Take a manual snapshot of all memories')
  .option('--platform <p>', 'Platform label (default manual)')
  .action((opts) => {
    ensureDb();
    createSnapshot(opts.platform ?? 'manual', getAllMemories());
    console.log('Snapshot created.');
  });

// --- Diff ---------------------------------------------------------------
program
  .command('diff')
  .description('Show changes since last snapshot or a given time')
  .option('--since <datetime>', 'Show changes since a time (ISO or "2 hours ago")')
  .option('--snapshot <id1> <id2>', 'Compare two snapshots by id')
  .action((opts) => {
    ensureDb();
    if (Array.isArray(opts.snapshot) && opts.snapshot.length === 2) {
      console.log(formatDiff(diffSnapshots(opts.snapshot[0], opts.snapshot[1])));
      return;
    }
    if (opts.since) {
      const since = parseTimeAgo(opts.since);
      console.log(renderChangelogSince(getChangelog({ since })));
      return;
    }
    const latest = getAllSnapshots()[0];
    const diff = diffMemories(latest ? latest.snapshot_data : [], getAllMemories());
    console.log(formatDiff(diff));
  });

// --- Audit --------------------------------------------------------------
program
  .command('audit')
  .description('List security events (unresolved first)')
  .option('--severity <s>', 'Filter by severity (info | warning | critical)')
  .option('--resolved', 'Show resolved events too')
  .action((opts) => {
    ensureDb();
    const events = getSecurityEvents({
      severity: opts.severity,
      resolved: opts.resolved ? undefined : false,
    });
    console.log(formatSecurityEvents(events));
  });

// --- Watch --------------------------------------------------------------
program
  .command('watch')
  .description('Start the file watcher (foreground)')
  .action(async () => {
    const config = ensureDb();
    await startWatcher(config);
  });

// --- Dashboard ----------------------------------------------------------
program
  .command('dashboard')
  .description('Start the local web dashboard')
  .option('--port <p>', 'Override dashboard port')
  .action((opts) => {
    loadConfig();
    startDashboard(opts.port ? Number.parseInt(opts.port, 10) : undefined);
  });

// --- MCP ----------------------------------------------------------------
const mcpCmd = program
  .command('mcp')
  .description('Start the MCP server (stdio)')
  .action(async () => {
    await startMcpServer();
  });

mcpCmd
  .command('add <client>')
  .description('Add m8m to an MCP client config (codex | claude | cursor | dsh)')
  .option('--data-dir <path>', 'Set M8M_HOME in the generated config')
  .action((client: string, opts: { dataDir?: string }) => {
    if (!SUPPORTED_CLIENTS.includes(client as McpClient)) {
      console.error(`Unknown client "${client}". Supported: ${SUPPORTED_CLIENTS.join(', ')}`);
      process.exit(1);
    }
    const result = addM8mToClient(client as McpClient, opts.dataDir);
    if (result.already) {
      console.log(`m8m is already configured for ${client} (${result.path}).`);
      return;
    }
    if (result.manualSnippet) {
      console.log(`Could not safely edit ${result.path} (it already has content).`);
      console.log('Add this entry to it manually:\n');
      console.log(result.manualSnippet);
      return;
    }
    console.log(`✓ Wrote m8m MCP config to ${result.path}`);
    console.log(`  Restart ${client} to pick it up.`);
  });

// --- Config -------------------------------------------------------------
const configCmd = program
  .command('config')
  .description('Show current config')
  .action(() => {
    console.log(JSON.stringify(loadConfig(), null, 2));
  });

configCmd
  .command('set <key> <value>')
  .description('Update a config value (e.g. dashboard_port, trust_levels.conversation)')
  .action((key, value) => {
    const parsed = parseValue(value);
    const config = loadConfig();
    if (key.includes('.')) {
      const [a, b] = key.split('.');
      (config as unknown as Record<string, Record<string, unknown>>)[a][b] = parsed;
      saveConfig(config);
    } else {
      saveConfig({ [key]: parsed } as Parameters<typeof saveConfig>[0]);
    }
    console.log(`Set ${key} = ${JSON.stringify(parsed)}`);
  });

configCmd
  .command('add-watch <path>')
  .description('Add a watch path')
  .action((path) => {
    const config = loadConfig();
    saveConfig({ watch_paths: [...config.watch_paths, path] });
    console.log(`Added watch path: ${path}`);
  });

program.parseAsync(process.argv);
