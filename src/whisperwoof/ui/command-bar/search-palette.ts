/**
 * ⌘K — search everything. The pure parts (tested): which results the palette
 * lists for a query and in what order, how each one reads, and what Enter
 * (and ⌘Enter) does with it. The search itself runs in the main process
 * (bridge/global-search.js) except notes, which are filtered here from the
 * lists the Notes views already load.
 */

import type { Entry } from "../../core/storage/types";
import { imageCaption, relativeTime, type ClipboardItem, type TextMatch } from "../smart-clipboard/clipboard-view";

export type { TextMatch };

export interface SearchGroup<T> {
  readonly items: readonly T[];
  readonly more: boolean;
}

export interface HistoryHit {
  readonly id: string;
  readonly source: string;
  readonly createdAt: string;
  readonly text: string;
  readonly snippet: TextMatch | null;
  readonly entry: Entry;
}

export type ClipboardHit = ClipboardItem & { readonly snippet?: TextMatch | null };

/** What `whisperwoof-search-everything` answers. */
export interface EverythingResults {
  readonly query: string;
  readonly history: SearchGroup<HistoryHit>;
  readonly clipboard: SearchGroup<ClipboardHit>;
  readonly images: SearchGroup<ClipboardItem>;
  readonly files: SearchGroup<ClipboardItem>;
  readonly imageText: { readonly enabled: boolean; readonly available: boolean };
}

/** A WhisperWoof note (Markdown file in the notes folder). */
export interface NoteDoc {
  readonly name: string;
  readonly title: string;
  readonly body: string;
  readonly mtimeMs: number;
}

/** A meeting or imported-audio note (the notes database). */
export interface MeetingNoteDoc {
  readonly id: number;
  readonly title: string;
  readonly content: string;
  readonly note_type?: string;
  readonly updated_at: string;
}

export type ShowAllView = "history" | "clipboard";

export type PaletteAction =
  | { readonly kind: "open-history"; readonly entry: Entry }
  | { readonly kind: "open-note"; readonly name: string }
  | { readonly kind: "open-meeting-note"; readonly id: number }
  | { readonly kind: "copy"; readonly id: string; readonly what: "text" | "image" | "file" }
  | { readonly kind: "show-all"; readonly view: ShowAllView; readonly query: string };

export type RowIcon = "dictation" | "meeting" | "import" | "note" | "meeting-note" | "text" | "image" | "file" | "more";

export interface PaletteRow {
  readonly key: string;
  readonly icon: RowIcon;
  readonly title: string;
  /** The words around the match. */
  readonly match: TextMatch | null;
  /**
   * The title is the found text itself (a dictation, copied text): show the
   * match in its place. Otherwise (a note, an image) the match goes under it.
   */
  readonly matchIsTitle?: boolean;
  readonly meta: string;
  /** A clipboard image's id, for its thumbnail. */
  readonly imageId?: string;
  /** Enter. */
  readonly action: PaletteAction;
  /** ⌘Enter, when it differs (clipboard items: show them in Clipboard). */
  readonly alt?: PaletteAction;
}

export interface PaletteSection {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly PaletteRow[];
}

/** Typing "/" first turns search into the command bar (/note, /project…). */
export function isCommandInput(input: string): boolean {
  return input.trimStart().startsWith("/");
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const flat = (s: string) => s.replace(/\s+/g, " ");

/** The words around the first match of `query` (any case), or null. Same rules as the main process. */
export function snippetAround(text: string, query: string, radius = 48): TextMatch | null {
  const t = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!t || !q) return null;
  const lower = t.toLowerCase();
  const at = lower.length === t.length ? lower.indexOf(q.toLowerCase()) : t.indexOf(q);
  if (at < 0) return null;
  let start = Math.max(0, at - radius);
  let end = Math.min(t.length, at + q.length + radius);
  if (start > 0 && isLowSurrogate(t.charCodeAt(start))) start -= 1;
  if (end < t.length && isHighSurrogate(t.charCodeAt(end - 1))) end += 1;
  return {
    before: `${start > 0 ? "…" : ""}${flat(t.slice(start, at)).trimStart()}`,
    match: flat(t.slice(at, at + q.length)),
    after: `${flat(t.slice(at + q.length, end)).trimEnd()}${end < t.length ? "…" : ""}`,
  };
}

