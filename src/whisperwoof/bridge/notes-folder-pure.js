/**
 * Notes folder — pure rules for the .md files Fn+N writes (no fs, no electron).
 * The files are the source of truth; the Notes view reads and edits them in
 * place, so Obsidian / iCloud folders keep working.
 */

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const PREVIEW_MAX = 140;

/** A bare `*.md` file name inside the notes folder — never a path. */
function isSafeNoteName(name) {
  if (typeof name !== "string" || !name.endsWith(".md") || name.length <= 3) return false;
  if (name.startsWith(".")) return false;
  return !/[/\\]/.test(name) && !name.includes("..");
}

function frontmatterField(yaml, key) {
  const line = yaml.split("\n").find((l) => l.startsWith(`${key}:`));
  if (!line) return "";
  const raw = line.slice(key.length + 1).trim();
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }
  return raw;
}

/** { title, body, date } — title from frontmatter, else a heading, else the first line. */
function parseNote(content) {
  const text = String(content ?? "").replace(/\r\n/g, "\n");
  const fm = text.match(FRONTMATTER);
  const body = (fm ? text.slice(fm[0].length) : text).trim();
  const fmTitle = fm ? frontmatterField(fm[1], "title") : "";
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  const title = fmTitle || firstLine.replace(/^#+\s*/, "").trim();
  const date = fm ? frontmatterField(fm[1], "date") : "";
  return { title, body, date };
}

/** One line of body text for the list, without repeating the title. */
function previewOf({ title, body }) {
  const lines = String(body ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).filter(Boolean);
  const rest = lines[0] === title ? lines.slice(1) : lines;
  const flat = rest.join(" ");
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX)}…` : flat;
}

/** The file with its body replaced, frontmatter kept. */
function withBody(content, newBody) {
  const fm = String(content ?? "").replace(/\r\n/g, "\n").match(FRONTMATTER);
  const body = `${String(newBody ?? "").trim()}\n`;
  return fm ? `${fm[0].endsWith("\n") ? fm[0] : `${fm[0]}\n`}${body}` : body;
}

function matchesQuery(note, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return `${note.title}\n${note.body}`.toLowerCase().includes(q);
}

function sortNewestFirst(list) {
  return [...list].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

module.exports = { isSafeNoteName, parseNote, previewOf, withBody, matchesQuery, sortNewestFirst };
