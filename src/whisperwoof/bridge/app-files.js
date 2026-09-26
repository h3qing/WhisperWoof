/**
 * App-owned files, encryption-aware. The containment rules live in
 * app-file-paths-pure.js; this adds the vault: with encryption on, a file's
 * bytes live in "<path>.wwenc", so the check runs on the file actually on
 * disk and the logical path is returned for the vault-files API.
 */

const fs = require("fs");
const path = require("path");
const vaultFiles = require("./vault/vault-files");
const { resolveInsideDirs } = require("./app-file-paths-pure");

/** The logical path of `candidate` if it exists (plain or sealed) strictly inside one of `dirs`; else null. */
function resolveAppFile(candidate, dirs) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return null;
  const logical = path.resolve(candidate);
  const physical = vaultFiles.physicalPath(logical);
  if (!physical) return null;
  return resolveInsideDirs(physical, dirs, fs.realpathSync) ? logical : null;
}

module.exports = { resolveAppFile };
