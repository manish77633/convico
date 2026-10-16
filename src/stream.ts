import { createMockReply } from './reply';

export class OfflineError extends Error {
  constructor() { super('Connection lost during response'); }
}

export function streamMockResponse(
  prompt: string,
  signal: AbortSignal,
  isOnline: () => boolean,
  onToken: (token: string, count: number, elapsedMs: number) => void,
): Promise<void> {
  // Keep the whitespace before each word, so short numbered lists stay readable.
  const words = createMockReply(prompt).match(/\s*\S+/g) ?? [];
  return new Promise<void>((resolve, reject) => {
    const start = performance.now();
    let index = 0;
    let timer: ReturnType<typeof setInterval>;
    const finish = (error?: Error) => {
      clearInterval(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(isOnline() ? new Error('Stream cancelled') : new OfflineError());
    if (signal.aborted) { reject(new Error('Stream cancelled')); return; }
    if (!isOnline()) { reject(new OfflineError()); return; }
    signal.addEventListener('abort', abort, {once: true});
    // One timer catches up after busy JS frames while preserving the 22 ms token clock.
    timer = setInterval(() => {
      if (!isOnline()) { finish(new OfflineError()); return; }
      const elapsed = performance.now() - start;
      const due = Math.min(words.length, Math.floor(elapsed / 22));
      try {
        while (index < due) {
          onToken(words[index], index + 1, elapsed);
          index += 1;
        }
      } catch (cause) { finish(cause instanceof Error ? cause : new Error(String(cause))); return; }
      if (index === words.length) finish();
    }, 16);
  });
}

export async function mockAcknowledge(id: string, signal: AbortSignal, isOnline: () => boolean): Promise<string> {
  if (!isOnline()) throw new OfflineError();
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Sync cancelled')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('Sync cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 180);
    signal.addEventListener('abort', abort, {once: true});
  });
  if (!isOnline()) throw new OfflineError();
  return id; // Stable ID is the simulated server's idempotency key.
}
