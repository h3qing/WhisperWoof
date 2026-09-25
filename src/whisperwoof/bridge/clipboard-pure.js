/**
 * Clipboard history — pure rules (no fs, no electron), shared by the capture
 * loop (app-init.js) and the store behind the Clipboard view
 * (clipboard-store.js).
 */

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".bmp",
]);

/** At most this many files are kept from one Finder copy. */
const MAX_FILES_PER_COPY = 10;
/** Photos copied in Finder are kept up to this size; bigger ones keep only their name. */
const MAX_PHOTO_FILE_MB = 50;
/** Other files (PDFs, documents…) are kept only when the user turns it on, up to this size. */
const MAX_KEPT_FILE_MB = 100;
/** Files are opt-in: they're kept in full and can take a lot of space. */
const DEFAULT_CAPTURE = Object.freeze({ keepFiles: false });

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

/** "Keep history for" choices in days; 0 keeps everything. */
const KEEP_DAYS_OPTIONS = [0, 7, 30, 90];
/** "Images can use up to" choices in MB; 0 means no limit. */
const IMAGE_CAP_OPTIONS_MB = [0, 200, 500, 1024, 2048];
/** Defaults never delete text; images stop at 1 GB, oldest first. */
const DEFAULT_RETENTION = Object.freeze({ keepDays: 0, maxImageMB: 1024 });

function extensionOf(filePath) {
  const base = String(filePath ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(extensionOf(filePath));
}

/** `file:///Users/me/My%20Photo.jpg` → `/Users/me/My Photo.jpg`; null for anything else. */
function fileUrlToPath(url) {
  const raw = String(url ?? "").replace(/\0/g, "").trim();
  if (!raw.startsWith("file://")) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "file:") return null;
    const decoded = decodeURIComponent(parsed.pathname);
    return decoded || null;
  } catch {
    return null;
  }
}

