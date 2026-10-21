#!/bin/bash
# Package the already-built app without Finder automation or recompilation.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <built.app> <output.dmg>" >&2
  exit 2
fi

app="$1"
output="$2"
if [ ! -d "$app/Contents/MacOS" ] || [ ! -f "$app/Contents/Info.plist" ]; then
  echo "Built macOS app not found: $app" >&2
  exit 1
fi
if [[ "$output" != *.dmg ]]; then
  echo "Output must have a .dmg extension" >&2
  exit 2
fi

app_name="$(basename "$app")"
mkdir -p "$(dirname "$output")"
work="$(mktemp -d "${TMPDIR:-/tmp}/plasmidcraft-dmg.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir "$work/staging"
# Exclude the private staging folder from Spotlight indexing.
touch "$work/staging/.metadata_never_index"
/usr/bin/ditto --norsrc --noextattr --noacl "$app" "$work/staging/$app_name"
ln -s /Applications "$work/staging/Applications"

for attempt in 1 2 3; do
  image="$work/attempt-$attempt.dmg"
  log="$work/attempt-$attempt.log"
  echo "Creating disk image (attempt $attempt of 3)"
  if /usr/bin/hdiutil create -volname "${app_name%.app}" \
      -srcfolder "$work/staging" -format UDZO "$image" >"$log" 2>&1; then
    cat "$log"
    /usr/bin/hdiutil verify "$image"
    mv -f "$image" "$output"
    echo "Verified disk image: $output"
    exit 0
  else
    status=$?
    cat "$log" >&2
    # A busy image service can be transient on hosted runners. Fail immediately
    # for other errors; retry only packaging, with a fresh image path each time.
    if [ "$attempt" -eq 3 ] || ! /usr/bin/grep -qi 'Resource busy' "$log"; then
      exit "$status"
    fi
    echo "Disk image service is busy; waiting before retrying." >&2
    sleep "$((attempt * 5))"
  fi
done
