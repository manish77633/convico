import * as SQLite from 'expo-sqlite';
import type { ChatMessage, QueueItem } from './types';

const database = SQLite.openDatabaseAsync('convico-chat.db');
export const THREAD_ID = 'main';
export const HISTORY_PAGE_SIZE = 64;
export type MessageCursor = Pick<ChatMessage, 'createdAt' | 'id'>;
type MessageRow = {
  id: string; thread_id: string; role: ChatMessage['role']; content: string;
  created_at: number; status: ChatMessage['status']; reply_to_id: string | null;
  request_id: string | null; error: string | null;
  kind: 'text' | 'audio'; audio_uri: string | null; audio_duration_ms: number | null; audio_waveform: string | null; audio_token: string | null;
};
let writeChain: Promise<void> = Promise.resolve();

function fromRow(row: MessageRow): ChatMessage {
  return {id: row.id, threadId: row.thread_id, role: row.role, content: row.content,
    createdAt: row.created_at, status: row.status, replyToId: row.reply_to_id,
    requestId: row.request_id, error: row.error, kind: row.kind ?? 'text',
    audioUri: row.audio_uri, audioDurationMs: row.audio_duration_ms,
    audioWaveform: row.audio_waveform ? JSON.parse(row.audio_waveform) as number[] : null,
    audioToken: row.audio_token ?? null};
}

function serializedWrite(task: () => Promise<void>): Promise<void> {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);
  return next;
}

