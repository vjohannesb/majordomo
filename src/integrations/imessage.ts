/**
 * iMessage Integration
 *
 * Uses AppleScript to send messages and reads from the local Messages database.
 * Only works on macOS with Messages app configured.
 *
 * Requirements:
 * - macOS
 * - Messages app signed into iMessage
 * - Full Disk Access permission for terminal (to read chat.db)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const execAsync = promisify(exec);

// Path to Messages database
const CHAT_DB_PATH = join(homedir(), 'Library', 'Messages', 'chat.db');

export interface IMessageContact {
  id: string;
  displayName?: string;
}

export interface IMessage {
  id: number;
  text: string;
  date: Date;
  isFromMe: boolean;
  sender: string;
  chatId: string;
}

/**
 * Check if iMessage is available (macOS only)
 */
export function isIMessageAvailable(): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }
  return existsSync(CHAT_DB_PATH);
}

/**
 * Send an iMessage via AppleScript
 */
export async function sendIMessage(recipient: string, message: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('iMessage is only available on macOS');
  }

  // Escape special characters for AppleScript
  const escapedMessage = message.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
  const escapedRecipient = recipient.replace(/"/g, '\\"');

  const script = `
    tell application "Messages"
      set targetService to 1st account whose service type = iMessage
      set targetBuddy to participant "${escapedRecipient}" of targetService
      send "${escapedMessage}" to targetBuddy
    end tell
  `;

  try {
    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  } catch (err) {
    // Try alternative method using buddy by ID
    const altScript = `
      tell application "Messages"
        send "${escapedMessage}" to buddy "${escapedRecipient}"
      end tell
    `;
    try {
      await execAsync(`osascript -e '${altScript.replace(/'/g, "'\\''")}'`);
    } catch {
      throw new Error(`Failed to send iMessage: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Read recent messages from the Messages database
 */
export async function readRecentMessages(limit = 20): Promise<IMessage[]> {
  if (!isIMessageAvailable()) {
    throw new Error('iMessage database not available. Are you on macOS with Messages configured?');
  }

  try {
    const db = new Database(CHAT_DB_PATH, { readonly: true });

    const query = `
      SELECT
        m.ROWID as id,
        m.text,
        m.date / 1000000000 + 978307200 as timestamp,
        m.is_from_me as isFromMe,
        COALESCE(h.id, 'unknown') as sender,
        c.chat_identifier as chatId
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.text IS NOT NULL AND m.text != ''
      ORDER BY m.date DESC
      LIMIT ?
    `;

    const rows = db.prepare(query).all(limit) as Array<{
      id: number;
      text: string;
      timestamp: number;
      isFromMe: number;
      sender: string;
      chatId: string;
    }>;

    db.close();

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      date: new Date(row.timestamp * 1000),
      isFromMe: row.isFromMe === 1,
      sender: row.sender,
      chatId: row.chatId || 'unknown',
    }));
  } catch (err) {
    throw new Error(
      `Failed to read Messages database. You may need to grant Full Disk Access to your terminal. Error: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * Read messages from a specific contact
 */
export async function readMessagesFrom(contact: string, limit = 10): Promise<IMessage[]> {
  if (!isIMessageAvailable()) {
    throw new Error('iMessage database not available');
  }

  try {
    const db = new Database(CHAT_DB_PATH, { readonly: true });

    const query = `
      SELECT
        m.ROWID as id,
        m.text,
        m.date / 1000000000 + 978307200 as timestamp,
        m.is_from_me as isFromMe,
        COALESCE(h.id, 'unknown') as sender,
        c.chat_identifier as chatId
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.text IS NOT NULL
        AND m.text != ''
        AND (
          h.id LIKE ?
          OR c.chat_identifier LIKE ?
          OR c.display_name LIKE ?
        )
      ORDER BY m.date DESC
      LIMIT ?
    `;

    const searchPattern = `%${contact}%`;
    const rows = db.prepare(query).all(searchPattern, searchPattern, searchPattern, limit) as Array<{
      id: number;
      text: string;
      timestamp: number;
      isFromMe: number;
      sender: string;
      chatId: string;
    }>;

    db.close();

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      date: new Date(row.timestamp * 1000),
      isFromMe: row.isFromMe === 1,
      sender: row.sender,
      chatId: row.chatId || 'unknown',
    }));
  } catch (err) {
    throw new Error(`Failed to read messages: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * List recent conversations
 */
export async function listConversations(limit = 20): Promise<Array<{ chatId: string; displayName?: string; lastMessage: Date }>> {
  if (!isIMessageAvailable()) {
    throw new Error('iMessage database not available');
  }

  try {
    const db = new Database(CHAT_DB_PATH, { readonly: true });

    const query = `
      SELECT
        c.chat_identifier as chatId,
        c.display_name as displayName,
        MAX(m.date) / 1000000000 + 978307200 as lastTimestamp
      FROM chat c
      LEFT JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
      LEFT JOIN message m ON cmj.message_id = m.ROWID
      GROUP BY c.ROWID
      ORDER BY lastTimestamp DESC
      LIMIT ?
    `;

    const rows = db.prepare(query).all(limit) as Array<{
      chatId: string;
      displayName: string | null;
      lastTimestamp: number;
    }>;

    db.close();

    return rows.map((row) => ({
      chatId: row.chatId,
      displayName: row.displayName || undefined,
      lastMessage: new Date(row.lastTimestamp * 1000),
    }));
  } catch (err) {
    throw new Error(`Failed to list conversations: ${err instanceof Error ? err.message : err}`);
  }
}
