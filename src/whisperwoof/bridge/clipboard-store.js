/**
 * Clipboard history store — what the Clipboard view does with captured items:
 * list text and images, copy one back to the system clipboard, save it as a
 * note, pin or remove it, and keep the history within the retention the user
 * chose. Captures themselves are written by the monitor in app-init.js.
 *
 * File paths never leave the main process: the view asks for a preview or a
 * copy by entry id.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { clipboard, nativeImage, BrowserWindow, shell } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const pure = require("./clipboard-pure");
const imageTextPure = require("./clipboard-image-text-pure");
const imageTextDb = require("./clipboard-image-text-db");
const vault = require("./vault/vault-service");
const vaultFiles = require("./vault/vault-files");

/** An image from a stored path; sealed images are decrypted in memory. */
function loadImage(filePath) {
  if (!filePath || !vaultFiles.exists(filePath)) return null;
  const physical = vaultFiles.physicalPath(filePath);
  return physical === filePath
    ? nativeImage.createFromPath(filePath)
    : nativeImage.createFromBuffer(vaultFiles.readFile(filePath));
}

/**
 * A kept file to paste back as a file. A sealed one is decrypted into the
 * vault's private temp folder (emptied on lock and at startup) for 10 minutes,
 * long enough to paste it somewhere.
 */
function pasteablePath(filePath) {
  if (vaultFiles.physicalPath(filePath) === filePath) return filePath;
  const crypto = require("crypto");
  const { vaultPaths, ensurePrivateDir, writeFileAtomic } = require("./vault/vault-paths");
  const dir = ensurePrivateDir(path.join(vaultPaths.tmpDir(), crypto.randomUUID()));
  const target = path.join(dir, path.basename(filePath));
  writeFileAtomic(target, vaultFiles.readFile(filePath));
  setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 10 * 60 * 1000).unref?.();
  return target;
}

// Lazy: app-init requires this module too.
const db = () => require("./app-init").getWhisperWoofDb();

const KIND_WHERE = {
  image: `metadata LIKE '%"type":"image"%'`,
  file: `metadata LIKE '%"type":"file"%'`,
  text: `(metadata IS NULL OR (metadata NOT LIKE '%"type":"image"%' AND metadata NOT LIKE '%"type":"file"%'))`,
};
const PREVIEW_WIDTH = 480;
const LARGE_PREVIEW_WIDTH = 1600;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
// Formats the Notes view (Chromium) and most Markdown apps can't show.
const CONVERT_FOR_NOTES = new Set([".heic", ".heif", ".tif", ".tiff", ".bmp"]);

function notifyChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("whisperwoof-clipboard-changed");
  }
}

function clipboardRow(id) {
  const row = db()?.prepare("SELECT * FROM bf_entries WHERE id = ?").get(id);
  return row && row.source === "clipboard" ? row : null;
}

function kindOf(meta) {
  return meta.type === "image" ? "image" : meta.type === "file" ? "file" : "text";
}

