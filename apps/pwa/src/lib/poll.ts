import { useEffect, useRef, useState } from "react";
import { ApiError, get } from "./api";

export interface PollState {
  unreadNotifications: number;
  latestNotificationId: number;
  changeCursor: number;
}

/**
 * Live updates without WebSockets: asks the server every 15 s (slower when the tab
 * is hidden, paused when offline). Screens re-load when `changeCursor` moves.
 */
export function usePoll(enabled: boolean, onLostAccess?: () => void, intervalMs = 15_000): PollState | null {
  const [state, setState] = useState<PollState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      if (stopped) return;
      if (navigator.onLine) {
        try {
          const s = await get<PollState>("/poll");
          setState((old) => (old && old.changeCursor === s.changeCursor && old.unreadNotifications === s.unreadNotifications ? old : s));
          failures = 0;
        } catch (e) {
          // Access removed (disabled, removed from team, business suspended).
          if (e instanceof ApiError && e.status === 403) onLostAccess?.();
          failures = Math.min(failures + 1, 4);
        }
      }
      const base = document.hidden ? intervalMs * 4 : intervalMs;
      timer.current = window.setTimeout(tick, base * 2 ** failures);
    };
    tick();
    const onVisible = () => {
      if (!document.hidden) {
        window.clearTimeout(timer.current);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs]);

  return state;
}
