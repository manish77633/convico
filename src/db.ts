import * as SQLite from 'expo-sqlite';
import type { ChatMessage, QueueItem } from './types';

const database = SQLite.openDatabaseAsync('convico-chat.db');
export const THREAD_ID = 'main';

export async function initDatabase(): Promise<void> {
  const db = await database;
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL,
      reply_to_id TEXT, request_id TEXT, error TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_order ON messages(thread_id, created_at, id);
    CREATE TABLE IF NOT EXISTS sync_queue (
      message_id TEXT PRIMARY KEY REFERENCES messages(id), created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );`);
  // An interrupted sync is safe to resume with the same stable ID.
  await db.runAsync("UPDATE messages SET status = 'pending' WHERE status = 'syncing'");
  await db.runAsync("UPDATE messages SET status = 'failed', error = 'Stream interrupted; tap to retry' WHERE status = 'streaming'");
}

export async function getMessages(): Promise<ChatMessage[]> {
  const db = await database;
  const rows = await db.getAllAsync<{
    id: string; thread_id: string; role: ChatMessage['role']; content: string;
    created_at: number; status: ChatMessage['status']; reply_to_id: string | null;
    request_id: string | null; error: string | null;
  }>('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at, id', THREAD_ID);
  return rows.map(row => ({ id: row.id, threadId: row.thread_id, role: row.role,
    content: row.content, createdAt: row.created_at, status: row.status,
    replyToId: row.reply_to_id, requestId: row.request_id, error: row.error }));
}

export async function addUserMessage(message: ChatMessage): Promise<void> {
  const db = await database;
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      message.id, message.threadId, message.role, message.content, message.createdAt,
      message.status, message.replyToId, message.requestId, message.error);
    await db.runAsync('INSERT INTO sync_queue(message_id, created_at) VALUES (?, ?)',
      message.id, message.createdAt);
  });
}

export async function addAssistantMessage(message: ChatMessage): Promise<void> {
  const db = await database;
  await db.runAsync('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    message.id, message.threadId, message.role, message.content, message.createdAt,
    message.status, message.replyToId, message.requestId, message.error);
}

export async function updateMessage(id: string, changes: Pick<ChatMessage, 'content' | 'status' | 'error'>): Promise<void> {
  const db = await database;
  await db.runAsync('UPDATE messages SET content = ?, status = ?, error = ? WHERE id = ?',
    changes.content, changes.status, changes.error, id);
}

export async function getQueue(): Promise<QueueItem[]> {
  const db = await database;
  const rows = await db.getAllAsync<{message_id: string; created_at: number; attempts: number}>(
    'SELECT * FROM sync_queue ORDER BY created_at, rowid');
  return rows.map(row => ({messageId: row.message_id, createdAt: row.created_at, attempts: row.attempts}));
}

export async function markSyncing(id: string): Promise<void> {
  const db = await database;
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE sync_queue SET attempts = attempts + 1 WHERE message_id = ?', id);
    await db.runAsync("UPDATE messages SET status = 'syncing', error = NULL WHERE id = ?", id);
  });
}

export async function markDelivered(id: string): Promise<void> {
  const db = await database;
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE messages SET status = 'delivered', error = NULL WHERE id = ?", id);
    await db.runAsync('DELETE FROM sync_queue WHERE message_id = ?', id);
  });
}

export async function markPending(id: string, error: string | null = null): Promise<void> {
  const db = await database;
  await db.runAsync("UPDATE messages SET status = 'pending', error = ? WHERE id = ?", error, id);
}
