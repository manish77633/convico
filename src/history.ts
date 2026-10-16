import type { ChatMessage } from './types';

export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareMessages);
}
