import { mergeMessages } from './history';
import type { ChatMessage } from './types';

function message(id: string, createdAt: number, content = id): ChatMessage {
  return {id, createdAt, content, role: 'user', threadId: 'main', status: 'delivered',
    replyToId: null, requestId: null, error: null};
}

describe('paged history merging', () => {
  it('keeps keyset page boundaries ordered and deduplicated', () => {
    const current = [message('c', 2), message('d', 3)];
    const older = [message('a', 1), message('b', 2), message('c', 2, 'updated')];
    const merged = mergeMessages(current, older);
    expect(merged.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(merged[2].content).toBe('updated');
  });
});
