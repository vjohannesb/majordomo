/**
 * Database Module (PostgreSQL)
 *
 * Handles user data, OAuth tokens, and memories.
 * Uses Neon/Supabase-compatible PostgreSQL.
 */

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('DATABASE_URL not set - database features will be unavailable');
}

export const sql = DATABASE_URL ? postgres(DATABASE_URL) : null;

/**
 * Initialize database schema
 */
export async function initDatabase() {
  if (!sql) throw new Error('Database not configured');

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      account_name TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, provider, account_name)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('fact', 'conversation', 'task', 'note')),
      content TEXT NOT NULL,
      tags JSONB DEFAULT '[]',
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Full-text search index for memories
  await sql`
    CREATE INDEX IF NOT EXISTS memories_content_search
    ON memories USING GIN (to_tsvector('english', content))
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS memories_user_type
    ON memories(user_id, type)
  `;

  console.log('Database initialized');
}

// ============================================================================
// User Operations
// ============================================================================

export interface User {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  createdAt: Date;
}

export async function findOrCreateUser(profile: {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}): Promise<User> {
  if (!sql) throw new Error('Database not configured');

  const name = profile.name ?? null;
  const picture = profile.picture ?? null;

  const [user] = await sql`
    INSERT INTO users (id, email, name, picture)
    VALUES (${profile.id}, ${profile.email}, ${name}, ${picture})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      picture = EXCLUDED.picture,
      updated_at = NOW()
    RETURNING *
  `;

  if (!user) throw new Error('Failed to create user');

  return {
    id: user.id as string,
    email: user.email as string,
    name: user.name as string | undefined,
    picture: user.picture as string | undefined,
    createdAt: user.created_at as Date,
  };
}

export async function getUserById(id: string): Promise<User | null> {
  if (!sql) throw new Error('Database not configured');

  const [user] = await sql`SELECT * FROM users WHERE id = ${id}`;
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    createdAt: user.created_at,
  };
}

// ============================================================================
// OAuth Token Operations
// ============================================================================

export interface OAuthToken {
  provider: string;
  accountName: string;
  accessToken?: string;
  refreshToken?: string;
  tokenData?: Record<string, unknown>;
}

export async function saveOAuthToken(
  userId: string,
  token: OAuthToken
): Promise<void> {
  if (!sql) throw new Error('Database not configured');

  const accessToken = token.accessToken ?? null;
  const refreshToken = token.refreshToken ?? null;
  const tokenData = JSON.stringify(token.tokenData || {});

  await sql`
    INSERT INTO oauth_tokens (user_id, provider, account_name, access_token, refresh_token, token_data)
    VALUES (
      ${userId},
      ${token.provider},
      ${token.accountName},
      ${accessToken},
      ${refreshToken},
      ${tokenData}
    )
    ON CONFLICT (user_id, provider, account_name) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_data = EXCLUDED.token_data,
      updated_at = NOW()
  `;
}

export async function getOAuthTokens(
  userId: string,
  provider?: string
): Promise<OAuthToken[]> {
  if (!sql) throw new Error('Database not configured');

  const tokens = provider
    ? await sql`
        SELECT * FROM oauth_tokens
        WHERE user_id = ${userId} AND provider = ${provider}
      `
    : await sql`
        SELECT * FROM oauth_tokens WHERE user_id = ${userId}
      `;

  return tokens.map((t) => ({
    provider: t.provider,
    accountName: t.account_name,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    tokenData: t.token_data,
  }));
}

// ============================================================================
// Memory Operations
// ============================================================================

export interface Memory {
  id: string;
  userId: string;
  type: 'fact' | 'conversation' | 'task' | 'note';
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export async function addMemory(
  userId: string,
  type: Memory['type'],
  content: string,
  tags: string[] = [],
  metadata?: Record<string, unknown>
): Promise<Memory> {
  if (!sql) throw new Error('Database not configured');

  const id = crypto.randomUUID();

  const [row] = await sql`
    INSERT INTO memories (id, user_id, type, content, tags, metadata)
    VALUES (${id}, ${userId}, ${type}, ${content}, ${JSON.stringify(tags)}, ${JSON.stringify(metadata || {})})
    RETURNING *
  `;

  if (!row) throw new Error('Failed to create memory');
  return rowToMemory(row as Record<string, unknown>);
}

export async function searchMemories(
  userId: string,
  query: string,
  options: { type?: Memory['type']; limit?: number } = {}
): Promise<Memory[]> {
  if (!sql) throw new Error('Database not configured');

  const { type, limit = 10 } = options;

  // Use PostgreSQL full-text search
  const rows = type
    ? await sql`
        SELECT *, ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query})) as rank
        FROM memories
        WHERE user_id = ${userId}
          AND type = ${type}
          AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT *, ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query})) as rank
        FROM memories
        WHERE user_id = ${userId}
          AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}
      `;

  return rows.map(row => rowToMemory(row as Record<string, unknown>));
}

export async function listMemories(
  userId: string,
  type: Memory['type'],
  limit = 50
): Promise<Memory[]> {
  if (!sql) throw new Error('Database not configured');

  const rows = await sql`
    SELECT * FROM memories
    WHERE user_id = ${userId} AND type = ${type}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;

  return rows.map(row => rowToMemory(row as Record<string, unknown>));
}

export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  if (!sql) throw new Error('Database not configured');

  const result = await sql`
    DELETE FROM memories
    WHERE id = ${memoryId} AND user_id = ${userId}
  `;

  return result.count > 0;
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as Memory['type'],
    content: row.content as string,
    tags: (row.tags as string[]) || [],
    metadata: row.metadata as Record<string, unknown> | undefined,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
