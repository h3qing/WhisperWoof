/**
 * Words and small rules for the Clipboard view (pure, tested).
 */

export type ClipboardKind = "text" | "image";

export interface ClipboardItem {
  readonly id: string;
  readonly createdAt: string;
  readonly pinned: boolean;
  readonly kind: ClipboardKind;
  readonly text: string;
  readonly fileName: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly sourceApp: string | null;
}

export interface ClipboardRetention {
  readonly keepDays: number;
  readonly maxImageMB: number;
}

export interface ClipboardSummary {
  readonly textCount: number;
  readonly imageCount: number;
  readonly pinnedCount: number;
  readonly imageBytes: number;
  readonly retention: ClipboardRetention;
}

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

/** The sentence the view opens with: what's kept, and what it costs on disk. */
export function clipboardHeadline(s: ClipboardSummary): string {
  if (s.textCount === 0 && s.imageCount === 0) return "Nothing copied yet.";
  const parts = [plural(s.textCount, "text", "texts"), plural(s.imageCount, "image", "images")];
  const disk = s.imageCount > 0 ? ` Images take up ${formatBytes(s.imageBytes)}.` : "";
  return `${parts.join(" and ")} copied.${disk}`;
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

/** Caption under an image: its file name when it came from Finder, else its size. */
export function imageCaption(item: ClipboardItem): string {
  if (item.fileName) return item.fileName;
  return item.width && item.height ? `${item.width}×${item.height}` : "Image";
}

export type ClearChoice = "text" | "image" | "older" | "all";

/** What a Clear choice removes, in the confirmation's words (pinned items always stay). */
export function clearQuestion(choice: ClearChoice, s: ClipboardSummary): string {
  switch (choice) {
    case "text":
      return `Remove ${plural(s.textCount, "text", "texts")}?`;
    case "image":
      return `Remove ${plural(s.imageCount, "image", "images")} (${formatBytes(s.imageBytes)})?`;
    case "older":
      return "Remove everything copied more than a week ago?";
    default:
      return "Remove everything in your clipboard history?";
  }
}

export function clearOptions(choice: ClearChoice): { kind: "text" | "image" | "all"; olderThanDays: number } {
  if (choice === "older") return { kind: "all", olderThanDays: 7 };
  return { kind: choice, olderThanDays: 0 };
}
