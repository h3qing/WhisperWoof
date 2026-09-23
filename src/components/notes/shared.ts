import { cn } from "../lib/utils";
import type { FolderItem } from "../../types/electron";

export const DEFAULT_FOLDER_NAME = "Personal";
export const MEETINGS_FOLDER_NAME = "Meetings";

export function findDefaultFolder(folders: FolderItem[]): FolderItem | undefined {
  return folders.find((f) => f.name === DEFAULT_FOLDER_NAME && f.is_default);
}

export const notesInputClass = cn(
  "w-full h-8 px-3 rounded-md text-xs",
  "bg-input border border-border",
  "text-foreground/80 placeholder:text-muted-foreground/70 outline-none",
  "focus:border-primary/30 transition-colors duration-150"
);

export const notesTextareaClass = cn(
  "w-full px-3 py-2 rounded-md text-xs leading-relaxed resize-none",
  "bg-input border border-border",
  "text-foreground/80 placeholder:text-muted-foreground/70 outline-none",
  "focus:border-primary/30 transition-colors duration-150"
);
