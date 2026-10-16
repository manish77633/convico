import { createMockReply } from './reply';
import { OfflineError, streamMockResponse } from './stream';

describe('mock streaming state', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('emits ordered tokens at about 45 per second and preserves line breaks', async () => {
    const parts: string[] = [];
    const counts: number[] = [];
    const promise = streamMockResponse('Make a plan', new AbortController().signal, () => true,
      (token, count) => { parts.push(token); counts.push(count); });
    jest.advanceTimersByTime(500);
    expect(parts.length).toBeGreaterThanOrEqual(20);
    expect(parts.length).toBeLessThanOrEqual(23);
    jest.runAllTimers();
    await promise;
    expect(parts.join('')).toBe(createMockReply('Make a plan'));
    expect(counts).toEqual(counts.map((_, index) => index + 1));
  });

  it('stops after a network drop without adding more tokens', async () => {
    let online = true;
    const parts: string[] = [];
    const promise = streamMockResponse('Fix a bug', new AbortController().signal, () => online,
      token => { parts.push(token); });
    const rejection = expect(promise).rejects.toBeInstanceOf(OfflineError);
    jest.advanceTimersByTime(176);
    const beforeDrop = parts.length;
    expect(beforeDrop).toBeGreaterThan(0);
    online = false;
    jest.advanceTimersByTime(32);
    await rejection;
    expect(parts).toHaveLength(beforeDrop);
  });

  it('cancels an online stream when aborted', async () => {
    const controller = new AbortController();
    const promise = streamMockResponse('Write an email', controller.signal, () => true, () => undefined);
    const rejection = expect(promise).rejects.toThrow('Stream cancelled');
    controller.abort();
    await rejection;
  });
});
