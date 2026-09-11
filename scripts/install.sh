#!/usr/bin/env bash
# One-command install for mem8 (from a clone): install dependencies, build, and link.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "→ Installing dependencies and building…"
if ! npm install; then
  # Read-only home / npm cache (e.g. some sandboxes): retry with a writable cache.
  echo "→ Default npm cache is not writable; retrying with a project-local cache…"
  export npm_config_cache="$REPO_ROOT/.npm-cache"
  npm install
fi

is_writable_dir() {
  [ -d "$1" ] || return 1
  local probe="$1/.mem8-wtest"
  if touch "$probe" 2>/dev/null; then
    rm -f "$probe"
    return 0
  fi
  return 1
}

find_writable_path_dir() {
  local IFS=':'
  local d
  for d in $PATH; do
    [ -n "$d" ] || continue
    if is_writable_dir "$d"; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}

install_shim() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/mem8" <<EOF
#!/usr/bin/env bash
# mem8 CLI shim (installed by scripts/install.sh)
export MEM8_HOME="\${MEM8_HOME:-$REPO_ROOT/.mem8-data}"
exec node "$REPO_ROOT/dist/cli/index.js" "\$@"
EOF
  chmod +x "$dir/mem8"
}

echo "→ Linking mem8 onto your PATH…"
if npm link >/dev/null 2>&1; then
  echo "✓ Installed globally. Try: mem8 --help"
else
  echo "→ Global link failed (read-only global bin); installing a local shim…"
  shim_dir="$(find_writable_path_dir || true)"
  if [ -n "${shim_dir:-}" ]; then
    install_shim "$shim_dir"
    echo "✓ Installed mem8 shim at $shim_dir/mem8"
    echo "  Run 'hash -r' (or open a new shell), then: mem8 --help"
  else
    echo "✗ No writable directory found on PATH. Run directly:"
    echo "  node $REPO_ROOT/dist/cli/index.js --help"
  fi
fi
