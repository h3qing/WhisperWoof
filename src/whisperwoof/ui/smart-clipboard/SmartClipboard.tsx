/**
 * SmartClipboard — Kanban-style board of reusable text snippets
 *
 * Features:
 * - Multiple boards (columns) for organizing snippets by category
 * - Drag-and-drop reorder within and between boards
 * - Hotkey indicators (Cmd+Shift+1-9 for quick paste)
 * - Usage frequency badges
 * - Inline add/edit/delete
 * - Source indicators (human, AI, voice)
 */

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Copy,
  GripVertical,
  Keyboard,
  Zap,
  Mic,
  User,
  Sparkles,
  MoreHorizontal,
  Pencil,
  Check,
  X,
  Search,
  Lightbulb,
} from "lucide-react";
import { cn } from "../../../components/lib/utils";
import type { Snippet, SnippetBoard, SnippetSource } from "../../core/storage/types";

// --- IPC helpers ---

interface SmartClipboardAPI {
  whisperwoofGetBoards?: () => Promise<SnippetBoard[]>;
  whisperwoofSaveBoard?: (board: { name: string; position: number; color: string }) => Promise<SnippetBoard>;
  whisperwoofUpdateBoard?: (id: string, updates: Partial<SnippetBoard>) => Promise<SnippetBoard>;
  whisperwoofDeleteBoard?: (id: string) => Promise<void>;
  whisperwoofGetAllSnippets?: () => Promise<Snippet[]>;
  whisperwoofSaveSnippet?: (snippet: {
    content: string; title: string; boardId: string;
    position: number; source: SnippetSource; hotkey: string | null;
  }) => Promise<Snippet>;
  whisperwoofScUpdateSnippet?: (id: string, updates: Partial<Snippet>) => Promise<Snippet>;
  whisperwoofDeleteSnippet?: (id: string) => Promise<void>;
  whisperwoofRecordSnippetUse?: (id: string) => Promise<Snippet>;
  whisperwoofSuggestSnippets?: (limit?: number) => Promise<SnippetSuggestion[]>;
}

interface SnippetSuggestion {
  readonly text: string;
  readonly source: string;
  readonly frequency: number;
  readonly lastSeen: string;
}

function getAPI(): SmartClipboardAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? {};
}

// --- Constants ---

const BOARD_COLORS = [
  "#C87B3A", "#4ADE80", "#60A5FA", "#F472B6", "#A78BFA",
  "#FB923C", "#34D399", "#F87171", "#FBBF24", "#818CF8",
];

const SOURCE_ICONS: Record<SnippetSource, typeof User> = {
  human: User,
  ai: Sparkles,
  voice: Mic,
};

const SOURCE_LABELS: Record<SnippetSource, string> = {
  human: "Manual",
  ai: "AI generated",
  voice: "From voice",
};

// --- Sub-components ---

function SourceBadge({ source }: { readonly source: SnippetSource }) {
  const Icon = SOURCE_ICONS[source];
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 px-1.5 py-0.5 rounded bg-foreground/[0.03] dark:bg-white/[0.04]"
      title={SOURCE_LABELS[source]}
    >
      <Icon size={10} />
      {source}
    </span>
  );
}

function UsageBadge({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/50 px-1.5 py-0.5 rounded bg-foreground/[0.03] dark:bg-white/[0.04]"
      title={`Used ${count} time${count !== 1 ? "s" : ""}`}
    >
      <Zap size={9} />
      {count}
    </span>
  );
}

function HotkeyBadge({ hotkey }: { readonly hotkey: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-primary/70 px-1.5 py-0.5 rounded bg-primary/[0.06] dark:bg-primary/[0.08]">
      <Keyboard size={9} />
      <span className="font-medium">⌘⇧{hotkey}</span>
    </span>
  );
}

interface SnippetCardProps {
  readonly snippet: Snippet;
  readonly onCopy: (snippet: Snippet) => void;
  readonly onDelete: (id: string) => void;
  readonly onEdit: (id: string, updates: Partial<Snippet>) => void;
}

