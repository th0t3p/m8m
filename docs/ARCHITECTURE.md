# m8m — Architecture & Technical Decisions

> This document records the key technical decisions in m8m and the reasoning
> behind them. It's a living document, updated as the architecture evolves.

m8m is an AI memory observability, provenance, and security tool. It watches
what AI agents remember about you — where each memory came from, what changed,
and whether anything looks suspicious. These decisions explain *why* it's built
the way it is, and what we considered before committing to each choice.

---

## 1. Storage: SQLite, not PostgreSQL or a cloud database

**What we chose:** a single SQLite database file, local-first.

**Alternatives:** PostgreSQL, or a managed cloud database.

**Why:** Phase 1 is deliberately local-first. SQLite is zero-config, runs
everywhere Node runs, and the entire database is one portable file — users back
it up by copying a single file, and there's no server process to manage.
Performance is more than sufficient for thousands of memory entries.
PostgreSQL adds operational complexity that's unnecessary when the whole
product runs on one machine, and a cloud database would directly contradict the
local-first privacy story.

## 2. Dual storage: structured documents + flat entries

**What we chose:** two coexisting layers in the same database.

- **File-based memories** (`CLAUDE.md`, `MEMORY.md`, etc.) are stored as
  documents with tree-structured nodes, preserving the original hierarchy.
- **MCP-created memories** are stored as flat entries, because they genuinely
  *are* atomic facts.

**Alternatives:** one uniform model — either flatten documents into entries, or
force atomic facts into a tree.

**Why:** forcing structured documents into a flat format destroys context, and
forcing atomic facts into a tree adds needless complexity. Two shapes, matched
to what each kind of memory actually is, is simpler than either forced fit.

## 3. Raw content storage: full original files kept byte-for-byte

**What we chose:** every imported file's complete content is stored in the
database, unmodified.

**Why:** it enables full recovery if the source files are lost, re-parsing when
the parser improves, and exact provenance — any node can be traced back to its
line in the original file. The storage cost is negligible: memory files are
typically under 100 KB.

## 4. Analyzer: regex and heuristics, no LLM calls

**What we chose:** Phase 1 detection uses pure pattern matching.

**Alternatives:** an LLM-based analyzer.

**Why:** this is a deliberate tradeoff. Regex gives zero external dependencies,
zero cost per scan, zero latency, deterministic results — and critically, the
analyzer itself *cannot be prompt-injected*, because there's no model to
manipulate. An LLM-based analyzer could be attacked by the very content it's
scanning. The tradeoff is lower sophistication: regex catches obvious attacks
(credentials, blatant instructions, hidden characters) but misses subtle
paraphrased attacks. ML-based detection (MEMSAD-style embedding anomaly
scoring) is planned for Phase 2, once we have real user data to calibrate
against.

## 5. Trust scoring: static by source type, not dynamic

**What we chose:** trust levels are assigned once, based on where a memory came
from — 0.9 for user-explicit, 0.3 for email/web, 0.1 for unknown. Trust does
not change with user feedback or validation.

**Why:** it's simpler to reason about and avoids the complexity of trust
decay/growth models. Dynamic trust (feedback-adjusted scores, composite risk
scoring) is planned for Phase 2.

## 6. MCP server: both observer and memory backend

**What we chose:** the MCP server plays two roles — it can passively log memory
operations from other tools, and it can actively serve as the primary memory
store for agents that call `m8m_store` / `m8m_search`.

**Why:** the dual role emerged from a simple insight — most MCP-based agents
don't have a good memory solution, and building security *into* the memory
backend is more effective than bolting it onto someone else's.

## 7. File watcher: OS-level events (chokidar), not polling

**What we chose:** chokidar registers native filesystem watchers
(inotify/FSEvents) that fire on every change with sub-second latency.

**Alternatives:** polling the filesystem on an interval.

**Why:** polling would miss rapid changes and waste CPU. The tradeoff is that
the watcher has to be running to catch changes — there's no catch-up mechanism
yet for changes that happen while it's stopped. Catch-up-on-launch is planned.

## 8. Tree-based document parsing, not line-by-line

**What we chose:** markdown files are parsed into a tree of sections, bullets,
code blocks, and paragraphs. Each node is analyzed individually, but with
parent context — a URL inside a code block under "API documentation" gets lower
severity than a URL in a standalone bullet.

**Alternatives:** line-by-line parsing (the original approach).

**Why:** line-by-line parsing destroyed document structure — a 50-line
`CLAUDE.md` became 50 decontextualized fragments, producing false positives and
meaningless entries. The tree preserves the structure that gives each node
meaning.

## 9. No browser extension in Phase 1

**What we chose:** ship the MCP server and file watcher, not a browser
extension.

**Why:** browser extensions for claude.ai/chatgpt.com rely on the same
DOM-reading technique as the malicious Chrome extensions that stole 900K users'
conversations in January 2026. Launching with one would create Chrome Web Store
review friction, platform ToS risk, and a user-trust paradox — a security tool
requesting the same permissions as known malware. The MCP server and file
watcher already cover the highest-risk surface (coding agents with filesystem
access) without any of that. A browser extension is planned for Phase 2, once
the project has an established open-source reputation.

## 10. MIT license, not Apache 2.0 or AGPL

**What we chose:** MIT.

**Why:** MIT maximizes adoption with minimum friction. Some companies have
blanket approval for MIT but require legal review for Apache 2.0. AGPL would
discourage integration. The patent grant in Apache 2.0 is unnecessary for a
solo developer with no patents. Relicensing remains possible if the project's
needs change.

## 11. Single repo, not a monorepo with separate paid features

**What we chose:** all Phase 1 code lives in one public repo. Paid features
(Phase 2+ ML detection, hosted dashboard) will go in a separate private repo
that imports the open-source core as a dependency.

**Why:** the split hasn't happened yet because there are no paid features to
separate. The database schema is already designed to accommodate paid features
— fields like `anomaly_score` exist but are populated with defaults in the free
version.

## 12. TypeScript throughout, not mixed languages

**What we chose:** one language across the CLI, dashboard, and core logic.

**Why:** the MCP SDK is TypeScript-native, so there's no interop friction, and
any contributor can work on any part of the codebase. A Python SDK is planned
for Phase 2 as a thin wrapper.
