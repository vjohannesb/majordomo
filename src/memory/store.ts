/**
 * Memory Store
 *
 * Persistent storage for agent memories and context.
 * Uses simple file-based storage with optional vector search.
 *
 * Memory types:
 * - Facts: Persistent knowledge about the user (preferences, people, etc.)
 * - Conversations: Summaries of past conversations
 * - Tasks: Recurring tasks and reminders
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const MEMORY_DIR = join(homedir(), '.majordomo', 'memory');

export interface Memory {
  id: string;
  type: 'fact' | 'conversation' | 'task' | 'note';
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  memory: Memory;
  relevance: number;
}

export class MemoryStore {
  private memories: Map<string, Memory> = new Map();
  private loaded = false;

  constructor() {
    // Ensure memory directory exists
    if (!existsSync(MEMORY_DIR)) {
      mkdirSync(MEMORY_DIR, { recursive: true });
    }
  }

  private ensureLoaded() {
    if (this.loaded) return;
    this.loadFromDisk();
    this.loaded = true;
  }

  private loadFromDisk() {
    const memoriesFile = join(MEMORY_DIR, 'memories.json');
    if (existsSync(memoriesFile)) {
      try {
        const data = JSON.parse(readFileSync(memoriesFile, 'utf-8')) as Memory[];
        for (const memory of data) {
          this.memories.set(memory.id, memory);
        }
      } catch {
        // Start fresh if corrupted
      }
    }
  }

  private saveToDisk() {
    const memoriesFile = join(MEMORY_DIR, 'memories.json');
    const data = Array.from(this.memories.values());
    writeFileSync(memoriesFile, JSON.stringify(data, null, 2));
  }

  add(
    type: Memory['type'],
    content: string,
    tags: string[] = [],
    metadata?: Record<string, unknown>
  ): Memory {
    this.ensureLoaded();

    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      type,
      content,
      tags,
      createdAt: now,
      updatedAt: now,
      metadata,
    };

    this.memories.set(memory.id, memory);
    this.saveToDisk();

    return memory;
  }

  get(id: string): Memory | undefined {
    this.ensureLoaded();
    return this.memories.get(id);
  }

  update(id: string, updates: Partial<Pick<Memory, 'content' | 'tags' | 'metadata'>>): Memory | undefined {
    this.ensureLoaded();

    const memory = this.memories.get(id);
    if (!memory) return undefined;

    if (updates.content !== undefined) memory.content = updates.content;
    if (updates.tags !== undefined) memory.tags = updates.tags;
    if (updates.metadata !== undefined) memory.metadata = { ...memory.metadata, ...updates.metadata };
    memory.updatedAt = new Date().toISOString();

    this.memories.set(id, memory);
    this.saveToDisk();

    return memory;
  }

  delete(id: string): boolean {
    this.ensureLoaded();
    const deleted = this.memories.delete(id);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  /**
   * Search memories by text content and tags.
   * Simple keyword-based search for now.
   * TODO: Add vector embeddings for semantic search.
   */
  search(query: string, options: { type?: Memory['type']; tags?: string[]; limit?: number } = {}): SearchResult[] {
    this.ensureLoaded();

    const { type, tags, limit = 10 } = options;
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(Boolean);

    const results: SearchResult[] = [];

    for (const memory of this.memories.values()) {
      // Filter by type
      if (type && memory.type !== type) continue;

      // Filter by tags
      if (tags && tags.length > 0) {
        const hasTag = tags.some((t) => memory.tags.includes(t));
        if (!hasTag) continue;
      }

      // Calculate relevance (simple keyword matching)
      const contentLower = memory.content.toLowerCase();
      let relevance = 0;

      // Exact phrase match
      if (contentLower.includes(queryLower)) {
        relevance += 10;
      }

      // Word matches
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          relevance += 1;
        }
        // Bonus for tag matches
        if (memory.tags.some((t) => t.toLowerCase().includes(word))) {
          relevance += 2;
        }
      }

      if (relevance > 0) {
        results.push({ memory, relevance });
      }
    }

    // Sort by relevance and limit
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  /**
   * List all memories of a given type.
   */
  listByType(type: Memory['type']): Memory[] {
    this.ensureLoaded();
    return Array.from(this.memories.values())
      .filter((m) => m.type === type)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Get all memories (for export/backup).
   */
  getAll(): Memory[] {
    this.ensureLoaded();
    return Array.from(this.memories.values());
  }

  /**
   * Get a summary of stored memories.
   */
  getSummary(): { facts: number; conversations: number; tasks: number; notes: number; total: number } {
    this.ensureLoaded();
    const counts = { facts: 0, conversations: 0, tasks: 0, notes: 0, total: 0 };

    for (const memory of this.memories.values()) {
      counts.total++;
      switch (memory.type) {
        case 'fact':
          counts.facts++;
          break;
        case 'conversation':
          counts.conversations++;
          break;
        case 'task':
          counts.tasks++;
          break;
        case 'note':
          counts.notes++;
          break;
      }
    }

    return counts;
  }
}

// Singleton instance
let memoryStore: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
  if (!memoryStore) {
    memoryStore = new MemoryStore();
  }
  return memoryStore;
}