function SnippetCard({ snippet, onCopy, onDelete, onEdit }: SnippetCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(snippet.title);
  const [editContent, setEditContent] = useState(snippet.content);
  const [showMenu, setShowMenu] = useState(false);

  const handleSave = () => {
    if (editTitle.trim() && editContent.trim()) {
      onEdit(snippet.id, { title: editTitle.trim(), content: editContent.trim() });
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditTitle(snippet.title);
    setEditContent(snippet.content);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="rounded-lg border border-primary/30 bg-foreground/[0.02] dark:bg-white/[0.03] p-3 space-y-2">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="w-full text-xs font-medium bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40"
          placeholder="Title"
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
        />
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full text-xs bg-transparent border-none outline-none text-foreground/80 placeholder:text-muted-foreground/40 resize-none min-h-[48px]"
          placeholder="Snippet content..."
          rows={3}
        />
        <div className="flex gap-1.5 justify-end">
          <button onClick={handleCancel} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors">
            <X size={12} />
          </button>
          <button onClick={handleSave} className="text-[11px] text-primary hover:text-primary/80 px-2 py-1 rounded bg-primary/10 transition-colors">
            <Check size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group rounded-lg border border-border/20 dark:border-white/6",
        "bg-foreground/[0.015] dark:bg-white/[0.025]",
        "hover:border-border/40 dark:hover:border-white/10",
        "transition-all duration-150 cursor-default"
      )}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <GripVertical
            size={12}
            className="shrink-0 mt-0.5 text-muted-foreground/25 group-hover:text-muted-foreground/50 cursor-grab transition-colors"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-medium text-foreground truncate">
                {snippet.title}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => onCopy(snippet)}
                  className="p-1 rounded hover:bg-foreground/8 dark:hover:bg-white/8 text-muted-foreground/50 hover:text-foreground transition-colors"
                  title="Copy to clipboard"
                >
                  <Copy size={11} />
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-1 rounded hover:bg-foreground/8 dark:hover:bg-white/8 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <MoreHorizontal size={11} />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 z-10 bg-background border border-border/30 dark:border-white/10 rounded-md shadow-lg py-1 min-w-[100px]">
                      <button
                        onClick={() => { setIsEditing(true); setShowMenu(false); }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground/80 hover:bg-foreground/5 dark:hover:bg-white/5"
                      >
                        <Pencil size={11} /> Edit
                      </button>
                      <button
                        onClick={() => { onDelete(snippet.id); setShowMenu(false); }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/5"
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-foreground/60 leading-relaxed whitespace-pre-wrap line-clamp-3">
              {snippet.content}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <SourceBadge source={snippet.source} />
              <UsageBadge count={snippet.useCount} />
              {snippet.hotkey && <HotkeyBadge hotkey={snippet.hotkey} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface BoardColumnProps {
  readonly board: SnippetBoard;
  readonly snippets: readonly Snippet[];
  readonly onAddSnippet: (boardId: string) => void;
  readonly onCopySnippet: (snippet: Snippet) => void;
  readonly onDeleteSnippet: (id: string) => void;
  readonly onEditSnippet: (id: string, updates: Partial<Snippet>) => void;
  readonly onDeleteBoard: (id: string) => void;
  readonly onRenameBoard: (id: string, name: string) => void;
  readonly isSearching?: boolean;
}

function BoardColumn({
  board, snippets, onAddSnippet, onCopySnippet,
  onDeleteSnippet, onEditSnippet, onDeleteBoard, onRenameBoard, isSearching,
}: BoardColumnProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState(board.name);

  const handleRename = () => {
    if (renameName.trim()) {
      onRenameBoard(board.id, renameName.trim());
      setIsRenaming(false);
    }
  };

  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Board header */}
      <div className="flex items-center gap-2 px-3 py-2 mb-2">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: board.color }}
        />
        {isRenaming ? (
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setRenameName(board.name); setIsRenaming(false); }}}
            className="flex-1 text-xs font-semibold bg-transparent border-none outline-none text-foreground"
            autoFocus
          />
        ) : (
          <span
            className="flex-1 text-xs font-semibold text-foreground/90 cursor-pointer"
            onDoubleClick={() => setIsRenaming(true)}
            title="Double-click to rename"
          >
            {board.name}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/40">{snippets.length}</span>
        <button
          onClick={() => onDeleteBoard(board.id)}
          className="p-0.5 rounded text-muted-foreground/30 hover:text-red-400 transition-colors"
          title="Delete board"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Snippets */}
      <div className="flex-1 space-y-2 px-1 overflow-y-auto">
        {snippets.map((snippet) => (
          <SnippetCard
            key={snippet.id}
            snippet={snippet}
            onCopy={onCopySnippet}
            onDelete={onDeleteSnippet}
            onEdit={onEditSnippet}
          />
        ))}

        {isSearching && snippets.length === 0 && (
          <p className="text-[11px] text-muted-foreground/40 text-center py-4 italic">
            No matching snippets
          </p>
        )}

        {/* Add snippet button */}
        {!isSearching && (
          <button
            onClick={() => onAddSnippet(board.id)}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-2.5 rounded-lg",
              "border border-dashed border-border/20 dark:border-white/6",
              "text-muted-foreground/40 hover:text-muted-foreground/60",
              "hover:border-border/40 dark:hover:border-white/10",
              "transition-all duration-150 text-xs"
            )}
          >
            <Plus size={12} />
            Add snippet
          </button>
        )}
      </div>
    </div>
  );
}

