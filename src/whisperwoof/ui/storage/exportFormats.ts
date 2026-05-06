export type ExportFormat = "json" | "txt";

export interface ExportableEntry {
  id: string;
  createdAt?: string;
  source?: string;
  rawText?: string | null;
  polished?: string | null;
  routedTo?: string | null;
  hotkeyUsed?: string | null;
  durationMs?: number | null;
  projectId?: string | null;
  audioPath?: string | null;
  metadata?: unknown;
  favorite?: number;
}

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  json: "application/json",
  txt: "text/plain;charset=utf-8",
};

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  json: "json",
  txt: "txt",
};

export function formatEntriesAsJson(entries: ExportableEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function formatEntriesAsTxt(entries: ExportableEntry[]): string {
  if (entries.length === 0) return "";

  const blocks = entries.map(formatSingleEntryAsTxt);
  return blocks.join("\n\n----\n\n") + "\n";
}

function formatSingleEntryAsTxt(entry: ExportableEntry): string {
  const lines: string[] = [];
  const header: string[] = [];

  if (entry.createdAt) header.push(entry.createdAt);
  if (entry.source) header.push(`[${entry.source}]`);
  if (entry.hotkeyUsed) header.push(`(${entry.hotkeyUsed})`);
  if (header.length > 0) lines.push(header.join(" "));

  const polished = (entry.polished ?? "").trim();
  const raw = (entry.rawText ?? "").trim();

  if (polished && raw && polished !== raw) {
    lines.push("");
    lines.push("Polished:");
    lines.push(polished);
    lines.push("");
    lines.push("Raw:");
    lines.push(raw);
  } else if (polished) {
    lines.push("");
    lines.push(polished);
  } else if (raw) {
    lines.push("");
    lines.push(raw);
  }

  return lines.join("\n");
}

export function formatEntries(entries: ExportableEntry[], format: ExportFormat): string {
  return format === "json" ? formatEntriesAsJson(entries) : formatEntriesAsTxt(entries);
}

export function exportFilename(format: ExportFormat, date = new Date()): string {
  const datePart = date.toISOString().split("T")[0];
  return `whisperwoof-export-${datePart}.${EXPORT_EXTENSIONS[format]}`;
}