/** Paths from macOS's `NSFilenamesPboardType` property list (every file in one Finder copy). */
function parseFilenamesPlist(xml) {
  const out = [];
  const re = /<string>([\s\S]*?)<\/string>/g;
  let match;
  while ((match = re.exec(String(xml ?? ""))) !== null) {
    const value = match[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .trim();
    if (value.startsWith("/")) out.push(value);
  }
  return out;
}

/** Entry metadata arrives as a JSON string from the database; tolerate objects and junk. */
function parseMetadata(metadata) {
  if (metadata && typeof metadata === "object") return metadata;
  if (typeof metadata !== "string" || !metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isImageMetadata(metadata) {
  return parseMetadata(metadata).type === "image";
}

function normalizeCapture(raw) {
  return { keepFiles: Boolean(raw && typeof raw === "object" && raw.keepFiles === true) };
}

/**
 * What a Finder copy keeps. `copied`: [{ path, size }]. Photos become images
 * (up to MAX_PHOTO_FILE_MB); other files are kept only with `keepFiles` on
 * (up to MAX_KEPT_FILE_MB); anything else is skipped and stays a name in
 * text. At most MAX_FILES_PER_COPY are kept.
 */
function planCopiedFiles(copied, capture) {
  const plan = { images: [], files: [], skipped: [] };
  for (const { path: filePath, size } of copied) {
    const kept = plan.images.length + plan.files.length;
    if (kept >= MAX_FILES_PER_COPY) {
      plan.skipped.push(filePath);
    } else if (isImageFile(filePath)) {
      (size <= MAX_PHOTO_FILE_MB * MB ? plan.images : plan.skipped).push(filePath);
    } else if (capture.keepFiles && size <= MAX_KEPT_FILE_MB * MB) {
      plan.files.push(filePath);
    } else {
      plan.skipped.push(filePath);
    }
  }
  return plan;
}

function isFileMetadata(metadata) {
  return parseMetadata(metadata).type === "file";
}

function normalizeRetention(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const keepDays = KEEP_DAYS_OPTIONS.includes(r.keepDays) ? r.keepDays : DEFAULT_RETENTION.keepDays;
  const maxImageMB = IMAGE_CAP_OPTIONS_MB.includes(r.maxImageMB)
    ? r.maxImageMB
    : DEFAULT_RETENTION.maxImageMB;
  return { keepDays, maxImageMB };
}

/**
 * Which clipboard entries retention removes. `entries`: { id, createdAt,
 * favorite, isImage, isFile, bytes }. Pinned (favorite) entries are never
 * removed. First anything older than `keepDays`; then, while images and kept
 * files use more than `maxImageMB`, the oldest unpinned of them. Pinned ones
 * still count towards the space, so they are kept by giving up older ones.
 */
function pickPruneIds(entries, { now, keepDays, maxImageMB }) {
  const doomed = new Set();
  if (keepDays > 0) {
    const cutoff = now - keepDays * DAY_MS;
    for (const e of entries) {
      if (!e.favorite && Date.parse(e.createdAt) < cutoff) doomed.add(e.id);
    }
  }
  if (maxImageMB > 0) {
    const cap = maxImageMB * MB;
    const images = entries.filter((e) => (e.isImage || e.isFile) && !doomed.has(e.id));
    let used = images.filter((e) => e.favorite).reduce((sum, e) => sum + (e.bytes || 0), 0);
    const newestFirst = images
      .filter((e) => !e.favorite)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    for (const e of newestFirst) {
      if (used + (e.bytes || 0) > cap) doomed.add(e.id);
      else used += e.bytes || 0;
    }
  }
  return [...doomed];
}

const kindOfEntry = (e) => (e.isImage ? "image" : e.isFile ? "file" : "text");

/** Ids a "Clear" action removes: one kind (or all), optionally only older ones; pinned stay. */
function pickClearIds(entries, { kind = "all", olderThanDays = 0, now }) {
  const cutoff = olderThanDays > 0 ? now - olderThanDays * DAY_MS : Infinity;
  return entries
    .filter((e) => !e.favorite)
    .filter((e) => kind === "all" || kindOfEntry(e) === kind)
    .filter((e) => Date.parse(e.createdAt) < cutoff)
    .map((e) => e.id);
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * MB) return `${n < 10 * MB ? (n / MB).toFixed(1) : Math.round(n / MB)} MB`;
  return `${(n / (1024 * MB)).toFixed(1)} GB`;
}

/** Stored text for an image entry: dimensions, plus the file name when it came from Finder. */
function imageEntryText({ width, height, fileName }) {
  const size = `[Image ${width}×${height}]`;
  return fileName ? `${size} ${fileName}` : size;
}

/** Stored text for a kept file (what search matches). */
function fileEntryText(fileName) {
  return `[File] ${fileName}`;
}

/** Markdown body of a note made from a kept file: a link to its copy in attachments/. */
function fileNoteBody(fileName, attachment) {
  return `[${fileName.replace(/[[\]]/g, "")}](${encodeURI(attachment)})`;
}

/** Markdown body of a note made from a clipboard image (attachment path relative to the note). */
function imageNoteBody(attachment) {
  return `![Clipboard image](${attachment})`;
}

/** File name for an attachment in the notes folder: a stable stem plus the image's extension. */
function attachmentFileName(stem, ext) {
  const safeStem = String(stem).replace(/[^\w.-]+/g, "-");
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : ".png";
  return `${safeStem}${safeExt}`;
}

/** Image attachments a note shows: `![…](attachments/x.png)` only, never paths out of the folder. */
function noteImageRefs(body) {
  const refs = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = re.exec(String(body ?? ""))) !== null) {
    let ref;
    try {
      ref = decodeURIComponent(match[1]);
    } catch {
      continue; // a malformed %-escape
    }
    if (isSafeAttachmentRef(ref) && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

function isSafeAttachmentRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("attachments/")) return false;
  const name = ref.slice("attachments/".length);
  return name.length > 0 && !/[/\\]/.test(name) && !name.startsWith(".") && isImageFile(name);
}

module.exports = {
  IMAGE_EXTENSIONS,
  MAX_FILES_PER_COPY,
  MAX_PHOTO_FILE_MB,
  MAX_KEPT_FILE_MB,
  DEFAULT_CAPTURE,
  normalizeCapture,
  planCopiedFiles,
  isFileMetadata,
  fileEntryText,
  fileNoteBody,
  KEEP_DAYS_OPTIONS,
  IMAGE_CAP_OPTIONS_MB,
  DEFAULT_RETENTION,
  extensionOf,
  isImageFile,
  fileUrlToPath,
  parseFilenamesPlist,
  parseMetadata,
  isImageMetadata,
  normalizeRetention,
  pickPruneIds,
  pickClearIds,
  formatBytes,
  imageEntryText,
  imageNoteBody,
  attachmentFileName,
  noteImageRefs,
  isSafeAttachmentRef,
};