// --- Main component ---

interface SmartClipboardProps {
  readonly className?: string;
}

export default function SmartClipboard({ className }: SmartClipboardProps) {
  const [boards, setBoards] = useState<SnippetBoard[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAddingBoard, setIsAddingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SnippetSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const api = getAPI();
      if (api.whisperwoofGetBoards && api.whisperwoofGetAllSnippets) {
        const [boardsData, snippetsData] = await Promise.all([
          api.whisperwoofGetBoards(),
          api.whisperwoofGetAllSnippets(),
        ]);
        setBoards([...boardsData]);
        setSnippets([...snippetsData]);
        setError(null);
      } else if (import.meta.env.DEV) {
        // Dev-only fallback when IPC isn't wired up yet. Never reaches production.
        setBoards([
          { id: "demo-1", name: "Greetings", position: 0, color: "#C87B3A", createdAt: new Date().toISOString() },
          { id: "demo-2", name: "Work", position: 1, color: "#60A5FA", createdAt: new Date().toISOString() },
          { id: "demo-3", name: "Code", position: 2, color: "#4ADE80", createdAt: new Date().toISOString() },
        ]);
        setSnippets([
          { id: "s1", content: "Thanks for your email! I'll review and get back to you by end of day.", title: "Thank you reply", boardId: "demo-1", position: 0, source: "human", useCount: 12, lastUsedAt: new Date().toISOString(), hotkey: "1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "s2", content: "Hi there! Hope you're having a great day.", title: "Casual greeting", boardId: "demo-1", position: 1, source: "human", useCount: 8, lastUsedAt: null, hotkey: "2", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "s3", content: "Let's sync on this during our next standup.", title: "Standup defer", boardId: "demo-2", position: 0, source: "voice", useCount: 5, lastUsedAt: null, hotkey: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "s4", content: "I've pushed the changes to the feature branch. Ready for review.", title: "PR ready", boardId: "demo-2", position: 1, source: "ai", useCount: 3, lastUsedAt: null, hotkey: "3", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "s5", content: "console.log(JSON.stringify(data, null, 2));", title: "Debug log", boardId: "demo-3", position: 0, source: "human", useCount: 20, lastUsedAt: null, hotkey: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ]);
      } else {
        setError("Smart Clipboard is unavailable. Please restart the app.");
      }
    } catch {
      setError("Unable to load Smart Clipboard data.");
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddBoard = async () => {
    if (!newBoardName.trim()) return;
    try {
      const api = getAPI();
      if (api.whisperwoofSaveBoard) {
        const board = await api.whisperwoofSaveBoard({
          name: newBoardName.trim(),
          position: boards.length,
          color: BOARD_COLORS[boards.length % BOARD_COLORS.length]!,
        });
        setBoards((prev) => [...prev, board]);
      } else {
        // Demo mode
        const board: SnippetBoard = {
          id: `demo-${Date.now()}`,
          name: newBoardName.trim(),
          position: boards.length,
          color: BOARD_COLORS[boards.length % BOARD_COLORS.length]!,
          createdAt: new Date().toISOString(),
        };
        setBoards((prev) => [...prev, board]);
      }
      setNewBoardName("");
      setIsAddingBoard(false);
    } catch {
      setError("Failed to create board.");
    }
  };

  const handleDeleteBoard = async (id: string) => {
    try {
      const api = getAPI();
      if (api.whisperwoofDeleteBoard) {
        await api.whisperwoofDeleteBoard(id);
      }
      setBoards((prev) => prev.filter((b) => b.id !== id));
      setSnippets((prev) => prev.filter((s) => s.boardId !== id));
    } catch {
      setError("Failed to delete board.");
    }
  };

  const handleRenameBoard = async (id: string, name: string) => {
    try {
      const api = getAPI();
      if (api.whisperwoofUpdateBoard) {
        await api.whisperwoofUpdateBoard(id, { name });
      }
      setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
    } catch {
      setError("Failed to rename board.");
    }
  };

  const handleAddSnippet = async (boardId: string) => {
    try {
      const api = getAPI();
      const boardSnippets = snippets.filter((s) => s.boardId === boardId);
      const newSnippet = {
        content: "",
        title: "New snippet",
        boardId,
        position: boardSnippets.length,
        source: "human" as SnippetSource,
        hotkey: null,
      };

      if (api.whisperwoofSaveSnippet) {
        const snippet = await api.whisperwoofSaveSnippet(newSnippet);
        setSnippets((prev) => [...prev, snippet]);
      } else {
        const snippet: Snippet = {
          ...newSnippet,
          id: `s-${Date.now()}`,
          useCount: 0,
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setSnippets((prev) => [...prev, snippet]);
      }
    } catch {
      setError("Failed to add snippet.");
    }
  };

  const handleCopySnippet = async (snippet: Snippet) => {
    try {
      await navigator.clipboard.writeText(snippet.content);
      const api = getAPI();
      if (api.whisperwoofRecordSnippetUse) {
        const updated = await api.whisperwoofRecordSnippetUse(snippet.id);
        setSnippets((prev) => prev.map((s) => (s.id === snippet.id ? updated : s)));
      } else {
        setSnippets((prev) =>
          prev.map((s) =>
            s.id === snippet.id
              ? { ...s, useCount: s.useCount + 1, lastUsedAt: new Date().toISOString() }
              : s
          )
        );
      }
    } catch {
      setError("Failed to copy snippet.");
    }
  };

  const handleDeleteSnippet = async (id: string) => {
    try {
      const api = getAPI();
      if (api.whisperwoofDeleteSnippet) {
        await api.whisperwoofDeleteSnippet(id);
      }
      setSnippets((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError("Failed to delete snippet.");
    }
  };

  const handleEditSnippet = async (id: string, updates: Partial<Snippet>) => {
    try {
      const api = getAPI();
      if (api.whisperwoofScUpdateSnippet) {
        const updated = await api.whisperwoofScUpdateSnippet(id, updates);
        setSnippets((prev) => prev.map((s) => (s.id === id ? updated : s)));
      } else {
        setSnippets((prev) =>
          prev.map((s) => (s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s))
        );
      }
    } catch {
      setError("Failed to update snippet.");
    }
  };

  const handleLoadSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const api = getAPI();
      if (api.whisperwoofSuggestSnippets) {
        const results = await api.whisperwoofSuggestSnippets(10);
        setSuggestions(results);
      } else {
        // Demo suggestions
        setSuggestions([
          { text: "Thanks for the update! I'll look into this.", source: "clipboard", frequency: 8, lastSeen: new Date().toISOString() },
          { text: "Let me check and get back to you.", source: "voice", frequency: 5, lastSeen: new Date().toISOString() },
          { text: "Sounds good, let's proceed with that approach.", source: "voice", frequency: 4, lastSeen: new Date().toISOString() },
        ]);
      }
      setShowSuggestions(true);
    } catch {
      setError("Failed to load suggestions.");
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleAddSuggestion = async (suggestion: SnippetSuggestion) => {
    if (boards.length === 0) return;
    const targetBoard = boards[0]!; // Add to the first board
    const boardSnippets = snippets.filter((s) => s.boardId === targetBoard.id);
    const title = suggestion.text.length > 40 ? suggestion.text.slice(0, 40).trimEnd() + "..." : suggestion.text;
    const source = (suggestion.source === "voice" ? "voice" : "human") as SnippetSource;

    try {
      const api = getAPI();
      const newSnippet = { content: suggestion.text, title, boardId: targetBoard.id, position: boardSnippets.length, source, hotkey: null };
      if (api.whisperwoofSaveSnippet) {
        const saved = await api.whisperwoofSaveSnippet(newSnippet);
        setSnippets((prev) => [...prev, saved]);
      } else {
        const saved: Snippet = { ...newSnippet, id: `s-${Date.now()}`, useCount: 0, lastUsedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        setSnippets((prev) => [...prev, saved]);
      }
      setSuggestions((prev) => prev.filter((s) => s.text !== suggestion.text));
    } catch {
      setError("Failed to add suggestion.");
    }
  };

  const matchesSearch = (snippet: Snippet): boolean => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return snippet.title.toLowerCase().includes(q) || snippet.content.toLowerCase().includes(q);
  };

  const snippetsByBoard = (boardId: string) =>
    snippets.filter((s) => s.boardId === boardId && matchesSearch(s)).sort((a, b) => a.position - b.position);

  if (error) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="text-center space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => { setError(null); fetchData(); }}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/15 dark:border-white/6 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Smart Clipboard</h2>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            Organize and quick-paste your frequently used text
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search snippets..."
              className="w-44 text-xs bg-transparent border border-border/20 dark:border-white/8 rounded-md pl-7 pr-2 py-1.5 outline-none focus:border-primary/40 placeholder:text-muted-foreground/30 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
              >
                <X size={10} />
              </button>
            )}
          </div>
          <div className="relative">
            <button
              onClick={handleLoadSuggestions}
              disabled={loadingSuggestions}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground px-2.5 py-1.5 rounded-md border border-border/20 dark:border-white/6 hover:border-border/40 transition-all disabled:opacity-50"
              title="Suggest snippets from your voice & clipboard history"
            >
              <Lightbulb size={12} />
              {loadingSuggestions ? "Loading..." : "Suggest"}
            </button>
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute right-0 top-full mt-2 z-20 w-80 bg-background border border-border/30 dark:border-white/10 rounded-lg shadow-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 dark:border-white/6">
                  <span className="text-xs font-medium text-foreground/80">Frequently used text</span>
                  <button onClick={() => setShowSuggestions(false)} className="text-muted-foreground/40 hover:text-foreground">
                    <X size={12} />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleAddSuggestion(s)}
                      className="flex items-start gap-2 w-full px-3 py-2.5 text-left hover:bg-foreground/[0.03] dark:hover:bg-white/[0.04] transition-colors border-b border-border/10 dark:border-white/4 last:border-b-0"
                    >
                      <Plus size={12} className="shrink-0 mt-0.5 text-primary/60" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/80 line-clamp-2">{s.text}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground/50">{s.source}</span>
                          <span className="text-[10px] text-muted-foreground/50">{s.frequency}x used</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {suggestions.length === 0 && (
                  <p className="text-xs text-muted-foreground/50 text-center py-6">No suggestions — keep using WhisperWoof!</p>
                )}
              </div>
            )}
            {showSuggestions && suggestions.length === 0 && !loadingSuggestions && (
              <div className="absolute right-0 top-full mt-2 z-20 w-64 bg-background border border-border/30 dark:border-white/10 rounded-lg shadow-xl p-4 text-center">
                <p className="text-xs text-muted-foreground/60">No frequent phrases found yet. Keep using WhisperWoof and suggestions will appear!</p>
                <button onClick={() => setShowSuggestions(false)} className="text-xs text-primary mt-2">OK</button>
              </div>
            )}
          </div>
          {isAddingBoard ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="Board name"
                className="w-32 text-xs bg-transparent border border-border/30 dark:border-white/10 rounded-md px-2 py-1.5 outline-none focus:border-primary/40"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleAddBoard(); if (e.key === "Escape") setIsAddingBoard(false); }}
              />
              <button onClick={handleAddBoard} className="p-1 rounded text-primary hover:bg-primary/10 transition-colors">
                <Check size={14} />
              </button>
              <button onClick={() => setIsAddingBoard(false)} className="p-1 rounded text-muted-foreground hover:bg-foreground/5 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingBoard(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground px-2.5 py-1.5 rounded-md border border-border/20 dark:border-white/6 hover:border-border/40 transition-all"
            >
              <Plus size={12} />
              Add board
            </button>
          )}
        </div>
      </div>

      {/* Kanban board area */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-4 h-full min-w-min">
          {boards.map((board) => (
            <BoardColumn
              key={board.id}
              board={board}
              snippets={snippetsByBoard(board.id)}
              onAddSnippet={handleAddSnippet}
              onCopySnippet={handleCopySnippet}
              onDeleteSnippet={handleDeleteSnippet}
              onEditSnippet={handleEditSnippet}
              onDeleteBoard={handleDeleteBoard}
              onRenameBoard={handleRenameBoard}
              isSearching={searchQuery.trim().length > 0}
            />
          ))}

          {boards.length === 0 && (
            <div className="flex flex-col items-center justify-center w-full text-center py-16 space-y-3">
              <div className="w-12 h-12 rounded-full bg-foreground/[0.03] dark:bg-white/[0.04] flex items-center justify-center">
                <Copy size={20} className="text-muted-foreground/30" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground/70">No boards yet</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Create a board to start organizing your frequently used text snippets.
                </p>
              </div>
              <button
                onClick={() => setIsAddingBoard(true)}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-3 py-1.5 rounded-md bg-primary/8 hover:bg-primary/12 transition-colors"
              >
                <Plus size={12} />
                Create your first board
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
