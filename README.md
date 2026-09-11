# Mem8

AI memory observability, provenance & security. Eight eyes. Nothing gets past.

Mem8 monitors what your AI agents remember about you — where each memory came
from, what changed, and whether anything looks suspicious. Four cooperating
pieces share one local SQLite database:

- **MCP server** — live memory operations as your agent works
- **File watcher** — tracks local memory files (`MEMORY.md`, `CLAUDE.md`, …)
- **CLI** — query and audit memory state from the terminal
- **Local dashboard** — a dark, browser-based visualization

Phase 1 is entirely local: SQLite storage, pattern-based analysis, and **zero**
LLM or network calls in the analyzer itself.

## Install

### From npm (published) — one command

```bash
npm install -g mem8
```

### From source (this repo) — one command

```bash
./scripts/install.sh
```

That installs dependencies, builds, and runs `npm link` so `mem8` is on your
`PATH`. (Equivalent manual steps: `npm install` then `npm install -g .`.)

### Run without installing

```bash
node dist/cli/index.js --help        # after `npm run build`
npx tsx src/cli/index.ts --help      # directly from TypeScript, no build
```

> **Data location:** everything lives in `~/.mem8/` by default. If `~` is
> read-only (e.g. some sandboxes), set `MEM8_HOME` to a writable directory:
> `export MEM8_HOME=/path/to/mem8-data`.

## Quick start

```bash
mem8 init                                   # create config + database
mem8 import ./MEMORY.md --platform local_file
mem8 status                                 # totals, flags, security events
mem8 list --flagged
mem8 audit
```

## CLI

```
mem8 init                             # Initialize config + database
mem8 status                           # Overview: totals, flagged, security events
mem8 list [--platform <p>] [--status <s>] [--source-type <t>] [--flagged]
mem8 show <id>                        # Full detail + changelog history
mem8 search <query> [--limit <n>]     # Keyword search
mem8 flag <id> --reason <reason>      # Manually flag a memory
mem8 unflag <id>                      # Remove flags
mem8 quarantine <id>                  # Quarantine a suspicious memory
mem8 restore <id>                     # Restore from quarantine
mem8 dismiss <id>                     # Clear flags + dismiss
mem8 import <file> [--source claude|chatgpt|local] [--platform <p>]
mem8 snapshot [--platform <p>]        # Manual snapshot for diffing
mem8 diff [--since "2 hours ago"] [--snapshot <id1> <id2>]
mem8 audit [--severity critical] [--resolved]
mem8 watch                            # Start the file watcher (foreground)
mem8 dashboard [--port <p>]           # Start the web dashboard (default 8808)
mem8 mcp                              # Start the MCP server (stdio)
mem8 config                           # Show config
mem8 config set <key> <value>         # Update a config value
mem8 config add-watch <path>          # Add a watch path
```

### Example

```bash
$ mem8 status

  Mem8 — Memory Observatory
  ─────────────────────────
  Total memories:     142
  Active:             138
  Quarantined:          2
  Flagged:              4

  By platform:
    claude_code:       89
    claude_web:        41
    chatgpt_web:       12

  Security events:      3 unresolved
```

## MCP server

Point your agent client at the stdio server (`dist/mcp/server.js`) to expose
`mem8_store`, `mem8_search`, `mem8_recent`, `mem8_status`, and `mem8_flag`.

### DeepSeek Harness (DSH)

Add a `dsh-mcp-client` instance to your profile's `cordis.patch.yml`
(e.g. `~/.dsh/profiles/<name>/cordis.patch.yml`):

```yaml
- insert:
    - id: mcp-mem8
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: mem8
        transport: stdio
        command: node
        args:
          - /absolute/path/to/mem8/dist/mcp/server.js
        env:
          MEM8_HOME: /absolute/path/to/mem8-data   # optional
```

Tools appear as `mcp__mem8__mem8_store`, etc.

### OpenAI Codex

Append to `~/.codex/config.toml`:

```toml
[mcp_servers.mem8]
command = "node"
args = ["/absolute/path/to/mem8/dist/mcp/server.js"]
startup_timeout_sec = 30

[mcp_servers.mem8.env]
MEM8_HOME = "/absolute/path/to/mem8-data"   # optional
```

Tools appear as `mem8_store`, etc.

## Dashboard

```bash
mem8 dashboard
# open http://localhost:8808
```

Four views: **Timeline**, **Memories**, **Security**, and **Diff**.

## Configuration

Config lives at `~/.mem8/config.json` (override the directory with `$MEM8_HOME`):

```json
{
  "db_path": "~/.mem8/mem8.db",
  "watch_paths": ["~/.claude/memories", "./.claude/MEMORY.md", "./AGENTS.md", "./MEMORY.md"],
  "dashboard_port": 8808,
  "auto_snapshot_interval_minutes": 60,
  "trust_levels": {
    "user_explicit": 0.9,
    "conversation": 0.7,
    "document": 0.5,
    "email": 0.3,
    "web_page": 0.3,
    "tool_output": 0.5,
    "ai_derived": 0.4,
    "unknown": 0.1
  }
}
```

## Analysis

Every memory that enters the store is analyzed by a pure pattern matcher (no ML):

1. **Instruction detection** — content that reads as a directive to the AI
2. **URL / email detection** — escalated when paired with instructions
3. **Credential detection** — API keys, AWS keys, tokens, passwords
4. **Contradiction detection** — same entity, conflicting facts
5. **Source unknown** — missing provenance
6. **Hidden character detection** — zero-width / bidi-override / homoglyphs

Findings are attached as flags, mapped to security events, and surfaced in the
CLI audit view and dashboard Security tab.

## Development

```bash
npm run build      # compile TypeScript + copy dashboard assets
npm test           # run the vitest suite
npm run dev        # tsx watch on the CLI (see scripts/dev.sh)
```

## License

MIT
