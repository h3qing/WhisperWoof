/**
 * Audio files the user picked or dropped (their own files, anywhere on disk).
 *
 * The renderer names the file, so main checks it is what it claims before
 * reading it: a regular file with an audio extension once symlinks are
 * resolved. `voice.mp3 -> ~/.ssh/id_rsa` or a plain `~/.ssh/id_rsa` is
 * refused, so a compromised page can't turn "transcribe this file" into
 * "upload this file". Same formats as file-import.js and the file dialogs.
 */

const fs = require("fs");
const path = require("path");

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac", ".aac"]);

/** The file's real path, or null when it isn't an audio file the user could have picked. */
function resolveUserAudioFile(filePath, { realpath = fs.realpathSync, stat = fs.statSync } = {}) {
  if (typeof filePath !== "string" || filePath.includes("\0") || !path.isAbsolute(filePath)) {
    return null;
  }
  let real;
  try {
    real = realpath(filePath);
    if (!stat(real).isFile()) return null;
  } catch {
    return null;
  }
  return AUDIO_EXTENSIONS.has(path.extname(real).toLowerCase()) ? real : null;
}

module.exports = { AUDIO_EXTENSIONS, resolveUserAudioFile };
