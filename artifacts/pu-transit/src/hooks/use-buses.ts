import { useCallback, useEffect, useRef, useState } from 'react';
import { storage, type Bus } from '@/lib/storage';

export function useBuses() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const requestSignal = useRef<AbortSignal | null>(null);

  const fetchBuses = useCallback(async (signal?: AbortSignal) => {
    const request = ++latestRequest.current;
    try {
      const data = await storage.getBuses(signal);
      if (signal?.aborted || request !== latestRequest.current) return;
      setBuses(data ?? []);
      setError(null);
    } catch (e) {
      if (signal?.aborted || request !== latestRequest.current || (e instanceof Error && e.name === 'AbortError')) return;
      // Keep the last good labels visible while making the refresh failure explicit.
      setError(e instanceof Error ? e.message : 'bus labels could not load');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requestSignal.current = controller.signal;
    fetchBuses(controller.signal);
    // Bus labels can be edited by an admin; keep the rider view fresh.
    const interval = setInterval(() => fetchBuses(controller.signal), 10000);
    return () => {
      clearInterval(interval);
      controller.abort();
      latestRequest.current++;
    };
  }, [fetchBuses]);

  return { buses, error, refresh: () => fetchBuses(requestSignal.current ?? undefined) };
}