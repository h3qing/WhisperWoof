/**
 * Words and small rules for the Clipboard view (pure, tested).
 */

export type ClipboardKind = "text" | "image" | "file";

/** The words around a search match in an image's text. */
export interface TextMatch {
  readonly before: string;
  readonly match: string;
  readonly after: string;
}

export interface ClipboardItem {
  readonly id: string;
  readonly createdAt: string;
  readonly pinned: boolean;
  readonly kind: ClipboardKind;
  readonly text: string;
  readonly fileName: string | null;
  readonly width: number | null;
  readonly height: number | null;
  /** Size on disk of a kept file. */
  readonly bytes?: number | null;
  readonly sourceApp: string | null;
  /** In search results: an image found by the words in it. */
  readonly textMatch?: TextMatch | null;
}

export interface ClipboardRetention {
  readonly keepDays: number;
  readonly maxImageMB: number;
}

export interface ClipboardCapture {
  readonly keepFiles: boolean;
}

export type ImageTextState = "off" | "unavailable" | "reading" | "paused" | "done";
export type ImageTextPause = "locked" | "meeting" | "dictating" | "hot" | "busy" | "battery";

/** How reading the words in images is going (bridge/clipboard-image-text.js). */
export interface ImageTextStatus {
  readonly enabled: boolean;
  readonly available: boolean;
  /** Encryption is on, so the words are stored encrypted. */
  readonly encrypted: boolean;
  readonly state: ImageTextState;
  readonly reason?: ImageTextPause | null;
  /** Images in the history, images read so far, and how many of those had words. */
  readonly total: number;
  readonly read: number;
  readonly withText: number;
}

/** What was read from one image. */
export interface ImageTextResult {
  readonly status: "unread" | "done" | "failed";
  readonly text: string;
}

export interface ClipboardSummary {
  readonly textCount: number;
  readonly imageCount: number;
  readonly fileCount?: number;
  readonly pinnedCount: number;
  readonly imageBytes: number;
  readonly fileBytes?: number;
  readonly retention: ClipboardRetention;
  readonly capture?: ClipboardCapture;
  readonly imageText?: ImageTextStatus;
}

/** Shown before copied files are kept: what it means for the disk. */
export const KEEP_FILES_WARNING =
  "Keep PDFs, documents and other files you copy? Each is saved in full, up to 100 MB, so files can take up a lot of space. They count towards the space limit, oldest removed first.";

export const KEEP_DAYS_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Forever" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

