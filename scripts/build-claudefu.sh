#!/bin/bash
set -e

# Build ClaudeFu for macOS (universal binary: arm64 + amd64)
# Usage: ./scripts/build-claudefu.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

# Ensure Go bin and common tool paths are available
# GUI-launched terminals may not have the full shell PATH
export PATH="$HOME/go/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# Source nvm if available (for npm/node)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" 2>/dev/null

echo "=== Building ClaudeFu ==="

# Step 1: Generate Wails bindings
echo "[1/3] Generating Wails bindings..."
wails generate module 2>&1 | tail -1

# Step 2: Build for macOS universal
echo "[2/3] Building macOS universal binary..."
wails build -platform darwin/universal 2>&1 | tail -3

# Step 3: Verify
APP="$REPO_ROOT/build/bin/ClaudeFu.app"
if [ -d "$APP" ]; then
    VERSION=$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")
    echo "[3/3] Build complete: $APP (v$VERSION)"
    echo ""
    echo "To run: open $APP"
else
    echo "[3/3] ERROR: Build output not found at $APP"
    exit 1
fi
