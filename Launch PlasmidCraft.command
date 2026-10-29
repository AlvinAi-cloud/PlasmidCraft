#!/bin/zsh
set -eu
unsetopt bgnice
PLASMIDCRAFT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
for PLASMIDCRAFT_TARGET in "local-preview-040" "release" "debug"; do
  PLASMIDCRAFT_APP="$PLASMIDCRAFT_DIR/src-tauri/target/$PLASMIDCRAFT_TARGET/bundle/macos/PlasmidCraft 0.4.app"
  PLASMIDCRAFT_EXECUTABLE="$PLASMIDCRAFT_APP/Contents/MacOS/plasmidcraft-desktop"
  if [ -x "$PLASMIDCRAFT_EXECUTABLE" ]; then
    # Run this exact local preview rather than relying on Launch Services to
    # select/register a bundle among the versioned builds in this checkout.
    # Detach from Terminal so closing its launcher window does not kill the app.
    PLASMIDCRAFT_LOG_DIR="$PLASMIDCRAFT_DIR/.tooling"
    mkdir -p "$PLASMIDCRAFT_LOG_DIR"
    PLASMIDCRAFT_LOG="$PLASMIDCRAFT_LOG_DIR/preview-launch.log"
    /usr/bin/nohup "$PLASMIDCRAFT_EXECUTABLE" > "$PLASMIDCRAFT_LOG" 2>&1 < /dev/null &
    PLASMIDCRAFT_PID=$!
    sleep 1
    if kill -0 "$PLASMIDCRAFT_PID" 2>/dev/null; then
      print 'PlasmidCraft 0.4 is starting. You can close this Terminal window.'
      exit 0
    else
      PLASMIDCRAFT_STATUS=0
      wait "$PLASMIDCRAFT_PID" || PLASMIDCRAFT_STATUS=$?
      cat "$PLASMIDCRAFT_LOG"
      print "PlasmidCraft exited during startup (exit $PLASMIDCRAFT_STATUS). Details: $PLASMIDCRAFT_LOG"
      if [[ -t 0 ]]; then
        read '?Press Enter to close.'
      fi
      exit "$PLASMIDCRAFT_STATUS"
    fi
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
