import { Check, ChevronDown, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../../components/ui/dropdown-menu";
import type { FolderItem } from "../../../types/electron";

/**
 * The Meetings tab's folder: a capsule naming the folder the list shows, with
 * every folder one click away (Meetings, Personal, uploads, the user's own).
 * The folder being shown can be renamed or deleted from here unless it's one
 * of the built-in ones.
 */
export function FolderFilter({
  folders,
  counts,
  activeFolderId,
  onSelect,
  onNewFolder,
  onRename,
  onDelete,
}: {
  folders: FolderItem[];
  counts: Record<number, number>;
  activeFolderId: number | null;
  onSelect: (folderId: number) => void;
  onNewFolder: () => void;
  onRename: (folder: FolderItem) => void;
  onDelete: (folder: FolderItem) => void;
}) {
  const active = folders.find((f) => f.id === activeFolderId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="press flex items-center gap-2 h-8 max-w-full pl-3 pr-2 rounded-full border border-border bg-card text-[13px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderOpen size={14} className="shrink-0 text-primary" />
          <span className="truncate">{active?.name ?? "Folders"}</span>
          {active && (
            <span className="font-medium text-faint tabular-nums">{counts[active.id] || 0}</span>
          )}
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-56">
        {folders.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onSelect={() => onSelect(folder.id)}
            className="gap-2 text-[13px]"
          >
            <Check
              size={14}
              className={folder.id === activeFolderId ? "text-primary" : "invisible"}
            />
            <span className="flex-1 truncate">{folder.name}</span>
            <span className="text-xs text-faint tabular-nums">{counts[folder.id] || ""}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewFolder} className="gap-2 text-[13px]">
          <Plus size={14} className="text-muted-foreground" />
          New folder
        </DropdownMenuItem>
        {active && !active.is_default && (
          <>
            <DropdownMenuItem onSelect={() => onRename(active)} className="gap-2 text-[13px]">
              <Pencil size={14} className="text-muted-foreground" />
              Rename “{active.name}”
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDelete(active)}
              className="gap-2 text-[13px] text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <Trash2 size={14} />
              Delete “{active.name}”
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
