/**
 * MemoryView — Context-Aware Vocabulary + Word Packs Dashboard
 *
 * Two sections:
 *   1. Your Words — auto-learned + manually added vocabulary, grouped by app context
 *   2. Word Packs — curated vocabulary packs with enable/disable + per-entry editing
 */

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Monitor,
  Plus,
  Trash2,
  Zap,
  Pencil,
  Search,
  X,
  Package,
  ChevronDown,
  ChevronRight,
  Check,
  EyeOff,
} from "lucide-react";
import { cn } from "../../../components/lib/utils";

// --- Types ---

interface VocabEntry {
  readonly id: string;
  readonly word: string;
  readonly category: string;
  readonly alternatives: readonly string[];
  readonly createdAt: string;
  readonly source: string;
  readonly usageCount: number;
  readonly appContexts?: Record<string, { count: number; firstSeen: string; lastSeen: string }>;
  readonly appCount?: number;
  readonly appFirstSeen?: string;
  readonly appLastSeen?: string;
}

interface TrackedApp {
  readonly bundleId: string;
  readonly wordCount: number;
  readonly totalUsage: number;
}

interface VocabStats {
  readonly total: number;
  readonly max: number;
  readonly autoLearned: number;
  readonly manual: number;
  readonly categories: Record<string, number>;
  readonly trackedApps: readonly TrackedApp[];
  readonly topUsed: readonly { word: string; usageCount: number }[];
}

interface PackSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly entryCount: number;
  readonly categories: Record<string, number>;
  readonly enabled: boolean;
  readonly installedVersion: string | null;
  readonly disabledEntryCount: number;
}

interface PackEntry {
  readonly word: string;
  readonly alternatives?: readonly string[];
  readonly category?: string;
}

interface PackDetails {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly entries: readonly PackEntry[];
  readonly enabled: boolean;
  readonly disabledEntries: readonly string[];
}

interface MemoryAPI {
  whisperwoofGetVocabulary?: (options?: Record<string, unknown>) => Promise<VocabEntry[]>;
  whisperwoofGetVocabularyStats?: () => Promise<VocabStats>;
  whisperwoofGetTrackedApps?: () => Promise<TrackedApp[]>;
  whisperwoofGetVocabularyForApp?: (bundleId: string) => Promise<VocabEntry[]>;
  whisperwoofAddWord?: (word: string, options?: Record<string, unknown>) => Promise<{ success: boolean; entry?: VocabEntry }>;
  whisperwoofRemoveWord?: (id: string) => Promise<{ success: boolean }>;
  whisperwoofGetAvailablePacks?: () => Promise<PackSummary[]>;
  whisperwoofGetPackDetails?: (packId: string) => Promise<PackDetails | null>;
  whisperwoofEnablePack?: (packId: string) => Promise<{ success: boolean }>;
  whisperwoofDisablePack?: (packId: string) => Promise<{ success: boolean }>;
  whisperwoofTogglePackEntry?: (packId: string, word: string) => Promise<{ success: boolean }>;
}

function getAPI(): MemoryAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? {};
}

// --- App name mapping (common macOS bundleIds to friendly names) ---

const APP_NAMES: Record<string, string> = {
  "com.microsoft.VSCode": "VS Code",
  "com.todesktop.230313mzl4w4u92": "Cursor",
  "dev.zed.Zed": "Zed",
  "com.apple.dt.Xcode": "Xcode",
  "com.googlecode.iterm2": "iTerm2",
  "com.apple.Terminal": "Terminal",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.hnc.Discord": "Discord",
  "com.apple.MobileSMS": "Messages",
  "ru.keepcoder.Telegram": "Telegram",
  "net.whatsapp.WhatsApp": "WhatsApp",
  "com.microsoft.teams2": "Teams",
  "com.apple.mail": "Mail",
  "com.microsoft.Outlook": "Outlook",
  "com.apple.Notes": "Notes",
  "md.obsidian": "Obsidian",
  "com.notion.id": "Notion",
  "com.apple.Safari": "Safari",
  "com.google.Chrome": "Chrome",
  "org.mozilla.firefox": "Firefox",
  "com.microsoft.Word": "Word",
  "com.apple.iWork.Pages": "Pages",
};

function appName(bundleId: string): string {
  return APP_NAMES[bundleId] || bundleId.split(".").pop() || bundleId;
}

// --- Sub-components ---

function SourceBadge({ source }: { readonly source: string }) {
  const isAuto = source === "auto-learn";
  return (
    <span className={cn(
      "text-[11px] px-1.5 py-0.5 rounded font-medium",
      isAuto
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : source === "import"
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          : "bg-foreground/[0.05] text-muted-foreground/70"
    )}>
      {isAuto ? "auto" : source}
    </span>
  );
}

