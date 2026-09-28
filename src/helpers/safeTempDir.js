const os = require("os");
const fs = require("fs");
const path = require("path");

let cachedSafeTempDir = null;

// Returns a safe temp directory for native binaries on Windows.
// Falls back to ProgramData when TEMP contains spaces or non-ASCII characters,
// as many native binaries (whisper-server, ffmpeg) don't handle these paths correctly.
function getSafeTempDir() {
  if (cachedSafeTempDir) return cachedSafeTempDir;

  const systemTemp = os.tmpdir();

  // On non-Windows platforms, use system temp directly
  // On Windows, check for problematic characters: non-ASCII or spaces
  const hasProblematicChars = !/^[\x21-\x7E]*$/.test(systemTemp);
  if (process.platform !== "win32" || !hasProblematicChars) {
    cachedSafeTempDir = systemTemp;
    return systemTemp;
  }

  const fallbackBase = process.env.ProgramData || "C:\\ProgramData";
  const fallback = path.join(fallbackBase, "OpenWhispr", "temp");

  try {
    fs.mkdirSync(fallback, { recursive: true });
    cachedSafeTempDir = fallback;
    return fallback;
  } catch {
    const rootFallback = path.join(process.env.SystemDrive || "C:", "OpenWhispr", "temp");
    try {
      fs.mkdirSync(rootFallback, { recursive: true });
      cachedSafeTempDir = rootFallback;
      return rootFallback;
    } catch {
      cachedSafeTempDir = systemTemp;
      return systemTemp;
    }
  }
}

// A fresh directory only this user can enter (mkdtemp: unique name, 0700),
// for transient audio and downloads. Predictable names in a shared /tmp let
// another local user pre-create or symlink the path, or read the file.
function makePrivateTempDir(prefix) {
  return fs.mkdtempSync(path.join(getSafeTempDir(), prefix));
}

function removeTempDir(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort: a leftover private dir is swept with the temp folder
  }
}

module.exports = { getSafeTempDir, makePrivateTempDir, removeTempDir };
