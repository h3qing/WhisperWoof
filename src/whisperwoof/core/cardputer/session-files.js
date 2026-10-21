/**
 * Reading a Cardputer recordings folder (untrusted): which session folders
 * exist, their manifest.json, their segment files and the PCM inside them.
 * Never follows a symlink: folders and files are lstat'ed, files are opened
 * with O_NOFOLLOW, and every session folder must resolve inside the root.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  HEADER_BYTES,
  MAX_MANIFEST_BYTES,
  checkSegment,
} = require("../../bridge/cardputer-inbox-pure");

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_DIR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_SESSIONS = 10_000;
const READ_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;

async function lstatOrNull(file) {
  try {
    return await fs.promises.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

const isRealDir = (stat) => Boolean(stat && stat.isDirectory() && !stat.isSymbolicLink());

async function childDirs(dir, pattern) {
  const names = await fs.promises.readdir(dir).catch(() => []);
  const picked = [];
  for (const name of names.filter((n) => pattern.test(n)).sort()) {
    if (isRealDir(await lstatOrNull(path.join(dir, name)))) picked.push(path.join(dir, name));
  }
  return picked;
}

/** Session folders under <root>/<YYYY-MM-DD>/, real directories inside the root only. */
async function listSessionDirs(root) {
  let realRoot;
  try {
    realRoot = await fs.promises.realpath(root);
  } catch {
    return [];
  }
  const sessions = [];
  for (const dateDir of await childDirs(realRoot, DATE_DIR)) {
    for (const dir of await childDirs(dateDir, SESSION_DIR)) {
      const real = await fs.promises.realpath(dir).catch(() => null);
      if (real === dir && real.startsWith(realRoot + path.sep)) sessions.push(dir);
      if (sessions.length >= MAX_SESSIONS) return sessions;
    }
  }
  return sessions;
}

async function readSmallFile(file, maxBytes) {
  const handle = await fs.promises.open(file, READ_FLAGS);
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) return null;
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * → { state: "done" } (result.json exists) | { state: "none" } (no manifest yet)
 *   | { state: "ignore" } (symlink, too big, unreadable) | { state: "manifest", data }.
 */
async function readManifest(dir) {
  if (await lstatOrNull(path.join(dir, "result.json"))) return { state: "done" };
  const file = path.join(dir, "manifest.json");
  const stat = await lstatOrNull(file);
  if (!stat) return { state: "none" };
  if (!stat.isFile() || stat.isSymbolicLink()) return { state: "ignore" };
  try {
    const bytes = await readSmallFile(file, MAX_MANIFEST_BYTES);
    if (!bytes) return { state: "ignore" };
    return { state: "manifest", data: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { state: "ignore" };
  }
}

async function readHeader(file) {
  const handle = await fs.promises.open(file, READ_FLAGS);
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Every segment file against the manifest. → { ok } | { ignore } | { code, problem } */
async function inspectSegments(dir, manifest) {
  for (const seg of manifest.segments) {
    const file = path.join(dir, seg.file);
    const lstat = await lstatOrNull(file);
    const stat = lstat && {
      isSymbolicLink: lstat.isSymbolicLink(),
      isFile: lstat.isFile(),
      size: lstat.size,
    };
    const header = stat && stat.isFile && !stat.isSymbolicLink ? await readHeader(file) : null;
    const verdict = checkSegment(seg, stat, header);
    if (verdict) return verdict;
  }
  return { ok: true };
}

async function sha256Of(file) {
  const handle = await fs.promises.open(file, READ_FLAGS);
  try {
    const hash = crypto.createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

/** Index of the first segment whose whole-file sha256 differs from the manifest, or -1. */
async function firstShaMismatch(dir, manifest) {
  for (const [k, seg] of manifest.segments.entries()) {
    if ((await sha256Of(path.join(dir, seg.file))) !== seg.sha256) return k;
  }
  return -1;
}

function audioError(message) {
  return Object.assign(new Error(message), { cardputerCode: "E_AUDIO" });
}

/** PCM of one run part ({ file, offset, length }) in chunks of at most `chunkBytes`. */
async function* readPart(dir, part, chunkBytes = 32_000) {
  const handle = await fs.promises.open(path.join(dir, part.file), READ_FLAGS);
  try {
    for (let done = 0; done < part.length; ) {
      const want = Math.min(chunkBytes, part.length - done);
      const buf = Buffer.alloc(want);
      const { bytesRead } = await handle.read(buf, 0, want, part.offset + done);
      if (bytesRead !== want) throw audioError("Segment shorter than its manifest says");
      done += bytesRead;
      yield buf;
    }
  } finally {
    await handle.close();
  }
}

module.exports = { listSessionDirs, readManifest, inspectSegments, firstShaMismatch, readPart };
