#!/usr/bin/env bash
#
# Wipe every installed copy of WhisperWoof, build a fresh one, and install it.
#
# Run this on the Mac you want to test on — it builds locally, so a macOS
# machine is required (electron-builder cannot produce a working .app from
# Linux, and the native modules have to compile for darwin-arm64).
#
#   ./scripts/fresh-install-mac.sh              clean + build + install + open
#   ./scripts/fresh-install-mac.sh --clean-only remove installs, build nothing
#   ./scripts/fresh-install-mac.sh --purge-data ALSO delete history + models
#
# Your dictation history and downloaded models are LEFT ALONE unless you pass
# --purge-data. Whisper models live under Application Support and the polish
# models under ~/.cache/openwhispr; purging means re-downloading gigabytes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="WhisperWoof"
BUNDLE_ID="com.whisperwoof.app"
SUPPORT_DIR="$HOME/Library/Application Support/$APP_NAME"
MODEL_CACHE="$HOME/.cache/openwhispr"

CLEAN_ONLY=0
PURGE_DATA=0
for arg in "$@"; do
  case "$arg" in
    --clean-only) CLEAN_ONLY=1 ;;
    --purge-data) PURGE_DATA=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only runs on macOS (found $(uname -s))." >&2
  exit 1
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Quitting $APP_NAME if it is running"
osascript -e "tell application \"$APP_NAME\" to quit" 2>/dev/null || true
pkill -f "$APP_NAME.app/Contents/MacOS" 2>/dev/null || true
sleep 1

say "Ejecting any mounted $APP_NAME disk images"
while IFS= read -r vol; do
  if [[ -n "$vol" ]]; then
    hdiutil detach "$vol" -force >/dev/null 2>&1 || true
  fi
done < <(ls -d "/Volumes/$APP_NAME"* 2>/dev/null || true)

say "Removing installed copies"
# Every place a .app realistically ends up, plus previous local builds.
CANDIDATES=(
  "/Applications/$APP_NAME.app"
  "$HOME/Applications/$APP_NAME.app"
  "$HOME/Downloads/$APP_NAME.app"
  "$HOME/Desktop/$APP_NAME.app"
  "$REPO_ROOT/dist"
)
for target in "${CANDIDATES[@]}"; do
  if [[ -e "$target" ]]; then
    echo "  removing $target"
    rm -rf "$target"
  fi
done

# Stale Launch Services entries are what leave a ghost icon behind after the
# bundle is gone, and what makes Spotlight open a copy that no longer exists.
say "Rebuilding the Launch Services database (clears ghost icons)"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -kill -r -domain local -domain system -domain user >/dev/null 2>&1 || true
fi
killall Dock >/dev/null 2>&1 || true

if [[ "$PURGE_DATA" -eq 1 ]]; then
  say "Purging user data (you asked for --purge-data)"
  for target in \
    "$SUPPORT_DIR" \
    "$MODEL_CACHE" \
    "$HOME/Library/Preferences/$BUNDLE_ID.plist" \
    "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState" \
    "$HOME/Library/Logs/$APP_NAME"
  do
    if [[ -e "$target" ]]; then
      echo "  removing $target"
      rm -rf "$target"
    fi
  done
  echo "  Transcription history and every downloaded model are gone."
  echo "  The app will re-download them on next launch."
else
  echo
  echo "  Keeping your data:"
  echo "    history + whisper models : $SUPPORT_DIR"
  echo "    polish models            : $MODEL_CACHE"
  echo "  Pass --purge-data to wipe these too."
fi

if [[ "$CLEAN_ONLY" -eq 1 ]]; then
  say "Done (--clean-only). Nothing was built."
  exit 0
fi

cd "$REPO_ROOT"

say "Installing npm dependencies"
npm ci

say "Compiling native modules and downloading engine binaries"
npm run compile:native
npm run download:whisper-cpp
npm run download:llama-server
npm run download:sherpa-onnx

say "Building the renderer"
npm run build:renderer

# Unsigned local build: notarization needs Apple credentials this machine
# almost certainly does not have, and CI builds the same way (ci.yml).
say "Packaging the app (unsigned, arm64)"
npx electron-builder --mac --arm64 \
  --config.mac.identity=null \
  --config.mac.notarize=false \
  --publish never

APP_BUILT="$(find "$REPO_ROOT/dist" -maxdepth 3 -name "$APP_NAME.app" -type d 2>/dev/null | head -1)"
if [[ -z "$APP_BUILT" ]]; then
  echo "Build finished but no $APP_NAME.app was found under dist/." >&2
  exit 1
fi

say "Installing to /Applications"
rm -rf "/Applications/$APP_NAME.app"
cp -R "$APP_BUILT" "/Applications/$APP_NAME.app"

# An unsigned local build carries no notarization ticket, so Gatekeeper would
# refuse it until the quarantine attribute is cleared.
xattr -dr com.apple.quarantine "/Applications/$APP_NAME.app" 2>/dev/null || true

say "Launching"
open "/Applications/$APP_NAME.app"

cat <<EOF

Installed: /Applications/$APP_NAME.app

The app is a menu-bar agent (LSUIElement), so it has no Dock icon — look for
it in the menu bar. Grant Microphone and Accessibility permissions when macOS
asks; without Accessibility, paste-at-cursor cannot work.

First launch downloads the Whisper model. The default is now large-v3-turbo
(~1.6GB), so give it a minute before the first dictation.
EOF
