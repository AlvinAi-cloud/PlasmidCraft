#!/bin/zsh
set -eu
PLASMIDCRAFT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
for PLASMIDCRAFT_TARGET in "release" "x86_64-apple-darwin/release" "aarch64-apple-darwin/release" "debug"; do
  PLASMIDCRAFT_APP="$PLASMIDCRAFT_DIR/src-tauri/target/$PLASMIDCRAFT_TARGET/bundle/macos/PlasmidCraft 0.31.app"
  if [ -d "$PLASMIDCRAFT_APP" ]; then
    exec /usr/bin/open -n "$PLASMIDCRAFT_APP"
  fi
done
PLASMIDCRAFT_PREVIEW="$PLASMIDCRAFT_DIR/src-tauri/target/debug/plasmidcraft-desktop"
if [[ -x "$PLASMIDCRAFT_PREVIEW" && "$PLASMIDCRAFT_PREVIEW" -nt "$PLASMIDCRAFT_DIR/src-tauri/tauri.conf.json" ]]; then
  exec "$PLASMIDCRAFT_PREVIEW"
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print 'Compile the local desktop preview, or install Node.js 22.13+ and the prerequisites in README.md to build from source.'
  read '?Press Enter to close.'
  exit 1
fi
cd "$PLASMIDCRAFT_DIR"
exec node scripts/desktop.mjs dev