function WordRow({
  entry,
  onDelete,
}: {
  readonly entry: VocabEntry;
  readonly onDelete: (id: string) => void;
}) {
  const contexts = entry.appContexts ? Object.entries(entry.appContexts) : [];

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-foreground/[0.03] dark:hover:bg-white/[0.03] transition-colors border-b border-border/8 dark:border-white/4 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground">{entry.word}</span>
          <SourceBadge source={entry.source} />
          {entry.usageCount > 0 && (
            <span className="text-[11px] text-muted-foreground/60 flex items-center gap-0.5">
              <Zap size={10} className="text-amber-500/60" /> {entry.usageCount}x
            </span>
          )}
        </div>
        {contexts.length > 0 && (
          <div className="flex items-center gap-2 mt-1">
            {contexts.slice(0, 4).map(([bid, ctx]) => (
              <span key={bid} className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
                <Monitor size={9} className="text-muted-foreground/30" />
                {appName(bid)}
                <span className="text-muted-foreground/35">({ctx.count})</span>
              </span>
            ))}
            {contexts.length > 4 && (
              <span className="text-[11px] text-muted-foreground/40">+{contexts.length - 4} more</span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={() => onDelete(entry.id)}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground/30 hover:text-red-400 transition-all"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// --- Vocabulary Pack components ---

function PackCard({
  pack,
  onToggle,
  onExpand,
  isExpanded,
}: {
  readonly pack: PackSummary;
  readonly onToggle: (packId: string, enabled: boolean) => void;
  readonly onExpand: (packId: string) => void;
  readonly isExpanded: boolean;
}) {
  const categoryList = Object.entries(pack.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-lg border border-border/15 dark:border-white/6 overflow-hidden">
      <button
        onClick={() => onExpand(pack.id)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02] dark:hover:bg-white/[0.02] transition-colors"
      >
        <Package size={16} className={cn(
          "shrink-0",
          pack.enabled ? "text-primary" : "text-muted-foreground/40"
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{pack.name}</span>
            <span className="text-[11px] text-muted-foreground/50">{pack.entryCount} words</span>
            {pack.disabledEntryCount > 0 && (
              <span className="text-[11px] text-muted-foreground/40 flex items-center gap-0.5">
                <EyeOff size={9} /> {pack.disabledEntryCount} hidden
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{pack.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(pack.id, !pack.enabled); }}
            className={cn(
              "w-8 h-[18px] rounded-full relative transition-colors",
              pack.enabled ? "bg-primary" : "bg-foreground/10 dark:bg-white/10"
            )}
          >
            <span className={cn(
              "absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform",
              pack.enabled ? "left-[16px]" : "left-[2px]"
            )} />
          </button>
          {isExpanded ? <ChevronDown size={14} className="text-muted-foreground/40" /> : <ChevronRight size={14} className="text-muted-foreground/40" />}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border/10 dark:border-white/4">
          {/* Category chips */}
          {categoryList.length > 1 && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
              {categoryList.map(([cat, count]) => (
                <span key={cat} className="text-[11px] px-2 py-0.5 rounded-full bg-foreground/[0.04] dark:bg-white/[0.04] text-muted-foreground/60">
                  {cat} ({count})
                </span>
              ))}
            </div>
          )}
          {/* Entries are loaded by the parent (PackEntriesList) */}
        </div>
      )}
    </div>
  );
}

function PackEntriesList({
  packId,
  onToggleEntry,
}: {
  readonly packId: string;
  readonly onToggleEntry: (packId: string, word: string) => void;
}) {
  const [details, setDetails] = useState<PackDetails | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const api = getAPI();
    api.whisperwoofGetPackDetails?.(packId).then((d) => setDetails(d ?? null));
  }, [packId]);

  if (!details) {
    return <div className="px-4 py-3 text-xs text-muted-foreground/40">Loading...</div>;
  }

  const disabledSet = new Set(details.disabledEntries);
  const filtered = search.trim()
    ? details.entries.filter((e) => e.word.toLowerCase().includes(search.toLowerCase()))
    : details.entries;

  return (
    <div className="px-4 pb-3">
      {details.entries.length > 15 && (
        <div className="relative mb-2">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter words..."
            className="w-full text-xs bg-transparent border border-border/15 dark:border-white/6 rounded-md pl-7 pr-2 py-1.5 outline-none focus:border-primary/30 placeholder:text-muted-foreground/30"
          />
        </div>
      )}
      <div className="max-h-64 overflow-y-auto space-y-0">
        {filtered.map((entry) => {
          const isDisabled = disabledSet.has(entry.word);
          return (
            <div
              key={entry.word}
              className="flex items-center gap-2.5 py-1.5 px-1 group"
            >
              <button
                onClick={() => onToggleEntry(packId, entry.word)}
                className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                  isDisabled
                    ? "border-foreground/10 dark:border-white/10 bg-transparent"
                    : "border-primary/40 bg-primary/10 text-primary"
                )}
              >
                {!isDisabled && <Check size={10} strokeWidth={3} />}
              </button>
              <span className={cn(
                "text-sm transition-colors",
                isDisabled ? "text-muted-foreground/30 line-through" : "text-foreground/80"
              )}>
                {entry.word}
              </span>
              {entry.alternatives && entry.alternatives.length > 0 && (
                <span className="text-[11px] text-muted-foreground/35 italic truncate">
                  ({entry.alternatives.join(", ")})
                </span>
              )}
              {entry.category && (
                <span className="text-[10px] text-muted-foreground/30 ml-auto shrink-0">
                  {entry.category}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {search && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground/40 py-2 text-center italic">No matches</p>
      )}
    </div>
  );
}

// --- Main component ---

interface MemoryViewProps {
  readonly className?: string;
}

export default function MemoryView({ className }: MemoryViewProps) {
  const [allWords, setAllWords] = useState<VocabEntry[]>([]);
  const [stats, setStats] = useState<VocabStats | null>(null);
  const [trackedApps, setTrackedApps] = useState<TrackedApp[]>([]);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [appWords, setAppWords] = useState<VocabEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAddingWord, setIsAddingWord] = useState(false);
  const [newWord, setNewWord] = useState("");

  // Vocabulary packs state
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [expandedPack, setExpandedPack] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const api = getAPI();
      if (api.whisperwoofGetVocabularyStats && api.whisperwoofGetVocabulary) {
        const [statsData, wordsData, appsData] = await Promise.all([
          api.whisperwoofGetVocabularyStats(),
          api.whisperwoofGetVocabulary(),
          api.whisperwoofGetTrackedApps?.() ?? [],
        ]);
        setStats(statsData);
        setAllWords(wordsData);
        setTrackedApps(appsData as TrackedApp[]);
        setError(null);
      }
    } catch {
      setError("Unable to load Memory data.");
    }
  }, []);

  const fetchPacks = useCallback(async () => {
    try {
      const api = getAPI();
      if (api.whisperwoofGetAvailablePacks) {
        const packsData = await api.whisperwoofGetAvailablePacks();
        setPacks(packsData);
      }
    } catch {
      // Non-critical — packs section just won't show
    }
  }, []);

  useEffect(() => { fetchData(); fetchPacks(); }, [fetchData, fetchPacks]);

  // Fetch app-specific words when selecting an app tab
  useEffect(() => {
    if (!selectedApp) return;
    const api = getAPI();
    if (api.whisperwoofGetVocabularyForApp) {
      api.whisperwoofGetVocabularyForApp(selectedApp).then(setAppWords).catch(() => {});
    } else {
      setAppWords(allWords.filter((w) => w.appContexts?.[selectedApp]));
    }
  }, [selectedApp, allWords]);

  const handleAddWord = async () => {
    if (!newWord.trim()) return;
    try {
      const api = getAPI();
      if (api.whisperwoofAddWord) {
        await api.whisperwoofAddWord(newWord.trim(), { source: "manual", category: "general" });
      }
      setNewWord("");
      setIsAddingWord(false);
      fetchData();
    } catch {
      setError("Failed to add word.");
    }
  };

  const handleDeleteWord = async (id: string) => {
    try {
      const api = getAPI();
      if (api.whisperwoofRemoveWord) {
        await api.whisperwoofRemoveWord(id);
      }
      setAllWords((prev) => prev.filter((w) => w.id !== id));
      setAppWords((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setError("Failed to remove word.");
    }
  };

  const handleTogglePack = async (packId: string, enable: boolean) => {
    const api = getAPI();
    const fn = enable ? api.whisperwoofEnablePack : api.whisperwoofDisablePack;
    if (fn) {
      await fn(packId);
      fetchPacks();
    }
  };

  const handleExpandPack = (packId: string) => {
    setExpandedPack((prev) => (prev === packId ? null : packId));
  };

  const handleTogglePackEntry = async (packId: string, word: string) => {
    const api = getAPI();
    if (api.whisperwoofTogglePackEntry) {
      await api.whisperwoofTogglePackEntry(packId, word);
      // Re-expand to refresh entries
      setExpandedPack(null);
      setTimeout(() => setExpandedPack(packId), 0);
      fetchPacks();
    }
  };

  const displayWords = selectedApp ? appWords : allWords;
  const filteredWords = searchQuery.trim()
    ? displayWords.filter((w) => w.word.toLowerCase().includes(searchQuery.toLowerCase()))
    : displayWords;

  const enabledPackCount = packs.filter((p) => p.enabled).length;
  const totalPackWords = packs.filter((p) => p.enabled).reduce((sum, p) => sum + p.entryCount - p.disabledEntryCount, 0);

  if (error) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="text-center space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => { setError(null); fetchData(); }} className="text-xs text-primary">Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/15 dark:border-white/6 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Brain size={16} className="text-primary/70" />
              Memory
            </h2>
            {stats && (
              <p className="text-xs text-muted-foreground/70 mt-1">
                {stats.total} words learned
                {stats.autoLearned > 0 && ` (${stats.autoLearned} auto, ${stats.manual} manual)`}
                {totalPackWords > 0 && ` + ${totalPackWords} from packs`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search words..."
                className="w-40 text-xs bg-transparent border border-border/20 dark:border-white/8 rounded-md pl-7 pr-2 py-1.5 outline-none focus:border-primary/40 placeholder:text-muted-foreground/30"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground">
                  <X size={11} />
                </button>
              )}
            </div>
            {isAddingWord ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  placeholder="Word or phrase"
                  className="w-36 text-xs bg-transparent border border-border/30 dark:border-white/10 rounded-md px-2 py-1.5 outline-none focus:border-primary/40"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddWord(); if (e.key === "Escape") setIsAddingWord(false); }}
                />
                <button onClick={handleAddWord} className="p-1.5 rounded text-primary hover:bg-primary/10"><Pencil size={13} /></button>
                <button onClick={() => setIsAddingWord(false)} className="p-1.5 rounded text-muted-foreground hover:bg-foreground/5"><X size={13} /></button>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingWord(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground px-2.5 py-1.5 rounded-md border border-border/20 dark:border-white/6 hover:border-border/40 transition-all"
              >
                <Plus size={12} /> Add word
              </button>
            )}
          </div>
        </div>

        {/* App context tabs */}
        {trackedApps.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedApp(null)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors",
                selectedApp === null
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03]"
              )}
            >
              All ({stats?.total ?? 0})
            </button>
            {trackedApps.map((app) => (
              <button
                key={app.bundleId}
                onClick={() => setSelectedApp(app.bundleId)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors",
                  selectedApp === app.bundleId
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03]"
                )}
              >
                <Monitor size={11} />
                {appName(app.bundleId)} ({app.wordCount})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Your Words section */}
        {filteredWords.length === 0 && !searchQuery && allWords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-8">
            <Brain size={36} className="text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-foreground/70 mb-1.5">Memory learns as you talk</p>
            <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-[300px] mb-4">
              Start dictating in different apps. When you correct a transcription,
              Memory auto-learns the right word and remembers which app you were in.
            </p>
            <div className="rounded-lg border border-border/20 dark:border-white/6 bg-foreground/[0.02] dark:bg-white/[0.02] px-4 py-3 max-w-[300px]">
              <p className="text-xs text-foreground/60 leading-relaxed">
                <span className="font-medium text-foreground/80">How it works:</span> You say "deploy to supabase."
                Whisper hears "deploy to super base." You fix it. Memory learns "Supabase"
                and tags it to VS Code.
              </p>
            </div>
          </div>
        ) : (
          <>
            {filteredWords.length === 0 && searchQuery ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-xs text-muted-foreground/50 italic">No words matching "{searchQuery}"</p>
              </div>
            ) : (
              <div className="py-1 px-2">
                {filteredWords.map((entry) => (
                  <WordRow key={entry.id} entry={entry} onDelete={handleDeleteWord} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Word Packs section */}
        {packs.length > 0 && (
          <div className="px-5 py-4 border-t border-border/10 dark:border-white/4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Package size={14} className="text-primary/60" />
                Word Packs
              </h3>
              <span className="text-xs text-muted-foreground/50">
                {enabledPackCount} of {packs.length} active
              </span>
            </div>
            <p className="text-xs text-muted-foreground/50 mb-3 leading-relaxed">
              Curated vocabulary sets that help speech recognition get tricky words right.
              Enable a pack to add its words to your STT hints.
            </p>
            <div className="space-y-2">
              {packs.map((pack) => (
                <div key={pack.id}>
                  <PackCard
                    pack={pack}
                    onToggle={handleTogglePack}
                    onExpand={handleExpandPack}
                    isExpanded={expandedPack === pack.id}
                  />
                  {expandedPack === pack.id && (
                    <PackEntriesList
                      packId={pack.id}
                      onToggleEntry={handleTogglePackEntry}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer stats */}
      {stats && stats.topUsed.length > 0 && !searchQuery && (
        <div className="px-5 py-2.5 border-t border-border/10 dark:border-white/4 shrink-0">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50">
            <span>Top words:</span>
            {stats.topUsed.slice(0, 3).map((w) => (
              <span key={w.word} className="text-foreground/60">
                {w.word} <span className="text-muted-foreground/40">({w.usageCount}x)</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
