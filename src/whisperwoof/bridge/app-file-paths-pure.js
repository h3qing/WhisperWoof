/**
 * App file paths — pure containment rules for files the app owns (no electron).
 *
 * The renderer and bf_entries rows hand the main process file paths. Only
 * files that really live inside an app folder may be read for the renderer
 * or deleted: an import's audio_path is the user's ORIGINAL file, and a
 * compromised renderer could name any path. `realpath` is injected
 * (fs.realpathSync in production) so symlinks are followed before the check.
 */

const path = require("path");

/** Folders under userData whose files the app itself wrote. */
const APP_FILE_FOLDERS = ["whisperwoof-images", "audio"];

function appFileDirs(userDataDir) {
  return APP_FILE_FOLDERS.map((name) => path.join(userDataDir, name));
}

function isStrictlyInside(dir, target) {
  const rel = path.relative(dir, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function tryRealpath(realpath, p) {
  try {
    return realpath(p);
  } catch {
    return null;
  }
}

/**
 * The real path of `candidate` when it exists strictly inside one of `dirs`,
 * both as written and after resolving symlinks; otherwise null. Relative
 * paths, `..` escapes and symlinks leading out of the folder are rejected.
 */
function resolveInsideDirs(candidate, dirs, realpath) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return null;
  const lexical = path.resolve(candidate);
  const real = tryRealpath(realpath, lexical);
  if (!real) return null;
  const inside = dirs.some((dir) => {
    const realDir = tryRealpath(realpath, dir);
    return realDir !== null && isStrictlyInside(path.resolve(dir), lexical) && isStrictlyInside(realDir, real);
  });
  return inside ? real : null;
}

module.exports = { appFileDirs, resolveInsideDirs };
