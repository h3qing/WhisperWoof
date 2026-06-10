/**
 * Typed wrapper for window.electronAPI
 *
 * Single source of truth for IPC method types.
 * Components import this instead of defining their own getAPI().
 */

import type { Entry, Snippet, SnippetBoard, SnippetSource } from "../../core/storage/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getElectronAPI(): ElectronAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? {};
}

export interface ElectronAPI {
  // Entries
  whisperwoofGetEntries?: (limit: number, offset: number) => Promise<Entry[]>;
  whisperwoofSaveEntry?: (entry: Record<string, unknown>) => Promise<{ success: boolean }>;
  whisperwoofDeleteEntry?: (id: string) => Promise<void>;
  whisperwoofToggleFavorite?: (id: string) => Promise<boolean>;
  whisperwoofGetFavorites?: (limit: number) => Promise<Entry[]>;
  whisperwoofSearchEntries?: (query: string, limit: number) => Promise<Entry[]>;

  // Projects
  whisperwoofCreateProject?: (name: string) => Promise<Record<string, unknown>>;
  whisperwoofGetProjects?: () => Promise<Record<string, unknown>[]>;
  whisperwoofDeleteProject?: (id: string) => Promise<{ success: boolean }>;
  whisperwoofGetProjectEntries?: (projectId: string, limit: number) => Promise<Entry[]>;

  // Smart Clipboard
  whisperwoofGetBoards?: () => Promise<SnippetBoard[]>;
  whisperwoofSaveBoard?: (board: { name: string; position: number; color: string }) => Promise<SnippetBoard>;
  whisperwoofUpdateBoard?: (id: string, updates: Partial<SnippetBoard>) => Promise<SnippetBoard>;
  whisperwoofDeleteBoard?: (id: string) => Promise<void>;
  whisperwoofGetAllSnippets?: () => Promise<Snippet[]>;
  whisperwoofSaveSnippet?: (snippet: { content: string; title: string; boardId: string; position: number; source: SnippetSource; hotkey: string | null }) => Promise<Snippet>;
  whisperwoofScUpdateSnippet?: (id: string, updates: Partial<Snippet>) => Promise<Snippet>;
  whisperwoofDeleteSnippet?: (id: string) => Promise<void>;
  whisperwoofRecordSnippetUse?: (id: string) => Promise<Snippet>;
  whisperwoofSuggestSnippets?: (limit?: number) => Promise<{ text: string; source: string; frequency: number; lastSeen: string }[]>;

  // Memory / Vocabulary
  whisperwoofGetVocabulary?: (options?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  whisperwoofGetVocabularyStats?: () => Promise<{ total: number; autoLearned?: number; manual?: number; trackedApps?: { bundleId: string; wordCount: number; totalUsage: number }[] }>;
  whisperwoofGetVocabularyForApp?: (bundleId: string) => Promise<Record<string, unknown>[]>;
  whisperwoofGetTrackedApps?: () => Promise<{ bundleId: string; wordCount: number; totalUsage: number }[]>;
  whisperwoofAddWord?: (word: string, options?: Record<string, unknown>) => Promise<{ success: boolean }>;
  whisperwoofRemoveWord?: (id: string) => Promise<{ success: boolean }>;

  // Analytics
  whisperwoofGetAnalytics?: () => Promise<Record<string, unknown>>;

  // Storage Manager
  whisperwoofStorageUsage?: () => Promise<Record<string, unknown>>;
  whisperwoofStorageEntries?: (options: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  whisperwoofStorageDeleteBatch?: (ids: string[]) => Promise<{ deleted: number; filesRemoved: number }>;
  whisperwoofStorageDeleteBySource?: (source: string) => Promise<{ deleted: number; filesRemoved: number }>;
  whisperwoofStorageDeleteOlder?: (days: number) => Promise<{ deleted: number; filesRemoved: number }>;
  whisperwoofStorageExport?: (ids?: string[]) => Promise<unknown[]>;
  whisperwoofStorageCleanupOrphans?: () => Promise<{ removed: number; bytes: number }>;

  // Transcription
  transcribeLocalWhisper?: (blob: ArrayBuffer, opts: Record<string, unknown>) => Promise<{ text?: string; error?: string }>;

  // Context
  whisperwoofDetectContext?: () => Promise<{ app: { bundleId: string; name: string } | null; preset: string | null }>;

  // Polish
  whisperwoofPolishText?: (text: string, opts: Record<string, unknown>) => Promise<string | null>;

  // Plugins
  whisperwoofGetPlugins?: () => Promise<Record<string, unknown>[]>;

  // General
  setMainWindowInteractivity?: (capture: boolean) => void;
  getSystemUser?: () => string;
}
