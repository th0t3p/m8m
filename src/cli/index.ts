#!/usr/bin/env node
// m8m CLI entry point.

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { configPath, initConfigDir, loadConfig, m8mHomeDir, saveConfig } from '../core/config.js';
import {
  clearAllMemories,
  createSnapshot,
  flagMemory,
  getAllDocuments,
  getAllMemories,
  getAllSnapshots,
  getChangelog,
  getDocumentChangelog,
  getDocumentWithNodes,
  getMemory,
  getSecurityEvents,
  getStats,
  initDatabase,
  searchMemories,
  unflagMemory,
  updateMemoryStatus,
} from '../core/db.js';
import { diffMemories, diffSnapshots } from '../core/diff.js';
import {
  importBatch,
  importChatGPTExport,
  importClaudeExport,
  importFileAsDocument,
} from '../core/importer.js';
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
import type { MemoryNode, MemoryStatus, ProviderConfig, SourcePlatform } from '../core/types.js';
import { VERSION } from '../version.js';

const program = new Command();

program
  .name('m8m')
  .description('AI memory observability, provenance & security. Eight eyes. Nothing gets past.')
  .version(VERSION);

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
    if (src === 'claude' || src === 'claude_web') {
      const result = importBatch(importClaudeExport(file), 'manual_import');
      console.log(`Imported ${result.imported}, updated ${result.updated}, flagged ${result.flagged}`);
      return;
    }
    if (src === 'chatgpt' || src === 'chatgpt_web') {
      const result = importBatch(importChatGPTExport(file), 'manual_import');
      console.log(`Imported ${result.imported}, updated ${result.updated}, flagged ${result.flagged}`);
      return;
    }
    // Local file → memory file import (structured tree).
    const result = importFileAsDocument(file, null, (opts.platform ?? 'local_file') as SourcePlatform, 'manual_import');
    const flagNote = result.flagged_nodes > 0 ? `, ${result.flagged_nodes} flagged ⚠` : '';
    console.log(`✓ ${basename(file)} — 1 memory file, ${result.total_nodes} nodes${flagNote}`);
  });

