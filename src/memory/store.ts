/**
 * Memory Store (SQLite + FTS5)
 *
 * Persistent storage for agent memories using SQLite with full-text search.
 * Scales to thousands of memories with fast fuzzy search.
 *
 * Memory types:
 * - Facts: Persistent knowledge about the user (preferences, people, etc.)
 * - Conversations: Summaries of past conversations
 * - Tasks: Recurring tasks and reminders
 * - Notes: Miscellaneous notes
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const MEMORY_DIR = join(homedir(), '.majordomo', 'memory');
const DB_PATH = join(MEMORY_DIR, 'memories.db');

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
  private db: Database.Database;

  constructor() {
    // Ensure directory exists
    if (!existsSync(MEMORY_DIR)) {
      mkdirSync(MEMORY_DIR, { recursive: true });
    }

    this.db = new Database(DB_PATH);
    this.initSchema();
  }

  private initSchema() {
    // Main memories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('fact', 'conversation', 'task', 'note')),
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id,
        content,
        tags,
        content=memories,
        content_rowid=rowid
      )
    `);

    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, id, content, tags)
        VALUES (NEW.rowid, NEW.id, NEW.content, NEW.tags);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, tags)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.content, OLD.tags);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, tags)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.content, OLD.tags);
        INSERT INTO memories_fts(rowid, id, content, tags)
        VALUES (NEW.rowid, NEW.id, NEW.content, NEW.tags);
      END
    `);

    // Index for type queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)
    `);
  }

  add(
    type: Memory['type'],
    content: string,
    tags: string[] = [],
    metadata?: Record<string, unknown>
  ): Memory {
    const now = new Date().toISOString();
    const id = randomUUID();
    const tagsJson = JSON.stringify(tags);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    this.db.prepare(`
      INSERT INTO memories (id, type, content, tags, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, content, tagsJson, metadataJson, now, now);

    return {
      id,
      type,
      content,
      tags,
      createdAt: now,
      updatedAt: now,
      metadata,
    };
  }

  get(id: string): Memory | undefined {
    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ? OR id LIKE ?
    `).get(id, `${id}%`) as MemoryRow | undefined;

    return row ? this.rowToMemory(row) : undefined;
  }

  update(id: string, updates: Partial<Pick<Memory, 'content' | 'tags' | 'metadata'>>): Memory | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const newContent = updates.content ?? existing.content;
    const newTags = updates.tags ?? existing.tags;
    const newMetadata = updates.metadata
      ? { ...existing.metadata, ...updates.metadata }
      : existing.metadata;

    this.db.prepare(`
      UPDATE memories
      SET content = ?, tags = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `).run(
      newContent,
      JSON.stringify(newTags),
      newMetadata ? JSON.stringify(newMetadata) : null,
      now,
      existing.id
    );

    return {
      ...existing,
      content: newContent,
      tags: newTags,
      metadata: newMetadata,
      updatedAt: now,
    };
  }

  delete(id: string): boolean {
    // Support partial ID matching
    const existing = this.get(id);
    if (!existing) return false;

    const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(existing.id);
    return result.changes > 0;
  }

  /**
   * Full-text search using FTS5.
   * Supports:
   * - Natural language queries
   * - Prefix matching (word*)
   * - Phrase matching ("exact phrase")
   * - Boolean operators (AND, OR, NOT)
   */
  search(query: string, options: { type?: Memory['type']; tags?: string[]; limit?: number } = {}): SearchResult[] {
    const { type, tags, limit = 10 } = options;

    // Build the FTS query - escape special characters and add prefix matching
    const ftsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map(word => `"${word.replace(/"/g, '""')}"*`)
      .join(' OR ');

    if (!ftsQuery) return [];

    let sql = `
      SELECT m.*, bm25(memories_fts) as rank
      FROM memories m
      JOIN memories_fts fts ON m.id = fts.id
      WHERE memories_fts MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (type) {
      sql += ` AND m.type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as (MemoryRow & { rank: number })[];

      // Filter by tags in JS (FTS doesn't handle JSON arrays well)
      let results = rows.map(row => ({
        memory: this.rowToMemory(row),
        relevance: -row.rank, // bm25 returns negative scores, lower is better
      }));

      if (tags && tags.length > 0) {
        results = results.filter(r =>
          tags.some(t => r.memory.tags.includes(t))
        );
      }

      return results;
    } catch {
      // If FTS query fails, fall back to LIKE search
      return this.fallbackSearch(query, type, tags, limit);
    }
  }

  private fallbackSearch(
    query: string,
    type?: Memory['type'],
    tags?: string[],
    limit = 10
  ): SearchResult[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    let sql = `SELECT * FROM memories WHERE 1=1`;
    const params: string[] = [];

    // Add LIKE conditions for each word
    for (const word of words) {
      sql += ` AND (LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)`;
      params.push(`%${word}%`, `%${word}%`);
    }

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`;

    const rows = this.db.prepare(sql).all(...params, limit) as MemoryRow[];

    let results = rows.map(row => ({
      memory: this.rowToMemory(row),
      relevance: 1, // Simple relevance for fallback
    }));

    if (tags && tags.length > 0) {
      results = results.filter(r =>
        tags.some(t => r.memory.tags.includes(t))
      );
    }

    return results;
  }

  /**
   * List all memories of a given type.
   */
  listByType(type: Memory['type'], limit = 100): Memory[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE type = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(type, limit) as MemoryRow[];

    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * Get all memories (for export/backup).
   */
  getAll(): Memory[] {
    const rows = this.db.prepare(`SELECT * FROM memories ORDER BY updated_at DESC`).all() as MemoryRow[];
    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * Get a summary of stored memories.
   */
  getSummary(): { facts: number; conversations: number; tasks: number; notes: number; total: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN type = 'fact' THEN 1 ELSE 0 END) as facts,
        SUM(CASE WHEN type = 'conversation' THEN 1 ELSE 0 END) as conversations,
        SUM(CASE WHEN type = 'task' THEN 1 ELSE 0 END) as tasks,
        SUM(CASE WHEN type = 'note' THEN 1 ELSE 0 END) as notes
      FROM memories
    `).get() as { total: number; facts: number; conversations: number; tasks: number; notes: number };

    return row;
  }

  /**
   * Close the database connection.
   */
  close() {
    this.db.close();
  }

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      type: row.type as Memory['type'],
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  tags: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

// Singleton instance
let memoryStore: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
  if (!memoryStore) {
    memoryStore = new MemoryStore();
  }
  return memoryStore;
}
