const SCRIPT = `I can help break this into a clear plan. First, define the goal and the constraints that matter most. Next, choose one small step you can complete today. Keep the result visible, gather feedback, and adjust. For this demo, each word arrives as a separate token so you can watch the response grow while the chat remains interactive. A reliable assistant should also preserve messages offline and resume queued work when the connection returns.`;

export class OfflineError extends Error {
  constructor() { super('Connection lost during response'); }
}

export function streamMockResponse(
  prompt: string,
  signal: AbortSignal,
  isOnline: () => boolean,
  onToken: (token: string, count: number, elapsedMs: number) => void,
): Promise<void> {
  const words = `${SCRIPT} Your message was: ${prompt.slice(0, 120)}.`.split(/\s+/);
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
          onToken(`${index === 0 ? '' : ' '}${words[index]}`, index + 1, elapsed);
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
    const timer = setTimeout(resolve, 180);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Sync cancelled')); }, {once: true});
  });
  if (!isOnline()) throw new OfflineError();
  return id; // Stable ID is the simulated server's idempotency key.
}
