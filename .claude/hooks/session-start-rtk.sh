#!/bin/bash
set -euo pipefail

# RTK (rtk-ai/rtk) - token-saving CLI proxy for Claude Code.
# Containers for Claude Code on the web are ephemeral per session, so this
# installs/registers RTK on every session start. Idempotent: skips work
# whenever the binary or hook registration is already in place.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

RTK_BIN="$HOME/.local/bin/rtk"
mkdir -p "$HOME/.local/bin"

if [ ! -x "$RTK_BIN" ]; then
  # Fast path: official installer (works when github.com/rtk-ai/rtk releases
  # are reachable from this session).
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh 2>/dev/null | sh >&2 2>&1 || true
fi

if [ ! -x "$RTK_BIN" ] && command -v cargo >/dev/null 2>&1; then
  # Fallback: some session network policies block GitHub API/releases
  # downloads for repos outside the session's repo scope, but plain
  # `git clone` still works. Build from source instead.
  RTK_SRC_CACHE="$HOME/.cache/rtk-src"
  if [ ! -d "$RTK_SRC_CACHE/.git" ]; then
    git clone --depth 1 https://github.com/rtk-ai/rtk.git "$RTK_SRC_CACHE" >&2
  fi
  if [ ! -x "$RTK_SRC_CACHE/target/release/rtk" ]; then
    (cd "$RTK_SRC_CACHE" && cargo build --release) >&2
  fi
  cp "$RTK_SRC_CACHE/target/release/rtk" "$RTK_BIN"
  chmod +x "$RTK_BIN"
fi

if [ ! -x "$RTK_BIN" ]; then
  echo "rtk: install failed (no releases access and no cargo/rustc available) - skipping" >&2
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

# Persist PATH for the rest of the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -q '.local/bin' "$CLAUDE_ENV_FILE" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

# Register the Claude Code PreToolUse hook + RTK.md/CLAUDE.md reference
# (global scope, non-interactive, idempotent - detects an existing hook and
# skips re-patching).
rtk init -g --auto-patch >&2 || true
