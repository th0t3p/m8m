// Provider definitions: which files/directories to scan for each agent harness.
//
// These are the *defaults*. Users override them by editing the `providers`
// section of `~/.m8m/config.json` (see `m8m providers` / `m8m config`).

import type { ProviderConfig } from './types.js';

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: 'Claude Code',
    platform: 'claude_code',
    targets: [
      { path: '~/.claude/CLAUDE.md', description: 'User-level instructions' },
      { path: '~/.claude/memories', description: 'User memories directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
      { path: './CLAUDE.md', description: 'Project-level instructions' },
      { path: './.claude/MEMORY.md', description: 'Project-level memory' },
      { path: './.claude/settings.json', description: 'Project settings' },
    ],
  },
  {
    name: 'Claude Desktop',
    platform: 'claude_desktop',
    targets: [
      { path: '~/.config/Claude/claude_desktop_config.json', description: 'Desktop config' },
      { path: '~/Library/Application Support/Claude/claude_desktop_config.json', description: 'Desktop config' },
    ],
  },
  {
    name: 'Cursor',
    platform: 'cursor',
    targets: [
      { path: './.cursor/rules', description: 'Project rules directory', isDir: true, extensions: ['.md', '.txt', '.mdc'] },
      { path: './.cursorrules', description: 'Project rules' },
      { path: '~/.cursor/rules', description: 'User rules directory', isDir: true, extensions: ['.md', '.txt', '.mdc'] },
    ],
  },
  {
    name: 'Windsurf',
    platform: 'windsurf',
    targets: [
      { path: './.windsurfrules', description: 'Project rules' },
      { path: '~/.codeium/windsurf/memories', description: 'Memories directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
    ],
  },
  {
    name: 'Cline',
    platform: 'cline',
    targets: [
      { path: './.clinerules', description: 'Project rules' },
      { path: '~/.cline/memory', description: 'Memory directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
    ],
  },
  {
    name: 'Codex',
    platform: 'codex',
    targets: [
      { path: '~/.codex/config.toml', description: 'Config' },
      { path: '~/.codex/instructions.md', description: 'Global instructions' },
      { path: '~/.codex/AGENTS.md', description: 'Global agent rules' },
      { path: './codex.md', description: 'Project instructions' },
    ],
  },
  {
    name: 'Aider',
    platform: 'aider',
    targets: [
      { path: './.aider.conf.yml', description: 'Project config' },
      { path: '~/.aider.conf.yml', description: 'User config' },
    ],
  },
  {
    name: 'GitHub Copilot',
    platform: 'copilot',
    targets: [{ path: './.github/copilot-instructions.md', description: 'Project instructions' }],
  },
  {
    name: 'Continue.dev',
    platform: 'continue_dev',
    targets: [
      { path: './.continue/config.json', description: 'Project config' },
      { path: '~/.continue/config.json', description: 'User config' },
    ],
  },
  {
    name: 'CodeBuddy',
    platform: 'codebuddy',
    targets: [
      { path: '~/.codebuddy/CODEBUDDY.md', description: 'User-level instructions' },
      { path: '~/.codebuddy/rules', description: 'User rules directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
      { path: '~/.codebuddy/memories', description: 'User memories directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
      { path: './CODEBUDDY.md', description: 'Project-level instructions' },
      { path: './.codebuddy/rules', description: 'Project rules directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
    ],
  },
  {
    name: 'Generic agents',
    platform: 'local_file',
    targets: [
      { path: './MEMORY.md', description: 'Project memory' },
      { path: './AGENTS.md', description: 'Project instructions' },
      { path: './.agent/memory.json', description: 'Agent memory' },
    ],
  },
];
