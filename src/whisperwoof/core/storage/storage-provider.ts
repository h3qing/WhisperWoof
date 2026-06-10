/**
 * StorageProvider Interface
 *
 * All data access in WhisperWoof goes through this interface.
 * Implementations handle the actual persistence (SQLite, Supabase, etc.).
 *
 * Immutability: All returned objects are readonly. Updates return new objects.
 */

import type { Entry, Project, SearchFilters, ImportResult } from './types';

export interface StorageProvider {
  // Entry CRUD
  saveEntry(entry: Omit<Entry, 'id' | 'createdAt'>): Promise<Entry>;
  getEntry(id: string): Promise<Entry | null>;
  updateEntry(id: string, updates: Partial<Omit<Entry, 'id' | 'createdAt'>>): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;

  // Entry queries
  search(query: string, filters?: SearchFilters): Promise<readonly Entry[]>;
  getRecent(limit: number, offset?: number): Promise<readonly Entry[]>;

  // Project CRUD
  saveProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  getProjects(): Promise<readonly Project[]>;
  updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  // Migration
  exportAll(): AsyncIterable<Entry>;
  importAll(entries: AsyncIterable<Entry>): Promise<ImportResult>;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}
