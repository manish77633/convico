import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { addAssistantMessage, addUserMessage, getMessages, getQueue, initDatabase, markDelivered, markPending, markSyncing, THREAD_ID, updateMessage } from './db';
import { mockAcknowledge, OfflineError, streamMockResponse } from './stream';
import type { ChatMessage, StreamMetrics } from './types';

const emptyMetrics: StreamMetrics = {ttftMs: null, tokensPerSecond: 0, tokenCount: 0};
const MAX_STREAM_RETRIES = 2;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StreamMetrics>(emptyMetrics);
  const onlineRef = useRef(false);
  const mounted = useRef(true);
  const processing = useRef(false);
  const activeAbort = useRef<AbortController | null>(null);
  const retryRequested = useRef(false);
  const retryCounts = useRef(new Map<string, number>());
  const messagesRef = useRef<ChatMessage[]>([]);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  const replace = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    if (mounted.current) setMessages(next);
  }, []);
  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    replace(messagesRef.current.map(message => message.id === id ? {...message, ...patch} : message));
  }, [replace]);
  const refresh = useCallback(async () => replace(await getMessages()), [replace]);

  const streamAnswer = useCallback(async (user: ChatMessage, existing?: ChatMessage, requestedAt = user.createdAt): Promise<boolean> => {
    const id = existing?.id ?? Crypto.randomUUID();
    let answer: ChatMessage = existing ? {...existing, content: '', status: 'streaming', error: null} : {
      id, threadId: THREAD_ID, role: 'assistant', content: '', createdAt: Date.now(),
      status: 'streaming', replyToId: user.id, requestId: user.id, error: null,
    };
    try {
      if (existing) await updateMessage(id, answer);
      else await addAssistantMessage(answer);
      if (existing) patchMessage(id, answer);
      else replace([...messagesRef.current, answer]);
      setError(null);
      setMetrics(emptyMetrics);
      const controller = new AbortController();
      activeAbort.current = controller;
      let content = '';
      let firstAt: number | null = null;
      let firstElapsed: number | null = null;
      let lastPaint = 0;
      await streamMockResponse(user.content, controller.signal, () => onlineRef.current, (token, count, elapsed) => {
        content += token;
        if (firstAt === null) { firstAt = Date.now() - requestedAt; firstElapsed = elapsed; }
        const now = performance.now();
        if (now - lastPaint >= 60 || count === 1) {
          lastPaint = now;
          patchMessage(id, {content});
          setMetrics({ttftMs: firstAt, tokenCount: count,
            tokensPerSecond: count > 1 ? (count - 1) / Math.max((elapsed - (firstElapsed ?? elapsed)) / 1000, 0.001) : 0});
        }
      });
      answer = {...answer, content, status: 'delivered'};
      await updateMessage(id, answer);
      patchMessage(id, answer);
      activeAbort.current = null;
      retryCounts.current.delete(id);
      return true;
    } catch (cause) {
      activeAbort.current = null;
      if (!mounted.current) return false;
      const reason = cause instanceof Error ? cause.message : 'Unknown stream error';
      answer = {...answer, content: messagesRef.current.find(item => item.id === id)?.content ?? '',
        status: 'failed', error: reason};
      try { await updateMessage(id, answer); } catch (dbError) { setError(String(dbError)); }
      patchMessage(id, answer);
      if (!(cause instanceof OfflineError)) setError(`Response failed: ${reason}`);
      return false;
    }
  }, [patchMessage, replace]);

  const flush = useCallback(async () => {
    if (!ready || !onlineRef.current || processing.current) return;
    processing.current = true;
    try {
      while (onlineRef.current && mounted.current) {
        const item = (await getQueue())[0];
        if (!item) break;
        if (!onlineRef.current || !mounted.current) break;
        const user = messagesRef.current.find(message => message.id === item.messageId);
        if (!user) { setError('Queue contains a missing message'); break; }
        const controller = new AbortController();
        activeAbort.current = controller;
        try {
          await markSyncing(user.id);
          patchMessage(user.id, {status: 'syncing', error: null});
          await mockAcknowledge(user.id, controller.signal, () => onlineRef.current);
          await markDelivered(user.id);
          patchMessage(user.id, {status: 'delivered'});
          activeAbort.current = null;
          // A delivered user message receives one assistant row keyed by requestId.
          const existing = messagesRef.current.find(message => message.requestId === user.id);
          if (!existing) await streamAnswer(user);
        } catch (cause) {
          activeAbort.current = null;
          const reason = cause instanceof Error ? cause.message : 'Sync failed';
          await markPending(user.id, reason);
          patchMessage(user.id, {status: 'pending', error: reason});
          if (!(cause instanceof OfflineError)) setError(`Sync failed: ${reason}`);
          break; // Maintain chronological order; retry on next connectivity transition/manual retry.
        }
      }
      // A crash between acknowledgement and assistant-row insertion leaves a delivered user row.
      for (const user of messagesRef.current.filter(message => message.role === 'user' && message.status === 'delivered')) {
        if (!onlineRef.current || !mounted.current) break;
        if (!messagesRef.current.some(message => message.requestId === user.id)) await streamAnswer(user);
      }
      // Retry a failed response only after all queued user messages have been delivered.
      while (onlineRef.current && mounted.current) {
        const failed = messagesRef.current.find(message => message.role === 'assistant' && message.status === 'failed'
          && (retryCounts.current.get(message.id) ?? 0) < MAX_STREAM_RETRIES);
        if (!failed?.requestId) break;
        const original = messagesRef.current.find(message => message.id === failed.requestId);
        if (!original) break;
        retryCounts.current.set(failed.id, (retryCounts.current.get(failed.id) ?? 0) + 1);
        if (await streamAnswer(original, failed, Date.now())) continue;
        if (!onlineRef.current) break;
      }
    } catch (cause) { setError(`Queue error: ${String(cause)}`); }
    finally {
      processing.current = false;
      if (retryRequested.current && onlineRef.current) {
        retryRequested.current = false;
        setTimeout(() => { void flushRef.current?.(); }, 0);
      }
    }
  }, [patchMessage, ready, streamAnswer]);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void (async () => {
      try {
        await initDatabase();
        if (disposed) return;
        await refresh();
        if (!disposed) setReady(true);
      } catch (cause) { if (!disposed) setError(`Database error: ${String(cause)}`); }
    })();
    const subscription = NetInfo.addEventListener(state => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      onlineRef.current = connected;
      setOnline(connected);
      if (connected && processing.current) retryRequested.current = true;
      if (!connected) activeAbort.current?.abort();
    });
    return () => { disposed = true; mounted.current = false; subscription(); activeAbort.current?.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!online || !ready) return;
    const timer = setTimeout(() => { void flush(); }, 0);
    return () => clearTimeout(timer);
  }, [online, ready, flush]);

  const send = useCallback(async (input: string, replyToId: string | null): Promise<boolean> => {
    const content = input.trim();
    if (!content || !ready) return false;
    const message: ChatMessage = {
      id: Crypto.randomUUID(), threadId: THREAD_ID, role: 'user', content, createdAt: Date.now(),
      status: 'pending', replyToId, requestId: null, error: null,
    };
    try {
      await addUserMessage(message);
      replace([...messagesRef.current, message]);
      setError(null);
      if (onlineRef.current) {
        if (processing.current) retryRequested.current = true;
        else void flush();
      }
      return true;
    } catch (cause) { setError(`Could not save message: ${String(cause)}`); return false; }
  }, [flush, ready, replace]);

  const retry = useCallback(async (message: ChatMessage) => {
    if (!onlineRef.current) { setError('Reconnect to retry'); return; }
    if (message.role === 'user') { setError(null); if (processing.current) retryRequested.current = true; else void flush(); return; }
    if (message.status !== 'failed' || !message.requestId) return;
    const count = retryCounts.current.get(message.id) ?? 0;
    if (count >= MAX_STREAM_RETRIES) { setError('Automatic retry limit reached. Tap again to retry manually.'); retryCounts.current.set(message.id, 0); return; }
    const user = messagesRef.current.find(item => item.id === message.requestId);
    if (!user) { setError('Original message is missing'); return; }
    retryCounts.current.set(message.id, count + 1);
    if (processing.current) { setError('Wait for the current response to finish'); return; }
    processing.current = true;
    try { await streamAnswer(user, message, Date.now()); } finally { processing.current = false; }
  }, [flush, streamAnswer]);

  return {messages, online, ready, error, metrics, send, retry, clearError: () => setError(null)};
}
