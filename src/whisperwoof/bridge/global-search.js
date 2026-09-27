/**
 * Search everything (⌘K) — one query over what WhisperWoof keeps: the
 * history (dictations, meetings, imports), clipboard text, clipboard images
 * (file names and, with "Words in images" on, the words read from them) and
 * kept files. Substring matching (LIKE), so part of a Chinese sentence is
 * found (FTS5's default tokenizer treats a whole Chinese sentence as one
 * word). Newest first, a few per group, each with the words around the
 * match. Notes are searched in the renderer, from the list the Notes view
 * already loads.
 */

const { matchSnippet } = require("./clipboard-image-text-pure");

// Lazy: app-init requires modules that require this one.
const appInit = () => require("./app-init");
const clipboardStore = () => require("./clipboard-store");

const MAX_QUERY_CHARS = 200;
const SNIPPET_RADIUS = 48;
/** How many of each kind the palette shows before "Show all". */
const LIMITS = Object.freeze({ history: 6, clipboard: 5, images: 6, files: 3 });
const HISTORY_SOURCES = ["voice", "meeting", "import"];

const likePattern = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function normalizeQuery(query) {
  return String(query ?? "").trim().slice(0, MAX_QUERY_CHARS);
}

/**
 * History entries whose text contains `query`, newest first (mapped like the
 * History view's entries). `sources` limits which kinds (default: all).
 */
function searchEntries(db, query, { limit = 50, sources = null } = {}) {
  const q = normalizeQuery(query);
  if (!db || !q) return [];
  const where = ["(raw_text LIKE ? ESCAPE '\\' OR polished LIKE ? ESCAPE '\\')"];
  const params = [likePattern(q), likePattern(q)];
  if (Array.isArray(sources) && sources.length > 0) {
    where.push(`source IN (${sources.map(() => "?").join(",")})`);
    params.push(...sources);
  }
  return db
    .prepare(`SELECT * FROM bf_entries WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, Math.min(Math.max(Number(limit) || 50, 1), 500));
}

/** The words around the match: in the text shown, else in the raw transcript. */
function snippetOf(q, ...texts) {
  for (const text of texts) {
    const snippet = matchSnippet(text, q, SNIPPET_RADIUS);
    if (snippet) return snippet;
  }
  return null;
}

/** Up to `limit` items plus whether there are more (asks for one extra). */
function page(items, limit) {
  return { items: items.slice(0, limit), more: items.length > limit };
}

/**
 * Everything matching `query`, in groups: { query, history, clipboard,
 * images, files } (each { items, more }) and whether image words are searched.
 */
function searchEverything(query) {
  const q = normalizeQuery(query);
  const db = appInit().getWhisperWoofDb();
  const empty = { items: [], more: false };
  let imageText = { enabled: false, available: false };
  try {
    const status = require("./clipboard-image-text").getStatus();
    imageText = { enabled: status.enabled, available: status.available };
  } catch {
    // reader not loaded
  }
  if (!q || !db) return { query: q, history: empty, clipboard: empty, images: empty, files: empty, imageText };

  const history = searchEntries(db, q, { limit: LIMITS.history + 1, sources: HISTORY_SOURCES }).map((row) => {
    const entry = appInit().mapEntryRow(row);
    const text = entry.polished ?? entry.rawText ?? "";
    return { id: entry.id, source: entry.source, createdAt: entry.createdAt, text, snippet: snippetOf(q, text, entry.rawText), entry };
  });
  // One more than shown, so each group knows whether there's more.
  const found = clipboardStore().searchClipboard(q, {
    text: LIMITS.clipboard + 1,
    image: LIMITS.images + 1,
    file: LIMITS.files + 1,
  });
  const clipboard = found.text.map((item) => ({ ...item, snippet: snippetOf(q, item.text) }));

  return {
    query: q,
    history: page(history, LIMITS.history),
    clipboard: page(clipboard, LIMITS.clipboard),
    images: page(found.image, LIMITS.images),
    files: page(found.file, LIMITS.files),
    imageText,
  };
}

module.exports = { searchEverything, searchEntries, normalizeQuery, LIMITS };
