/**
 * Session Manager - Persistent Conversation History
 *
 * Stores conversation transcripts in JSONL format.
 * Handles session creation, loading, saving, and compaction.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: MessageParam[];
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

const SESSIONS_DIR = join(homedir(), '.majordomo', 'sessions');

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  constructor() {
    // Ensure sessions directory exists
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  createSession(metadata?: Record<string, unknown>): string {
    const id = randomUUID();
    const now = new Date().toISOString();

    const session: Session = {
      id,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata,
    };

    this.sessions.set(id, session);
    return id;
  }

  getSession(id: string): Session {
    // Check memory first
    if (this.sessions.has(id)) {
      return this.sessions.get(id)!;
    }

    // Try to load from disk
    const path = join(SESSIONS_DIR, `${id}.jsonl`);
    if (existsSync(path)) {
      const session = this.loadFromDisk(id);
      this.sessions.set(id, session);
      return session;
    }

    // Create new session with this ID
    const now = new Date().toISOString();
    const session: Session = {
      id,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.sessions.set(id, session);
    return session;
  }

  saveSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.updatedAt = new Date().toISOString();

    const path = join(SESSIONS_DIR, `${id}.jsonl`);
    const lines: string[] = [];

    // First line is session metadata
    lines.push(JSON.stringify({
      type: 'session',
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      metadata: session.metadata,
    }));

    // Each message is a separate line
    for (const message of session.messages) {
      lines.push(JSON.stringify({
        type: 'message',
        ...message,
      }));
    }

    writeFileSync(path, lines.join('\n') + '\n');
  }

  private loadFromDisk(id: string): Session {
    const path = join(SESSIONS_DIR, `${id}.jsonl`);
    const content = readFileSync(path, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let session: Session = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    for (const line of lines) {
      const data = JSON.parse(line);

      if (data.type === 'session') {
        session.id = data.id;
        session.createdAt = data.createdAt;
        session.updatedAt = data.updatedAt;
        session.metadata = data.metadata;
      } else if (data.type === 'message') {
        const { type, ...message } = data;
        session.messages.push(message as MessageParam);
      }
    }

    return session;
  }

  listSessions(): SessionSummary[] {
    const summaries: SessionSummary[] = [];

    if (!existsSync(SESSIONS_DIR)) {
      return summaries;
    }

    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const id = file.replace('.jsonl', '');
      try {
        const session = this.getSession(id);
        const preview = this.getSessionPreview(session);

        summaries.push({
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
          preview,
        });
      } catch {
        // Skip corrupted sessions
      }
    }

    // Sort by most recent
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return summaries;
  }

  private getSessionPreview(session: Session): string {
    // Get first user message as preview
    const firstUserMessage = session.messages.find((m) => m.role === 'user');
    if (!firstUserMessage) return '(empty session)';

    const content = firstUserMessage.content;
    if (typeof content === 'string') {
      return content.slice(0, 100) + (content.length > 100 ? '...' : '');
    }

    // Handle array content
    if (Array.isArray(content)) {
      for (const block of content) {
        if ('text' in block && typeof block.text === 'string') {
          return block.text.slice(0, 100) + (block.text.length > 100 ? '...' : '');
        }
      }
    }

    return '(no text preview)';
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
    const path = join(SESSIONS_DIR, `${id}.jsonl`);
    if (existsSync(path)) {
      const { unlinkSync } = require('node:fs');
      unlinkSync(path);
    }
  }

  getMostRecentSession(): string | null {
    const sessions = this.listSessions();
    const first = sessions[0];
    return first ? first.id : null;
  }

  /**
   * Compact a session by summarizing old messages.
   * Keeps recent messages and replaces older ones with a summary.
   */
  async compactSession(id: string, summarizer: (messages: MessageParam[]) => Promise<string>): Promise<void> {
    const session = this.getSession(id);
    if (session.messages.length < 20) {
      return; // Not worth compacting
    }

    // Keep last 10 messages, summarize the rest
    const messagesToSummarize = session.messages.slice(0, -10);
    const recentMessages = session.messages.slice(-10);

    const summary = await summarizer(messagesToSummarize);

    // Replace messages with summary + recent
    session.messages = [
      {
        role: 'user',
        content: `[Previous conversation summary: ${summary}]`,
      },
      {
        role: 'assistant',
        content: 'I understand. I have the context from our previous conversation.',
      },
      ...recentMessages,
    ];

    this.saveSession(id);
  }
}
