#!/usr/bin/env bash
# Installs the remote app and pattern designer dependencies for a fresh checkout
# or worktree. Both Claude and Codex use this entry point; Codex also invokes it
# through .codex/environments/environment.toml when creating a worktree.
set -euo pipefail

# Resolve the checkout from this script so callers can start in any directory.
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bun install --cwd "$repo_root/app" --frozen-lockfile
bun install --cwd "$repo_root/designer" --frozen-lockfile
