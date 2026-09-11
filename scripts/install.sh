#!/usr/bin/env bash
# One-command install for mem8 (from a clone): install dependencies, build, and link globally.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ Installing dependencies and building…"
if ! npm install; then
  # Read-only home / npm cache (e.g. some sandboxes): retry with a writable cache.
  echo "→ Default npm cache is not writable; retrying with a project-local cache…"
  export npm_config_cache="$(pwd)/.npm-cache"
  npm install
fi

echo "→ Linking mem8 onto your PATH…"
if npm link >/dev/null 2>&1; then
  echo ""
  echo "Done. Try: mem8 --help"
else
  echo ""
  echo "Global link failed (the global bin directory is likely read-only on this machine)."
  echo "Run mem8 directly instead:"
  echo "  node $(pwd)/dist/cli/index.js --help"
fi