// --- Scan ---------------------------------------------------------------
program
  .command('scan')
  .description('Discover + import memory files from all AI providers')
  .option('--dry-run', 'Only show discovered files, do not import')
  .option('--yes', 'Import without prompting for confirmation')
  .action(async (opts: { dryRun?: boolean; yes?: boolean }) => {
    const config = ensureDb();
    const files = scanForMemoryFiles(config.providers);
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

    let importedFiles = 0;
    let nodes = 0;
    let flagged = 0;
    for (const f of importable) {
      const result = importFileAsDocument(f.path, f.provider, f.platform, 'manual_import');
      const flagNote = result.flagged_nodes > 0 ? `, ${result.flagged_nodes} flagged ⚠` : '';
      console.log(`  ✓ ${f.provider}: ${basename(f.path)} — 1 memory file, ${result.total_nodes} nodes${flagNote}`);
      importedFiles++;
      nodes += result.total_nodes;
      flagged += result.flagged_nodes;
    }

    console.log('');
    console.log(`  Done: ${importedFiles} memory files imported, ${nodes} total nodes, ${flagged} flagged`);
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

// --- Docs ---------------------------------------------------------------
function renderDocTree(nodes: MemoryNode[], prefix = ''): string[] {
  const lines: string[] = [];
  for (const n of nodes) {
    const label = n.heading ?? truncate(n.content.replace(/\s+/g, ' ').trim(), 48);
    const flagMark = n.flags.length > 0 ? ' ⚠' : '';
    const branch = prefix + (n.node_type === 'section' ? '├── ' : '│   ');
    lines.push(`${prefix}${n.node_type} [${n.node_type}] ${label}${flagMark}`);
    if (n.children?.length) lines.push(...renderDocTree(n.children, prefix + '    '));
  }
  return lines;
}

const filesCmd = program
  .command('files')
  .description('List imported memory files')
  .action(() => {
    ensureDb();
    const files = getAllDocuments();
    console.log('');
    console.log('  Memory Files');
    console.log('  ────────────');
    if (!files.length) {
      console.log('  (no memory files imported yet — run `m8m import <file>` or `m8m scan`)');
      return;
    }
    console.log(`  ${'ID'.padEnd(10)} ${'Provider'.padEnd(15)} ${'Path'.padEnd(34)} ${'Nodes'.padEnd(6)} ${'Flags'.padEnd(6)} v${'Last modified'}`);
    for (const d of files) {
      const nodes = d.node_count ?? d.nodes?.length ?? 0;
      const provider = d.provider ?? d.source_platform;
      console.log(`  ${d.id.slice(0, 8).padEnd(10)} ${truncate(provider, 13).padEnd(15)} ${truncate(d.file_path, 32).padEnd(34)} ${String(nodes).padEnd(6)} ${String(d.flags_summary.length).padEnd(6)} v${d.version}`);
    }
  });

filesCmd.command('show <id>').description('Show memory file tree with flags').action((id) => {
  ensureDb();
  const doc = getDocumentWithNodes(id);
  if (!doc) {
    console.error(`Memory file not found: ${id}`);
    process.exit(1);
  }
  console.log('');
  const provider = doc.provider ? `, provider: ${doc.provider}` : '';
  console.log(`  ${doc.file_path} (${doc.source_platform}${provider}, v${doc.version}, trust: ${doc.trust_level})`);
  console.log('  ────────────────────────────────────────────────');
  for (const line of renderDocTree(doc.nodes ?? [])) console.log(`  ${line}`);
  if (doc.flags_summary.length) console.log(`\n  ${doc.flags_summary.length} node(s) flagged — run \`m8m audit\` for details.`);
});

filesCmd.command('raw <id>').description('Print the stored raw content').action((id) => {
  ensureDb();
  const doc = getAllDocuments().find((d) => d.id === id);
  if (!doc) {
    console.error(`Memory file not found: ${id}`);
    process.exit(1);
  }
  console.log(doc.raw_content);
});

filesCmd
  .command('export <id>')
  .description('Export raw content to file (recovery)')
  .option('--output <path>', 'Output file path (default: original file path)')
  .action((id, opts) => {
    ensureDb();
    const doc = getAllDocuments().find((d) => d.id === id);
    if (!doc) {
      console.error(`Memory file not found: ${id}`);
      process.exit(1);
    }
    const outPath = opts.output ?? doc.file_path;
    writeFileSync(outPath, doc.raw_content, 'utf8');
    console.log(`Exported ${doc.file_name} → ${outPath}`);
  });

filesCmd.command('diff <id>').description('Show memory file change history').action((id) => {
  ensureDb();
  const doc = getAllDocuments().find((d) => d.id === id);
  if (!doc) {
    console.error(`Memory file not found: ${id}`);
    process.exit(1);
  }
  const cl = getDocumentChangelog(id);
  console.log('');
  console.log(`  Change history — ${doc.file_path}`);
  console.log('  ───────────────────────────────');
  if (!cl.length) {
    console.log('  (no changes recorded)');
    return;
  }
  for (const c of cl) {
    console.log(`  ${c.changed_at}  ${c.change_type.padEnd(8)}  +${c.nodes_added} ~${c.nodes_modified} -${c.nodes_deleted}  (${c.detected_by})`);
  }
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

// --- Providers -----------------------------------------------------------
const providersCmd = program
  .command('providers')
  .description('List scan providers (agent-harness files/directories)')
  .action(() => {
    const config = loadConfig();
    if (config.providers.length === 0) {
      console.log('No providers configured.');
    } else {
      for (const p of config.providers) {
        console.log(`${p.name}  (platform: ${p.platform})`);
        for (const t of p.targets) {
          const kind = t.isDir ? 'dir ' : 'file';
          const exts = t.extensions?.length ? ` [${t.extensions.join(', ')}]` : '';
          const desc = t.description ? `  — ${t.description}` : '';
          console.log(`    ${kind.padEnd(5)} ${t.path}${exts}${desc}`);
        }
      }
    }
    console.log(`\n  Edit ${configPath()} → "providers" to customize, or use \`m8m providers add|rm\`.`);
  });

providersCmd
  .command('add <name> <path>')
  .description('Add a scan target (creates the provider if new)')
  .option('--platform <p>', 'Platform label', 'local_file')
  .option('--dir', 'Treat the path as a directory')
  .option('--desc <d>', 'Description of the target')
  .option('--ext <exts>', 'Comma-separated extensions for a directory target (e.g. .md,.json)')
  .action((name: string, path: string, opts: { platform?: string; dir?: boolean; desc?: string; ext?: string }) => {
    const config = loadConfig();
    const provider = config.providers.find((p) => p.name === name);
    const target: ProviderConfig['targets'][number] = {
      path,
      isDir: Boolean(opts.dir),
      description: opts.desc ?? '',
      extensions: opts.ext ? String(opts.ext).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    };
    if (provider) {
      provider.targets.push(target);
    } else {
      config.providers.push({ name, platform: (opts.platform ?? 'local_file') as SourcePlatform, targets: [target] });
    }
    saveConfig({ providers: config.providers });
    console.log(`✓ Added ${target.isDir ? 'directory' : 'file'} target ${path} under provider "${name}".`);
  });

providersCmd
  .command('rm <name>')
  .description('Remove a provider (and all its targets) from the scan config')
  .action((name: string) => {
    const config = loadConfig();
    const before = config.providers.length;
    config.providers = config.providers.filter((p) => p.name !== name);
    if (config.providers.length === before) {
      console.log(`No provider named "${name}" found.`);
      return;
    }
    saveConfig({ providers: config.providers });
    console.log(`✓ Removed provider "${name}".`);
  });

program.parseAsync(process.argv);