export async function initDatabase(): Promise<void> {
  const db = await database;
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL,
      reply_to_id TEXT, request_id TEXT, error TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_order ON messages(thread_id, created_at, id);
    CREATE INDEX IF NOT EXISTS messages_request ON messages(request_id);
    CREATE INDEX IF NOT EXISTS messages_status ON messages(thread_id, role, status, created_at);
    CREATE TABLE IF NOT EXISTS sync_queue (
      message_id TEXT PRIMARY KEY REFERENCES messages(id), created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sync_queue_order ON sync_queue(created_at, message_id);`);
  const columns = await db.getAllAsync<{name: string}>('PRAGMA table_info(messages)');
  for (const [name, declaration] of [
    ['kind', "TEXT NOT NULL DEFAULT 'text'"], ['audio_uri', 'TEXT'],
    ['audio_duration_ms', 'INTEGER'], ['audio_waveform', 'TEXT'], ['audio_token','TEXT'],
  ] as const) {
    if (!columns.some(column => column.name === name)) await db.execAsync(`ALTER TABLE messages ADD COLUMN ${name} ${declaration}`);
  }
  // An interrupted sync is safe to resume with the same stable ID.
  await db.runAsync("UPDATE messages SET status = 'pending' WHERE status = 'syncing'");
  await db.runAsync("UPDATE messages SET status = 'failed', error = 'Stream interrupted; tap to retry' WHERE status = 'streaming'");
}

export async function getMessagesPage(before?: MessageCursor, limit = HISTORY_PAGE_SIZE): Promise<{messages: ChatMessage[]; hasOlder: boolean}> {
  const db = await database;
  const pageSize = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = before
    ? await db.getAllAsync<MessageRow>(`SELECT * FROM messages WHERE thread_id = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT ?`, THREAD_ID, before.createdAt, before.createdAt, before.id, pageSize + 1)
    : await db.getAllAsync<MessageRow>(
      'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', THREAD_ID, pageSize + 1);
  return {messages: rows.slice(0, pageSize).reverse().map(fromRow), hasOlder: rows.length > pageSize};
}

export async function getMessageById(id: string): Promise<ChatMessage | null> {
  const db = await database;
  const row = await db.getFirstAsync<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export async function getAssistantForRequest(id: string): Promise<ChatMessage | null> {
  const db = await database;
  const row = await db.getFirstAsync<MessageRow>(
    "SELECT * FROM messages WHERE request_id = ? AND role = 'assistant' LIMIT 1", id);
  return row ? fromRow(row) : null;
}

export async function getUsersMissingAssistant(): Promise<ChatMessage[]> {
  const db = await database;
  const rows = await db.getAllAsync<MessageRow>(`SELECT user.* FROM messages AS user
    WHERE user.thread_id = ? AND user.role = 'user' AND user.status = 'delivered'
      AND user.kind = 'text'
      AND NOT EXISTS (SELECT 1 FROM messages AS answer WHERE answer.request_id = user.id AND answer.role = 'assistant')
    ORDER BY user.created_at, user.id`, THREAD_ID);
  return rows.map(fromRow);
}

export async function getFailedAssistants(): Promise<ChatMessage[]> {
  const db = await database;
  const rows = await db.getAllAsync<MessageRow>(`SELECT * FROM messages
    WHERE thread_id = ? AND role = 'assistant' AND status = 'failed'
    ORDER BY created_at, id`, THREAD_ID);
  return rows.map(fromRow);
}

export async function addUserMessage(message: ChatMessage): Promise<void> {
  const db = await database;
  await serializedWrite(() => db.withExclusiveTransactionAsync(async txn => {
    await txn.runAsync('INSERT INTO messages (id, thread_id, role, content, created_at, status, reply_to_id, request_id, error, kind, audio_uri, audio_duration_ms, audio_waveform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      message.id, message.threadId, message.role, message.content, message.createdAt,
      message.status, message.replyToId, message.requestId, message.error,
      message.kind ?? 'text', message.audioUri ?? null, message.audioDurationMs ?? null,
      message.audioWaveform ? JSON.stringify(message.audioWaveform) : null);
    await txn.runAsync('INSERT INTO sync_queue(message_id, created_at) VALUES (?, ?)',
      message.id, message.createdAt);
  }));
}

export async function addAssistantMessage(message: ChatMessage): Promise<void> {
  const db = await database;
  await serializedWrite(async () => { await db.runAsync('INSERT INTO messages (id, thread_id, role, content, created_at, status, reply_to_id, request_id, error, audio_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    message.id, message.threadId, message.role, message.content, message.createdAt,
    message.status, message.replyToId, message.requestId, message.error, message.audioToken ?? null); });
}

export async function updateMessage(id: string, changes: Pick<ChatMessage, 'content' | 'status' | 'error'>): Promise<void> {
  const db = await database;
  await serializedWrite(async () => { await db.runAsync('UPDATE messages SET content = ?, status = ?, error = ? WHERE id = ?',
    changes.content, changes.status, changes.error, id); });
}

export async function setAssistantAudio(id:string, uri:string):Promise<void> {
  const db=await database;
  await serializedWrite(async()=>{await db.runAsync("UPDATE messages SET audio_uri = ? WHERE id = ? AND role = 'assistant'",uri,id);});
}

export async function setAssistantToken(id:string, token:string|null):Promise<void> {
  const db=await database;
  await serializedWrite(async()=>{await db.runAsync("UPDATE messages SET audio_token = ? WHERE id = ? AND role = 'assistant'",token,id);});
}

export async function getQueue(): Promise<QueueItem[]> {
  const db = await database;
  const rows = await db.getAllAsync<{message_id: string; created_at: number; attempts: number}>(
    'SELECT * FROM sync_queue ORDER BY created_at, rowid');
  return rows.map(row => ({messageId: row.message_id, createdAt: row.created_at, attempts: row.attempts}));
}

export async function getNextQueueItem(): Promise<QueueItem | null> {
  const db = await database;
  const row = await db.getFirstAsync<{message_id: string; created_at: number; attempts: number}>(
    'SELECT * FROM sync_queue ORDER BY created_at, rowid LIMIT 1');
  return row ? {messageId: row.message_id, createdAt: row.created_at, attempts: row.attempts} : null;
}

/** Debug-only fixture; never called by the release UI. */
export async function seedBenchmarkMessages(count = 5000): Promise<void> {
  if (!__DEV__) return;
  const db = await database;
  await serializedWrite(() => db.withExclusiveTransactionAsync(async txn => {
    for (let start = 0; start < count / 2; start += 125) {
      const statements: string[] = [];
      for (let pair = start; pair < Math.min(start + 125, count / 2); pair++) {
        const userId = `bench-user-${String(pair).padStart(5, '0')}`;
        const answerId = `bench-answer-${String(pair).padStart(5, '0')}`;
        const created = 1700000000000 + pair * 2;
        statements.push(`INSERT OR IGNORE INTO messages (id, thread_id, role, content, created_at, status, reply_to_id, request_id, error) VALUES ('${userId}', 'main', 'user', 'Test prompt ${pair}: make a plan for this week.', ${created}, 'delivered', NULL, NULL, NULL);`);
        statements.push(`INSERT OR IGNORE INTO messages (id, thread_id, role, content, created_at, status, reply_to_id, request_id, error) VALUES ('${answerId}', 'main', 'assistant', 'Start with one clear goal. Choose a small step, try it, and review the result.', ${created + 1}, 'delivered', '${userId}', '${userId}', NULL);`);
      }
      await txn.execAsync(statements.join('\n'));
    }
  }));
}

export async function markSyncing(id: string): Promise<void> {
  const db = await database;
  await serializedWrite(() => db.withExclusiveTransactionAsync(async txn => {
    await txn.runAsync('UPDATE sync_queue SET attempts = attempts + 1 WHERE message_id = ?', id);
    await txn.runAsync("UPDATE messages SET status = 'syncing', error = NULL WHERE id = ?", id);
  }));
}

export async function markDelivered(id: string): Promise<void> {
  const db = await database;
  await serializedWrite(() => db.withExclusiveTransactionAsync(async txn => {
    await txn.runAsync("UPDATE messages SET status = 'delivered', error = NULL WHERE id = ?", id);
    await txn.runAsync('DELETE FROM sync_queue WHERE message_id = ?', id);
  }));
}

export async function markPending(id: string, error: string | null = null): Promise<void> {
  const db = await database;
  await serializedWrite(async () => { await db.runAsync("UPDATE messages SET status = 'pending', error = ? WHERE id = ?", error, id); });
}
