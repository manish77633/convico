const SCRIPT = `I can help break this into a clear plan. First, define the goal and the constraints that matter most. Next, choose one small step you can complete today. Keep the result visible, gather feedback, and adjust. For this demo, each word arrives as a separate token so you can watch the response grow while the chat remains interactive. A reliable assistant should also preserve messages offline and resume queued work when the connection returns.`;

export class OfflineError extends Error {
  constructor() { super('Connection lost during response'); }
}

export async function streamMockResponse(
  prompt: string,
  signal: AbortSignal,
  isOnline: () => boolean,
  onToken: (token: string, count: number, elapsedMs: number) => void,
): Promise<void> {
  const words = `${SCRIPT} Your message was: ${prompt.slice(0, 120)}.`.split(/\s+/);
  const start = performance.now();
  for (let index = 0; index < words.length; index += 1) {
    if (signal.aborted) throw new Error('Stream cancelled');
    if (!isOnline()) throw new OfflineError();
    // One token every 25 ms targets 40 tokens/sec. Timer scheduling may vary by device.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 25);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Stream cancelled')); }, {once: true});
    });
    if (!isOnline()) throw new OfflineError();
    onToken(`${index === 0 ? '' : ' '}${words[index]}`, index + 1, performance.now() - start);
  }
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