const contains = (text: string, q: string) => text.toLowerCase().includes(q.toLowerCase());

export interface DocHit<T> {
  readonly doc: T;
  readonly match: TextMatch | null;
}

/** Notes whose title or text contains the query, in the order given (newest first). */
export function searchNoteDocs(notes: readonly NoteDoc[], query: string, limit = 5): SearchGroup<DocHit<NoteDoc>> {
  const q = query.trim();
  if (!q) return { items: [], more: false };
  const hits = notes
    .filter((n) => contains(n.title, q) || contains(n.body, q))
    .map((doc) => ({ doc, match: contains(doc.title, q) ? null : snippetAround(doc.body, q) }));
  return { items: hits.slice(0, limit), more: hits.length > limit };
}

export function searchMeetingNotes(
  notes: readonly MeetingNoteDoc[],
  query: string,
  limit = 4
): SearchGroup<DocHit<MeetingNoteDoc>> {
  const q = query.trim();
  if (!q) return { items: [], more: false };
  const hits = notes
    .filter((n) => contains(n.title ?? "", q) || contains(n.content ?? "", q))
    .map((doc) => ({ doc, match: contains(doc.title ?? "", q) ? null : snippetAround(doc.content ?? "", q) }));
  return { items: hits.slice(0, limit), more: hits.length > limit };
}

const SOURCE_WORDS: Record<string, { label: string; icon: RowIcon }> = {
  voice: { label: "Dictation", icon: "dictation" },
  meeting: { label: "Meeting", icon: "meeting" },
  import: { label: "Imported audio", icon: "import" },
};

const joinMeta = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ");
const firstLine = (text: string) => flat(text).trim();

/** SQLite's "2026-09-27 10:00:00" (UTC) or ISO → ISO, for relativeTime. */
function isoOf(date: string): string {
  return /^\d{4}-\d{2}-\d{2} \d/.test(date) ? `${date.replace(" ", "T")}Z` : date;
}

function showAllRow(view: ShowAllView, query: string, label: string): PaletteRow {
  return {
    key: `more:${view}`,
    icon: "more",
    title: label,
    match: null,
    meta: "",
    action: { kind: "show-all", view, query },
  };
}

/**
 * The palette's sections for a query, in order: History, Notes, Meeting
 * notes, Clipboard, Images (and files). Empty sections are left out; a
 * section with more results ends in "Show all in …".
 */
