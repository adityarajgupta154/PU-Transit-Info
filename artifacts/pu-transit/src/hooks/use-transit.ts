import { useState, useEffect, useCallback, useRef } from 'react';
import { storage, type Route, type RouteVersion } from '@/lib/storage';
import type { LiveTrackingFeed } from '@workspace/api-client-react';
import { calculateAgedStatus } from '@/lib/status-aging';

export function useRoutes() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const requestSignal = useRef<AbortSignal | null>(null);

  const fetchRoutes = useCallback(async (signal?: AbortSignal) => {
    const request = ++latestRequest.current;
    try {
      const data = await storage.getRoutes(signal);
      if (signal?.aborted || request !== latestRequest.current) return;
      setRoutes(data);
      setError(null);
    } catch (e: any) {
      if (signal?.aborted || request !== latestRequest.current || e.name === 'AbortError') return;
      setError(e.message);
      setRoutes([]);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requestSignal.current = controller.signal;
    fetchRoutes(controller.signal);
    // Poll every 10 seconds for route updates
    const interval = setInterval(() => fetchRoutes(controller.signal), 10000);
    return () => {
      clearInterval(interval);
      controller.abort();
      latestRequest.current++;
    };
  }, [fetchRoutes]);

  return { routes, error, refresh: () => fetchRoutes(requestSignal.current ?? undefined) };
}

export type AgedTrackingStatus = {
  feed: LiveTrackingFeed | null;
  status: LiveTrackingFeed['status'] | null;
  error: string | null;
  /** performance.now() when `feed` was received; lets views age timestamps against feed.serverTime. */
  receivedAt: number | null;
};

const EMPTY_STATUS: AgedTrackingStatus = { feed: null, status: null, error: null, receivedAt: null };

/** RTE-02: fetch one pinned route version; versions never change, so no polling. */
export function useRouteVersion(routeId: string | null, n: number | null) {
  const key = routeId && n ? `${routeId}/${n}` : null;
  const [state, setState] = useState<{ key: string; version: RouteVersion | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!routeId || !n) return;
    const controller = new AbortController();
    storage
      .getRouteVersion(routeId, n, controller.signal)
      .then((version) => setState({ key: `${routeId}/${n}`, version, error: null }))
      .catch((e: Error) => {
        if (!controller.signal.aborted) setState({ key: `${routeId}/${n}`, version: null, error: e.message });
      });
    return () => controller.abort();
  }, [routeId, n]);

  const current = key && state?.key === key ? state : null;
  return { version: current?.version ?? null, error: current?.error ?? null };
}

export function useTrackingFeed(busId: string | null) {
  const [state, setState] = useState<AgedTrackingStatus & { busId?: string | null }>(EMPTY_STATUS);
  const latestRequest = useRef(0);
  const requestSignal = useRef<AbortSignal | null>(null);

  // Track last known good data to age it
  const currentData = useRef<{ feed: LiveTrackingFeed; receivedAt: number } | null>(null);

  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    const request = ++latestRequest.current;
    if (!busId) {
      setState(prev => prev.feed ? EMPTY_STATUS : prev);
      currentData.current = null;
      return;
    }
    try {
      const data = await storage.getTrackingFeed(busId, signal);
      if (signal?.aborted || request !== latestRequest.current) return;

      if (data) {
        const receivedAt = performance.now();
        currentData.current = { feed: data, receivedAt };
        setState({ feed: data, status: data.status, error: null, receivedAt, busId });
      } else {
        currentData.current = null;
        setState(EMPTY_STATUS);
      }
    } catch (e: any) {
      if (signal?.aborted || request !== latestRequest.current || e.name === 'AbortError') return;
      // IDN-02: 403 = this account may no longer read the feed; drop the protected state now, don't age it out.
      if (e.status === 403) {
        currentData.current = null;
        setState({ ...EMPTY_STATUS, error: e.message });
        return;
      }
      setState(prev => ({ ...prev, error: e.message }));
      // Do not clear the feed, let the aging logic downgrade it to offline if it fails too long
    }
  }, [busId]);

  useEffect(() => {
    const controller = new AbortController();
    requestSignal.current = controller.signal;

    currentData.current = null;
    setState(EMPTY_STATUS);
    fetchStatus(controller.signal);

    const interval = setInterval(() => fetchStatus(controller.signal), 5000);
    return () => {
      clearInterval(interval);
      controller.abort();
      latestRequest.current++;
    };
  }, [fetchStatus]);

  // Aging loop
  useEffect(() => {
    const tick = () => {
      if (!currentData.current) return;

      const { feed, receivedAt } = currentData.current;
      const newStatus = calculateAgedStatus(feed, receivedAt, performance.now());

      setState(prev => {
        if (prev.status !== newStatus) {
          return { ...prev, status: newStatus };
        }
        return prev;
      });
    };

    const agingInterval = setInterval(tick, 1000);
    return () => clearInterval(agingInterval);
  }, []);

  // The reset effect above runs after the first render for a new bus; until then `state` still holds
  // the previous bus's feed. Never hand that out: a status line under the new heading would name the wrong bus.
  const shown = state.feed && state.busId !== busId ? EMPTY_STATUS : state;
  return {
    status: shown.status,
    feed: shown.feed,
    error: shown.error,
    receivedAt: shown.receivedAt,
    refresh: () => fetchStatus(requestSignal.current ?? undefined)
  };
}

export function useFleetStatus() {
  const [feeds, setFeeds] = useState<Record<string, AgedTrackingStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const requestSignal = useRef<AbortSignal | null>(null);

  // Track last known good data to age it
  const currentData = useRef<Record<string, { feed: LiveTrackingFeed; receivedAt: number }>>({});

  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    const request = ++latestRequest.current;
    try {
      const data = await storage.getTrackingFeeds(signal);
      if (signal?.aborted || request !== latestRequest.current) return;

      const now = performance.now();
      const newFeeds: Record<string, AgedTrackingStatus> = {};

      for (const busId of Object.keys(data)) {
        const feed = data[busId];
        currentData.current[busId] = { feed, receivedAt: now };
        newFeeds[busId] = { feed, status: feed.status, error: null, receivedAt: now };
      }

      setFeeds(prev => ({ ...prev, ...newFeeds }));
      setError(null);
    } catch (e: any) {
      if (signal?.aborted || request !== latestRequest.current || e.name === 'AbortError') return;
      if (e.status === 403) { // IDN-02: same as the single-bus feed
        currentData.current = {};
        setFeeds({});
      }
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requestSignal.current = controller.signal;

    currentData.current = {};
    setFeeds({});
    setError(null);
    fetchStatus(controller.signal);

    const interval = setInterval(() => fetchStatus(controller.signal), 10000);
    return () => {
      clearInterval(interval);
      controller.abort();
      latestRequest.current++;
    };
  }, [fetchStatus]);

  // Aging loop
  useEffect(() => {
    const tick = () => {
      let changed = false;
      const now = performance.now();

      setFeeds(prev => {
        const next = { ...prev };

        for (const busId of Object.keys(currentData.current)) {
          const { feed, receivedAt } = currentData.current[busId];
          const newStatus = calculateAgedStatus(feed, receivedAt, now);

          if (next[busId]?.status !== newStatus) {
            next[busId] = { ...next[busId], status: newStatus };
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    };

    const agingInterval = setInterval(tick, 1000);
    return () => clearInterval(agingInterval);
  }, []);

  return { feeds, error, refresh: () => fetchStatus(requestSignal.current ?? undefined) };
}
