function mockReply(prompt: string): string {
  const topic = prompt.trim().replace(/\s+/g, ' ').slice(0, 100);
  const text = topic.toLowerCase();

  // This is deliberately a local demo, so responses vary by intent without
  // pretending to know facts that would require an AI model or a web search.
  if (/\b(hi|hello|hey|namaste)\b/.test(text)) {
    return `Hello! Tell me what you would like to work on. This chat can stream a reply and keep your messages safe when the connection drops.`;
  }
  if (/\b(plan|schedule|roadmap|steps|planning)\b/.test(text)) {
    return `Here is a starting plan for “${topic}”. First, write down the result you want and any time or budget limits. Next, choose the smallest useful first step and give it a deadline. Then review what happened, adjust the next step, and repeat. If you share more detail, I can make this mock outline more specific.`;
  }
  if (/\b(bug|error|crash|fix|debug|code|app|react)\b/.test(text)) {
    return `For “${topic}”, start by reproducing the issue and recording the exact error. Check the input, recent changes, and the first failing call. Make one small fix, rerun the failing case, then check nearby behavior. Paste the error or code if you want a more focused mock troubleshooting outline.`;
  }
  if (/\b(write|draft|email|message|letter|caption)\b/.test(text)) {
    return `For “${topic}”, a useful draft starts with the main point, adds only the context the reader needs, and ends with a clear next action. Keep the tone direct and remove repeated phrases. Share the audience and purpose to shape a better draft outline.`;
  }
  if (/\b(compare|choose|better|versus|vs\.?|option)\b/.test(text)) {
    return `To compare “${topic}”, pick three criteria that matter to you, such as cost, time, and ease of use. Score each option against those same criteria, then check the biggest tradeoff before deciding. This local demo has no live product data, so verify current facts separately.`;
  }
  if (/\b(continue|more|next|further|elaborate)\b/.test(text)) {
    return `Continuing from your note, “${topic}”: take the previous idea and turn it into one concrete action. Set a clear finish condition, try it, and use the result to decide the next move. You can also ask for a plan, draft, or troubleshooting outline.`;
  }
  return `You asked about “${topic}”. This is a local streaming demo, so it does not look up facts or call an AI model. I can still help structure the request: tell me the outcome you need, the key constraint, and what you have already tried. I will use that context to build a clearer outline.`;
}

export class OfflineError extends Error {
  constructor() { super('Connection lost during response'); }
}

export function streamMockResponse(
  prompt: string,
  signal: AbortSignal,
  isOnline: () => boolean,
  onToken: (token: string, count: number, elapsedMs: number) => void,
): Promise<void> {
  const words = mockReply(prompt).split(/\s+/);
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
