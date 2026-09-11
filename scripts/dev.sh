#!/usr/bin/env bash
# Development mode with hot reload (tsx watch).
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec npm run dev -- "$@"