export function buildSections({
  query,
  results,
  notes = { items: [], more: false },
  meetingNotes = { items: [], more: false },
  now = Date.now(),
}: {
  readonly query: string;
  readonly results: EverythingResults | null;
  readonly notes?: SearchGroup<DocHit<NoteDoc>>;
  readonly meetingNotes?: SearchGroup<DocHit<MeetingNoteDoc>>;
  readonly now?: number;
}): PaletteSection[] {
  const q = query.trim();
  if (!q) return [];
  const sections: PaletteSection[] = [];
  const r = results && results.query === q ? results : null;

  if (r && r.history.items.length > 0) {
    const rows: PaletteRow[] = r.history.items.map((hit) => {
      const words = SOURCE_WORDS[hit.source] ?? SOURCE_WORDS.voice;
      return {
        key: `history:${hit.id}`,
        icon: words.icon,
        title: firstLine(hit.text),
        match: hit.snippet,
        matchIsTitle: true,
        meta: joinMeta(words.label, relativeTime(hit.createdAt, now)),
        action: { kind: "open-history", entry: hit.entry },
      };
    });
    if (r.history.more) rows.push(showAllRow("history", q, "Show all in History"));
    sections.push({ key: "history", title: "History", rows });
  }

  if (notes.items.length > 0) {
    sections.push({
      key: "notes",
      title: "Notes",
      rows: notes.items.map(({ doc, match }) => ({
        key: `note:${doc.name}`,
        icon: "note" as const,
        title: doc.title || doc.name.replace(/\.md$/, ""),
        match,
        meta: relativeTime(new Date(doc.mtimeMs).toISOString(), now),
        action: { kind: "open-note" as const, name: doc.name },
      })),
    });
  }

  if (meetingNotes.items.length > 0) {
    sections.push({
      key: "meeting-notes",
      title: "Meeting notes",
      rows: meetingNotes.items.map(({ doc, match }) => ({
        key: `meeting-note:${doc.id}`,
        icon: "meeting-note" as const,
        title: doc.title || "Untitled",
        match,
        meta: joinMeta(doc.note_type === "upload" ? "Imported audio" : "Meeting", relativeTime(isoOf(doc.updated_at), now)),
        action: { kind: "open-meeting-note" as const, id: doc.id },
      })),
    });
  }

  const showInClipboard: PaletteAction = { kind: "show-all", view: "clipboard", query: q };

  if (r && r.clipboard.items.length > 0) {
    const rows: PaletteRow[] = r.clipboard.items.map((item) => ({
      key: `clipboard:${item.id}`,
      icon: "text",
      title: firstLine(item.text),
      match: item.snippet ?? null,
      matchIsTitle: true,
      meta: joinMeta("Copied text", item.sourceApp, relativeTime(item.createdAt, now)),
      action: { kind: "copy", id: item.id, what: "text" },
      alt: showInClipboard,
    }));
    if (r.clipboard.more) rows.push(showAllRow("clipboard", q, "Show all in Clipboard"));
    sections.push({ key: "clipboard", title: "Clipboard", rows });
  }

  if (r && (r.images.items.length > 0 || r.files.items.length > 0)) {
    const rows: PaletteRow[] = [
      ...r.images.items.map((item) => ({
        key: `image:${item.id}`,
        icon: "image" as const,
        title: imageCaption(item),
        match: item.textMatch ?? null,
        meta: joinMeta(item.textMatch ? "Words in image" : "Image", item.sourceApp, relativeTime(item.createdAt, now)),
        imageId: item.id,
        action: { kind: "copy" as const, id: item.id, what: "image" as const },
        alt: showInClipboard,
      })),
      ...r.files.items.map((item) => ({
        key: `file:${item.id}`,
        icon: "file" as const,
        title: item.fileName ?? "File",
        match: null,
        meta: joinMeta("File", item.sourceApp, relativeTime(item.createdAt, now)),
        action: { kind: "copy" as const, id: item.id, what: "file" as const },
        alt: showInClipboard,
      })),
    ];
    if (r.images.more || r.files.more) rows.push(showAllRow("clipboard", q, "Show all in Clipboard"));
    sections.push({ key: "images", title: r.files.items.length > 0 ? "Images and files" : "Images", rows });
  }

  return sections;
}

export function flattenRows(sections: readonly PaletteSection[]): PaletteRow[] {
  return sections.flatMap((s) => s.rows);
}

/** Arrow keys: move within the list, stopping at both ends. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** Under the box before anything is typed. */
export function paletteHint(imageText: { enabled: boolean } | null): string {
  return imageText?.enabled
    ? "Search your history, notes, clipboard and the words in your images."
    : "Search your history, notes and clipboard.";
}

/** When nothing matches: say so, and where else it could look. */
export function noResultsLine(query: string, imageText: { enabled: boolean; available: boolean } | null): string {
  const none = `Nothing matches “${query.trim()}”.`;
  return imageText && imageText.available && !imageText.enabled
    ? `${none} To search the words in screenshots too, turn on Words in images in Clipboard.`
    : none;
}

/** What the result's Enter does, for the footer. */
export function enterLabel(row: PaletteRow | null): string {
  if (!row) return "Open";
  if (row.action.kind === "copy") return row.action.what === "image" ? "Copy image" : row.action.what === "file" ? "Copy file" : "Copy";
  return "Open";
}