function toItem(row) {
  const meta = pure.parseMetadata(row.metadata);
  const kind = kindOf(meta);
  return {
    id: row.id,
    createdAt: row.created_at,
    pinned: Boolean(row.favorite),
    kind,
    text: kind === "text" ? (row.polished ?? row.raw_text ?? "") : "",
    fileName: meta.fileName ?? null,
    width: meta.width ?? null,
    height: meta.height ?? null,
    bytes: typeof meta.bytes === "number" ? meta.bytes : null,
    sourceApp: meta.sourceApp?.name ?? null,
  };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * One column of the view: text or images, pinned first, then newest. A
 * search also finds images by the words read from them; those results carry
 * the words around the match (`textMatch`).
 */
function listClipboard({ kind = "text", limit = 60, offset = 0, query = "" } = {}) {
  if (!db()) return [];
  const where = ["source = 'clipboard'", KIND_WHERE[kind] ?? KIND_WHERE.text];
  const params = [];
  const q = String(query ?? "").trim();
  const searchImageText = Boolean(q) && kind === "image";
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const match = ["raw_text LIKE ? ESCAPE '\\'", "polished LIKE ? ESCAPE '\\'"];
    params.push(like, like);
    if (searchImageText) {
      match.push(imageTextDb.TEXT_MATCH_SQL);
      params.push(like);
    }
    where.push(`(${match.join(" OR ")})`);
  }
  const rows = db()
    .prepare(
      `SELECT * FROM bf_entries WHERE ${where.join(" AND ")}
       ORDER BY favorite DESC, created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, Math.min(Number(limit) || 60, 200), Math.max(Number(offset) || 0, 0));
  const items = rows.map(toItem);
  if (!searchImageText || items.length === 0) return items;
  const texts = imageTextDb.textsFor(db(), items.map((item) => item.id));
  return items.map((item) => {
    const textMatch = texts.has(item.id) ? imageTextPure.matchSnippet(texts.get(item.id), q) : null;
    return textMatch ? { ...item, textMatch } : item;
  });
}

/**
 * ⌘K: text, images and files matching `query`. Each kind pinned first, then
 * newest, at most `limits[kind]`; images found by their words carry
 * `textMatch`. → { text, image, file }
 *
 * One pass over the history ranks the matches of every kind at once, about
 * twice as fast as a query per kind for a real search (74k entries: ~25–40
 * ms vs ~50–85). A one-character search matches nearly everything, and there
 * the per-kind queries, which stop sorting at their limit, win.
 */
function searchClipboard(query, limits) {
  const q = String(query ?? "").trim();
  const found = { text: [], image: [], file: [] };
  if (!db() || !q) return found;
  if (q.length < 2) {
    for (const kind of Object.keys(found)) found[kind] = listClipboard({ kind, query: q, limit: limits[kind] });
    return found;
  }
  const like = `%${escapeLike(q)}%`;
  // Rank only ids (narrow rows sort fast), then read the few that are shown.
  const ranked = db()
    .prepare(
      `SELECT id, kind FROM (
         SELECT id, kind, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY favorite DESC, created_at DESC) AS rank_in_kind
         FROM (
           SELECT id, favorite, created_at,
                  CASE WHEN ${KIND_WHERE.image} THEN 'image' WHEN ${KIND_WHERE.file} THEN 'file' ELSE 'text' END AS kind
           FROM bf_entries
           WHERE source = 'clipboard'
             AND (raw_text LIKE ? ESCAPE '\\' OR polished LIKE ? ESCAPE '\\' OR ${imageTextDb.TEXT_MATCH_SQL})
         )
       )
       WHERE rank_in_kind <= CASE kind WHEN 'image' THEN ? WHEN 'file' THEN ? ELSE ? END
       ORDER BY kind, rank_in_kind`
    )
    .all(like, like, like, limits.image, limits.file, limits.text);
  const get = db().prepare("SELECT * FROM bf_entries WHERE id = ?");
  const rows = ranked.map(({ id, kind }) => ({ ...get.get(id), kind }));
  for (const row of rows) found[row.kind].push(toItem(row));
  if (found.image.length > 0) {
    const texts = imageTextDb.textsFor(db(), found.image.map((item) => item.id));
    found.image = found.image.map((item) => {
      const textMatch = texts.has(item.id) ? imageTextPure.matchSnippet(texts.get(item.id), q) : null;
      return textMatch ? { ...item, textMatch } : item;
    });
  }
  return found;
}

function fileSize(filePath) {
  try {
    return filePath ? vaultFiles.statFile(filePath)?.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

/** Every clipboard entry in the shape the retention rules take. */
function retentionRows() {
  if (!db()) return [];
  return db()
    .prepare("SELECT id, created_at, favorite, audio_path, metadata FROM bf_entries WHERE source = 'clipboard'")
    .all()
    .map((row) => {
      const meta = pure.parseMetadata(row.metadata);
      const isImage = meta.type === "image";
      const isFile = meta.type === "file";
      const bytes =
        isImage || isFile
          ? typeof meta.bytes === "number"
            ? meta.bytes
            : fileSize(row.audio_path) + fileSize(meta.thumbPath)
          : 0;
      return { id: row.id, createdAt: row.created_at, favorite: row.favorite ? 1 : 0, isImage, isFile, bytes };
    });
}

function getRetention() {
  const { readSettings } = require("./markdown-route");
  return pure.normalizeRetention(readSettings().clipboardRetention);
}

function getCapture() {
  const { readSettings } = require("./markdown-route");
  return pure.normalizeCapture(readSettings().clipboardCapture);
}

/** Whether copied files (PDFs, documents…) are kept in full. Off by default. */
function setCapture(raw) {
  const { updateSettings } = require("./markdown-route");
  const keepFiles = Boolean(raw && typeof raw === "object" && raw.keepFiles === true);
  const capture = pure.normalizeCapture({ ...getCapture(), keepFiles });
  updateSettings({ clipboardCapture: capture });
  notifyChanged();
  return { capture };
}

/**
 * Turn clipboard monitoring on or off, now and after every restart. Saved in
 * main: a setting only the renderer remembered came back on at launch.
 */
function setMonitoring(enabled) {
  const { updateSettings } = require("./markdown-route");
  const appInit = require("./app-init");
  const capture = pure.normalizeCapture({ ...getCapture(), monitor: enabled === true });
  updateSettings({ clipboardCapture: capture });
  if (capture.monitor) appInit.startClipboardMonitor();
  else appInit.stopClipboardMonitor();
  notifyChanged();
  return { enabled: capture.monitor };
}

function summary() {
  const rows = retentionRows();
  const images = rows.filter((r) => r.isImage);
  const files = rows.filter((r) => r.isFile);
  return {
    textCount: rows.length - images.length - files.length,
    imageCount: images.length,
    fileCount: files.length,
    pinnedCount: rows.filter((r) => r.favorite).length,
    imageBytes: images.reduce((sum, r) => sum + r.bytes, 0),
    fileBytes: files.reduce((sum, r) => sum + r.bytes, 0),
    retention: getRetention(),
    capture: getCapture(),
    imageText: imageTextReader().getStatus(),
  };
}

const imageTextReader = () => require("./clipboard-image-text");

/** Read the words in images (on) or stop and delete them (off). */
function setImageText(raw) {
  const result = imageTextReader().setEnabled(raw);
  notifyChanged();
  return result;
}

/** The words read from one image: { status: unread | done | failed, text }. */
function imageText(id) {
  const row = clipboardRow(id);
  if (!row) return { success: false, error: "Not a clipboard item" };
  if (!pure.isImageMetadata(row.metadata)) return { success: false, error: "Not an image" };
  return imageTextDb.imageTextFor(db(), id);
}

/** Put an image's words on the clipboard as text (not added to history: the image already finds them). */
function copyImageText(id) {
  const found = imageText(id);
  if (found.success === false) return found;
  if (!found.text) return { success: false, error: "No words found in this image" };
  clipboard.writeText(found.text);
  require("./app-init").adoptCurrentClipboard();
  return { success: true };
}

/** Delete rows and what they stored on disk (image + preview, or a kept file's folder). */
function deleteIds(ids) {
  if (ids.length === 0) return { deleted: 0 };
  const { removeClipboardFiles } = require("./app-init");
  const get = db().prepare("SELECT id, source, audio_path, metadata FROM bf_entries WHERE id = ?");
  const del = db().prepare("DELETE FROM bf_entries WHERE id = ?");
  const removed = [];
  db().transaction(() => {
    for (const id of ids) {
      const row = get.get(id);
      if (!row) continue;
      del.run(id);
      removed.push(row);
    }
  })();
  for (const row of removed) removeClipboardFiles(row);
  // The deleted text must not linger in the WAL's old page images.
  if (removed.length > 0) require("./db-erase").checkpoint(db());
  notifyChanged();
  return { deleted: removed.length };
}

/** Remove specific items (clipboard entries only). */
function removeItems(ids) {
  const own = (Array.isArray(ids) ? ids : []).filter((id) => clipboardRow(id));
  return deleteIds(own);
}

/** "Clear…": all text, all images or everything, optionally only older items. Pinned stay. */
function clearItems({ kind = "all", olderThanDays = 0 } = {}) {
  return deleteIds(pure.pickClearIds(retentionRows(), { kind, olderThanDays, now: Date.now() }));
}

/** Apply the retention the user chose. Runs at startup, after image captures and on change. */
function prune() {
  const retention = getRetention();
  const ids = pure.pickPruneIds(retentionRows(), { now: Date.now(), ...retention });
  if (ids.length > 0) {
    debugLogger.log(`[WhisperWoof] Clipboard retention removed ${ids.length} item(s)`);
    return deleteIds(ids);
  }
  return { deleted: 0 };
}

function setRetention(raw) {
  const { updateSettings } = require("./markdown-route");
  const retention = pure.normalizeRetention(raw);
  updateSettings({ clipboardRetention: retention });
  const { deleted } = prune();
  return { retention, deleted };
}

function setPinned(id, pinned) {
  if (!clipboardRow(id)) return { success: false, error: "Not a clipboard item" };
  db().prepare("UPDATE bf_entries SET favorite = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  notifyChanged();
  return { success: true, pinned: Boolean(pinned) };
}

/**
 * Put an item back on the system clipboard: text as text, images as the
 * image itself (so it pastes into chats and documents, not as a file name).
 * It moves to the top of its list instead of being captured again.
 */
function copyItem(id) {
  const row = clipboardRow(id);
  if (!row) return { success: false, error: "Not a clipboard item" };
  const meta = pure.parseMetadata(row.metadata);
  if (meta.type === "image") {
    const image = loadImage(row.audio_path);
    if (!image || image.isEmpty()) return { success: false, error: "The image file is missing" };
    clipboard.writeImage(image);
  } else if (meta.type === "file") {
    if (!row.audio_path || !vaultFiles.exists(row.audio_path)) return { success: false, error: "The file is missing" };
    const filePath = pasteablePath(row.audio_path);
    // As a file (Finder, Mail and chat apps paste it as an attachment); its path elsewhere.
    if (process.platform === "darwin") {
      clipboard.writeBuffer("public.file-url", Buffer.from(pathToFileURL(filePath).href));
    } else {
      clipboard.writeText(filePath);
    }
  } else {
    const text = row.polished ?? row.raw_text ?? "";
    if (!text) return { success: false, error: "Nothing to copy" };
    clipboard.writeText(text);
  }
  require("./app-init").adoptCurrentClipboard();
  db().prepare("UPDATE bf_entries SET created_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  notifyChanged();
  return { success: true, kind: kindOf(meta) };
}

/** Show a kept image or file in Finder. */
function reveal(id) {
  const row = clipboardRow(id);
  if (!row?.audio_path || !vaultFiles.exists(row.audio_path)) return { success: false, error: "The file is missing" };
  shell.showItemInFolder(vaultFiles.physicalPath(row.audio_path));
  return { success: true };
}

/**
 * A preview for the image grid (the stored thumbnail, or one made from the
 * image), or with `size: "large"` one big enough to look at closely.
 */
function preview(id, { size = "thumb" } = {}) {
  const row = clipboardRow(id);
  if (!row) return { success: false, error: "Not a clipboard item" };
  const meta = pure.parseMetadata(row.metadata);
  if (meta.type !== "image") return { success: false, error: "Not an image" };
  const maxWidth = size === "large" ? LARGE_PREVIEW_WIDTH : PREVIEW_WIDTH;
  try {
    if (size !== "large" && meta.thumbPath && vaultFiles.exists(meta.thumbPath)) {
      const mime = MIME[pure.extensionOf(meta.thumbPath)] ?? "image/png";
      return { success: true, mime, data: vaultFiles.readFile(meta.thumbPath).toString("base64") };
    }
    const image = loadImage(row.audio_path);
    if (!image || image.isEmpty()) return { success: false, error: "The image file is missing" };
    const { width } = image.getSize();
    const scaled = width > maxWidth ? image.resize({ width: maxWidth }) : image;
    return { success: true, mime: "image/png", data: scaled.toPNG().toString("base64") };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(dir, fileName);
  for (let n = 1; vaultFiles.exists(candidate); n++) candidate = path.join(dir, `${stem}-${n}${ext}`);
  return candidate;
}

function timestampStem(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `clip-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Save an item as a note in the notes folder: text as the note's body; an
 * image as an attachment in `attachments/` that the note links to (Obsidian
 * and the Notes view both show it).
 */
function saveToNote(id) {
  const row = clipboardRow(id);
  if (!row) return { success: false, error: "Not a clipboard item" };
  const { saveAsMarkdown, getNotesDirectory } = require("./markdown-route");
  const meta = pure.parseMetadata(row.metadata);
  if (meta.type === "file") {
    try {
      if (!row.audio_path || !vaultFiles.exists(row.audio_path)) return { success: false, error: "The file is missing" };
      const attachDir = path.join(getNotesDirectory(), "attachments");
      fs.mkdirSync(attachDir, { recursive: true });
      const target = uniquePath(attachDir, path.basename(row.audio_path));
      // Attachments are sealed exactly when notes are.
      vaultFiles.writeFile(target, vaultFiles.readFile(row.audio_path), { kind: "attachment", seal: vault.sealsNotes() });
      const name = meta.fileName || path.basename(target);
      return saveAsMarkdown(pure.fileNoteBody(name, `attachments/${path.basename(target)}`), {
        source: "clipboard",
        title: name,
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  if (meta.type !== "image") {
    return saveAsMarkdown(row.polished ?? row.raw_text ?? "", { source: "clipboard" });
  }
  try {
    const source = row.audio_path;
    if (!source || !vaultFiles.exists(source)) return { success: false, error: "The image file is missing" };
    const attachDir = path.join(getNotesDirectory(), "attachments");
    fs.mkdirSync(attachDir, { recursive: true });
    const ext = pure.extensionOf(source) || ".png";
    const convert = CONVERT_FOR_NOTES.has(ext);
    const target = uniquePath(attachDir, pure.attachmentFileName(timestampStem(), convert ? ".png" : ext));
    const seal = vault.sealsNotes();
    if (convert) {
      const image = loadImage(source);
      if (!image || image.isEmpty()) return { success: false, error: "The image couldn't be read" };
      vaultFiles.writeFile(target, image.toPNG(), { kind: "attachment", seal });
    } else {
      vaultFiles.writeFile(target, vaultFiles.readFile(source), { kind: "attachment", seal });
    }
    const title = meta.fileName || `Image ${meta.width ?? "?"}×${meta.height ?? "?"}`;
    return saveAsMarkdown(pure.imageNoteBody(`attachments/${path.basename(target)}`), {
      source: "clipboard",
      title,
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  listClipboard,
  searchClipboard,
  summary,
  getRetention,
  setRetention,
  getCapture,
  setCapture,
  setMonitoring,
  setImageText,
  imageText,
  copyImageText,
  reveal,
  prune,
  removeItems,
  clearItems,
  setPinned,
  copyItem,
  preview,
  saveToNote,
  notifyChanged,
};
