#!/usr/bin/env bash
#
# Install (or update) WhisperWoof from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/h3qing/WhisperWoof/main/scripts/install.sh | bash
#
# Downloads the latest .dmg, checks it against the SHA-256 GitHub publishes for
# the asset, copies WhisperWoof.app into /Applications (replacing an older
# copy), and opens it. Files fetched with curl aren't quarantined, so macOS
# doesn't show the "could not verify" prompt an unsigned app gets when it's
# downloaded through a browser. Your history, notes and models are untouched.
set -euo pipefail

REPO="h3qing/WhisperWoof"
APP_NAME="WhisperWoof"
# Override only for testing the script without touching the real install.
DEST_DIR="${WHISPERWOOF_INSTALL_DIR:-/Applications}"
DEST="$DEST_DIR/$APP_NAME.app"

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "WhisperWoof is a macOS app."
[[ "$(uname -m)" == "arm64" ]] || fail "WhisperWoof currently ships for Apple Silicon (M1 or newer) only."

WORK="$(mktemp -d)"
MOUNT=""
cleanup() {
  [[ -n "$MOUNT" ]] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

say "Finding the latest release"
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")"
# Pick the arm64 .dmg asset: release tag, download URL, SHA-256 digest (if
# GitHub provides one). JavaScript for Automation ships with every Mac;
# python3 would prompt a fresh Mac to install developer tools.
PICKED="$(osascript -l JavaScript -e '
function run(argv) {
  const release = JSON.parse(argv[0]);
  const dmg = (release.assets || []).find((a) => a.name.endsWith("-arm64.dmg"));
  if (!dmg) return "";
  const digest = (dmg.digest || "").replace(/^sha256:/, "") || "-";
  return [release.tag_name, dmg.browser_download_url, digest].join(" ");
}' "$RELEASE_JSON" 2>/dev/null || true)"
[[ -n "$PICKED" ]] || fail "Couldn't find a macOS download in the latest release."
read -r TAG DMG_URL DIGEST <<<"$PICKED"

say "Downloading WhisperWoof $TAG"
curl -fL --progress-bar -o "$WORK/$APP_NAME.dmg" "$DMG_URL"

if [[ "$DIGEST" != "-" ]]; then
  ACTUAL="$(shasum -a 256 "$WORK/$APP_NAME.dmg" | awk '{print $1}')"
  [[ "$ACTUAL" == "$DIGEST" ]] || fail "Download is corrupted or was tampered with (SHA-256 mismatch)."
  say "Checksum verified"
fi

say "Installing to /Applications"
MOUNT="$(hdiutil attach "$WORK/$APP_NAME.dmg" -nobrowse -readonly | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
[[ -d "$MOUNT/$APP_NAME.app" ]] || fail "The disk image doesn't contain $APP_NAME.app."

if [[ "$DEST_DIR" == "/Applications" ]] && pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  sleep 2
fi
rm -rf "$DEST"
ditto "$MOUNT/$APP_NAME.app" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

if [[ "$DEST_DIR" == "/Applications" ]]; then
  say "Opening WhisperWoof"
  open "$DEST"
fi

cat <<EOF

WhisperWoof $TAG is installed. It lives in the menu bar (no Dock icon).
Grant Microphone and Accessibility when macOS asks. If you're updating, open
System Settings → Privacy & Security → Accessibility, remove WhisperWoof (−)
and add it back (+): each unsigned build counts as a new app to macOS.
EOF
