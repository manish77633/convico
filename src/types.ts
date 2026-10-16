export type Role = 'user' | 'assistant';
export type MessageStatus = 'pending' | 'syncing' | 'delivered' | 'streaming' | 'failed';

export interface ChatMessage {
  id: string;
  threadId: string;
  role: Role;
  content: string;
  createdAt: number;
  status: MessageStatus;
  replyToId: string | null;
  requestId: string | null;
  error: string | null;
  kind?: 'text' | 'audio';
  audioUri?: string | null;
  audioDurationMs?: number | null;
  audioWaveform?: number[] | null;
}

export interface QueueItem {
  messageId: string;
  createdAt: number;
  attempts: number;
}

export interface StreamMetrics {
  ttftMs: number | null;
  tokensPerSecond: number;
  tokenCount: number;
}
