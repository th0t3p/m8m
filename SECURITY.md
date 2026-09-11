# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue
for vulnerabilities.

- **Preferred:** open a GitHub Security Advisory at
  https://github.com/th0t3p/mem8/security/advisories/new
  (repo → Security → Report a vulnerability).
- We aim to respond within 48 hours.
- We will coordinate disclosure timing with you.

## Scope

Mem8 handles sensitive data — AI memories, which may contain personal
information, credentials, and behavioral patterns. We take the security of this
data seriously.

In scope:

- Vulnerabilities in the analyzer that could allow detection bypass
- Data leakage from the local SQLite database
- MCP server vulnerabilities
- Dashboard authentication bypass (when auth is added)

Out of scope:

- Vulnerabilities in third-party dependencies (report to the upstream project)
- Social engineering attacks
- Physical access attacks

## Architecture security notes

- Phase 1 is entirely local. No data leaves your machine.
- The SQLite database is stored at `~/.mem8/mem8.db` with default filesystem
  permissions.
- The MCP server runs over stdio (no network listener).
- The dashboard listens on `localhost` only (not exposed to the network).
- No LLM calls are made by the analyzer — all detection is pattern-based,
  eliminating the risk of the analyzer itself being prompt-injected.