export const IMAGE_CAP_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "No limit" },
  { value: 200, label: "200 MB" },
  { value: 500, label: "500 MB" },
  { value: 1024, label: "1 GB" },
  { value: 2048, label: "2 GB" },
];

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * MB) return `${n < 10 * MB ? (n / MB).toFixed(1) : Math.round(n / MB)} MB`;
  return `${(n / (1024 * MB)).toFixed(1)} GB`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function joinWords(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The sentence the view opens with: what's kept, and what it costs on disk. */
export function clipboardHeadline(s: ClipboardSummary): string {
  const files = s.fileCount ?? 0;
  if (s.textCount === 0 && s.imageCount === 0 && files === 0) return "Nothing copied yet.";
  const parts = [plural(s.textCount, "text", "texts"), plural(s.imageCount, "image", "images")];
  if (files > 0) parts.push(plural(files, "file", "files"));
  const bytes = s.imageBytes + (s.fileBytes ?? 0);
  const what = files > 0 ? (s.imageCount > 0 ? "Images and files take" : files === 1 ? "The file takes" : "Files take") : "Images take";
  const disk = s.imageCount > 0 || files > 0 ? ` ${what} up ${formatBytes(bytes)}.` : "";
  return `${joinWords(parts)} copied.${disk}`;
}

/** How long ago, the way a person says it. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  const d = new Date(then);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `${hours} h ago`;
  const yesterday = new Date(now - 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "PDF", "DOCX"… for a kept file's badge. */
export function fileBadge(fileName: string | null): string {
  const dot = (fileName ?? "").lastIndexOf(".");
  const ext = dot > 0 ? (fileName ?? "").slice(dot + 1) : "";
  return ext && ext.length <= 5 ? ext.toUpperCase() : "FILE";
}

/** Caption under an image: its file name when it came from Finder, else its size. */
export function imageCaption(item: ClipboardItem): string {
  if (item.fileName) return item.fileName;
  return item.width && item.height ? `${item.width}×${item.height}` : "Image";
}

export type ClearChoice = "text" | "image" | "file" | "older" | "all";

/** What a Clear choice removes, in the confirmation's words (pinned items always stay). */
export function clearQuestion(choice: ClearChoice, s: ClipboardSummary): string {
  switch (choice) {
    case "text":
      return `Remove ${plural(s.textCount, "text", "texts")}?`;
    case "image":
      return `Remove ${plural(s.imageCount, "image", "images")} (${formatBytes(s.imageBytes)})?`;
    case "file":
      return `Remove ${plural(s.fileCount ?? 0, "file", "files")} (${formatBytes(s.fileBytes ?? 0)})?`;
    case "older":
      return "Remove everything copied more than a week ago?";
    default:
      return "Remove everything in your clipboard history?";
  }
}

export function clearOptions(choice: ClearChoice): { kind: "text" | "image" | "file" | "all"; olderThanDays: number } {
  if (choice === "older") return { kind: "all", olderThanDays: 7 };
  return { kind: choice, olderThanDays: 0 };
}

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Asked before the words in images are read: why, how, what it costs, and
 * what it means for privacy. Nothing is read until the user says yes.
 */
export function imageTextConsent({ imageCount, encrypted }: { imageCount: number; encrypted: boolean }): {
  readonly question: string;
  readonly points: readonly string[];
  readonly confirm: string;
} {
  return {
    question: "Read the words in your images so search can find them?",
    points: [
      "Then searching finds a screenshot by what it says: a message, an error, a receipt.",
      "macOS\u2019s own text recognition reads them, on this Mac. Nothing is uploaded or downloaded.",
      imageCount > 0
        ? `New images are read a few seconds after you copy them. Your ${plural(imageCount, "older image", "older images")} ${imageCount === 1 ? "is" : "are"} read in the background, newest first, only while your Mac is plugged in.`
        : "New images are read a few seconds after you copy them.",
      "It runs at low priority and waits while you dictate or record a meeting, and while your Mac is busy or hot.",
      encrypted
        ? "The words are kept with your clipboard history and encrypted like it. Anything written in a screenshot, a password too, becomes text search can find."
        : "The words are kept with your clipboard history as plain text, like the text you copy (Settings \u2192 Encryption locks it). Anything written in a screenshot, a password too, becomes text search can find.",
      "Turn it off any time: reading stops and the words are deleted. Your images stay.",
    ],
    confirm: "Read words in images",
  };
}

/** Asked before turning it off, because the words already read are deleted. */
export function imageTextOffQuestion(s: Pick<ImageTextStatus, "read">): string {
  return s.read > 0
    ? `Stop reading words in images? The words read from ${plural(s.read, "image", "images")} are deleted. Your images stay.`
    : "Stop reading words in images?";
}

const PAUSE_WORDS: Record<ImageTextPause, string> = {
  locked: "Paused while WhisperWoof is locked.",
  meeting: "Paused while a meeting records.",
  dictating: "Paused while you dictate.",
  hot: "Paused while your Mac cools down.",
  busy: "Paused while your Mac is busy.",
  battery: "The rest are read when your Mac is plugged in.",
};

/** The line under the toolbar while reading is on: progress, why it waits, or what it found. */
export function imageTextLine(s: ImageTextStatus): string | null {
  if (!s.enabled || s.state === "off") return null;
  if (s.state === "unavailable") return "Words in images can\u2019t be read on this computer.";
  if (s.total === 0) return "Images you copy are read for words a few seconds later.";
  if (s.state === "done" || s.read >= s.total) {
    return `Words found in ${count(s.withText)} of ${plural(s.total, "image", "images")}. Search finds them.`;
  }
  const progress = `Reading the words in your images: ${count(s.read)} of ${count(s.total)} done.`;
  return s.state === "paused" && s.reason ? `${progress} ${PAUSE_WORDS[s.reason]}` : progress;
}
