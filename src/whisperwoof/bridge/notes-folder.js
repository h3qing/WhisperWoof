/**
 * Notes folder — fs side of the Notes view. Lists, reads, edits, trashes and
 * reveals the .md files in the notes folder (the one Fn+N writes to), and
 * watches it so a new voice note shows up while the view is open.
 * Every name coming from the renderer goes through isSafeNoteName.
 */

const fs = require("fs");
const path = require("path");
const { shell } = require("electron");
const { getNotesDirectory } = require("./markdown-route");
const pure = require("./notes-folder-pure");
const vault = require("./vault/vault-service");
const vaultFiles = require("./vault/vault-files");

const MAX_NOTES = 500;
const MAX_NOTE_BYTES = 512 * 1024;
// A sealed note is a little bigger than its text (header + 20 bytes per 64 KiB).
const SEALED_OVERHEAD = 4096;

function notePath(name) {
  if (!pure.isSafeNoteName(name)) throw new Error("Invalid note name");
  const dir = getNotesDirectory();
  const file = path.join(dir, name);
  // A *.md symlink inside the folder must not lead outside it.
  const physical = vaultFiles.physicalPath(file);
  if (physical) {
    const real = fs.realpathSync(physical);
    if (path.dirname(real) !== fs.realpathSync(dir)) throw new Error("Invalid note name");
  }
  return file;
}

function listNotes() {
  const dir = getNotesDirectory();
  if (!fs.existsSync(dir)) return { dir, notes: [] };
  const entries = vaultFiles
    .listNames(dir)
    .filter(pure.isSafeNoteName)
    .map((name) => {
      // Broken symlinks, or files iCloud/Obsidian replace mid-scan, are skipped.
      try {
        return { name, stat: vaultFiles.statFile(path.join(dir, name)) };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.stat && entry.stat.isFile() && entry.stat.size <= MAX_NOTE_BYTES + SEALED_OVERHEAD);
  const newest = pure
    .sortNewestFirst(entries.map(({ name, stat }) => ({ name, mtimeMs: stat.mtimeMs })))
    .slice(0, MAX_NOTES);
  const notes = newest.flatMap(({ name, mtimeMs }) => {
    try {
      const note = pure.parseNote(vaultFiles.readText(path.join(dir, name)));
      return [{ ...note, name, title: note.title || name.replace(/\.md$/, ""), mtimeMs }];
    } catch {
      return [];
    }
  });
  return { dir, notes };
}

function readNote(name) {
  return vaultFiles.readText(notePath(name));
}

function writeNote(file, text) {
  vaultFiles.writeText(file, text, { kind: "note", seal: vault.sealsNotes() });
}

/** Replace the body, keeping the file's frontmatter. */
function updateNoteBody(name, body) {
  const file = notePath(name);
  const next = pure.withBody(vaultFiles.readText(file), body);
  writeNote(file, next);
  return pure.parseNote(next);
}

/** Set (string) or remove (null) frontmatter fields; returns the parsed note. */
function setNoteFields(name, fields) {
  const file = notePath(name);
  const next = pure.withFields(vaultFiles.readText(file), fields);
  writeNote(file, next);
  return pure.parseNote(next);
}

async function trashNote(name) {
  const file = notePath(name);
  await shell.trashItem(vaultFiles.physicalPath(file) || file);
}

function revealNote(name) {
  const file = notePath(name);
  shell.showItemInFolder(vaultFiles.physicalPath(file) || file);
}

function openNotesFolder() {
  const dir = getNotesDirectory();
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
}

/** Calls onChange (debounced) when files in the notes folder change. */
function watchNotesFolder(onChange) {
  const dir = getNotesDirectory();
  fs.mkdirSync(dir, { recursive: true });
  let timer = null;
  const watcher = fs.watch(dir, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  });
  // e.g. the folder's drive was unmounted: stop watching rather than throw.
  watcher.on("error", () => watcher.close());
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

module.exports = { listNotes, readNote, updateNoteBody, setNoteFields, trashNote, revealNote, openNotesFolder, watchNotesFolder };
