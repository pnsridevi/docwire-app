// LOCATION: docwire-app/lib/chatLive.ts (NEW FILE)
//
// How Chat finds out about new messages: polling, deliberately kept in
// this ONE file (agreed 22 Oct 2026 — no Supabase-specific live service).
// If polling ever feels too slow, only this file changes (e.g. to a
// WebSocket or Supabase Realtime subscription); the screens just call
// useChatPolling and don't care how the updates arrive.
//
// Polling pauses while the app is in the background (phone) or the
// browser tab is hidden (web), and runs once straight away when the
// person comes back.
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { loadMyChats } from './chat';

// An open chat checks every few seconds; the chat list less often.
export const CHAT_THREAD_POLL_MS = 4000;
export const CHAT_LIST_POLL_MS = 15000;

function isVisibleNow(): boolean {
  if (Platform.OS === 'web') {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }
  return AppState.currentState === 'active';
}

export function useChatPolling(callback: () => unknown, intervalMs: number, enabled = true) {
  // Always call the latest callback without restarting the timer.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let running = false;

    const tick = async () => {
      if (running || !isVisibleNow()) return;
      running = true;
      try {
        await callbackRef.current();
      } finally {
        running = false;
      }
    };

    const timer = setInterval(tick, intervalMs);

    // Catch up as soon as the person returns to the app / tab.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    const onVisibility = () => {
      if (isVisibleNow()) tick();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      clearInterval(timer);
      appStateSub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [intervalMs, enabled]);
}

// Total unread chat messages, for the badge on the Chat tab. Checks
// straight away when switched on, then every CHAT_LIST_POLL_MS. The setter
// lets the Chat screen report the number itself while it's open.
export function useChatUnreadTotal(enabled: boolean): [number, (total: number) => void] {
  const [total, setTotal] = useState(0);

  const refresh = async () => {
    const { data, error } = await loadMyChats();
    if (!error) setTotal(data.reduce((sum, c) => sum + c.unread_count, 0));
  };

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled]);

  useChatPolling(refresh, CHAT_LIST_POLL_MS, enabled);
  return [total, setTotal];
}
