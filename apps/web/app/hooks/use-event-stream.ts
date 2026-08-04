"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type StreamState<T> = {
  events: T[];
  connected: boolean;
};

export function useEventStream<T>(url: string, maxEvents = 100): StreamState<T> {
  const [events, setEvents] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef(1_000);
  const timerRef = useRef<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const safeMax = useMemo(() => Math.max(10, maxEvents), [maxEvents]);

  useEffect(() => {
    let cancelled = false;

    const connect = (): void => {
      if (cancelled) {
        return;
      }

      const source = new EventSource(url);
      sourceRef.current = source;

      source.onopen = () => {
        setConnected(true);
        retryRef.current = 1_000;
      };

      source.onerror = () => {
        setConnected(false);
        source.close();

        const nextDelay = retryRef.current;
        retryRef.current = Math.min(retryRef.current * 2, 30_000);

        timerRef.current = window.setTimeout(connect, nextDelay);
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as T;
          setEvents((prev) => [payload, ...prev].slice(0, safeMax));
        } catch (error) {
          console.error("Invalid SSE payload", error);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.close();
      }
    };
  }, [safeMax, url]);

  return {
    events,
    connected
  };
}
