import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  endTracking,
  getTrackingFeed,
  sendTrackingHeartbeat,
  startTracking,
  submitTrackingSample,
  type LiveTrackingFeed,
  type TripEndInput,
  type TripHeartbeatInput,
  type TripSampleInput,
  type TripSession,
  type TripStartInput,
} from '@workspace/api-client-react';
import {
  createDriverTracker,
  type TrackerGeo,
  type TrackerPosition,
  type TrackerPositionError,
  type TrackingState,
  type TrackingStore,
  type TrackingTransport,
} from '@workspace/driver-tracking';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { onIdTokenChanged } from 'firebase/auth';
import { Platform } from 'react-native';
import { auth } from '@/lib/firebase';
import { flushEvidence, logEvent } from '@/lib/evidence';
import { indicatorPermissionLoss } from '@/lib/permissions';

export const TASK_NAME = 'pu-transit-background-location';
const STORE_PREFIX = 'pu-transit:tracking:';
const storeValues = new Map<string, string>();
let geoListener: ((position: TrackerPosition) => void) | null = null;
let geoErrorListener: ((error: TrackerPositionError) => void) | null = null;
let nextWatchId = 1;
let activeController: TrackingController | null = null;
let forcedEndListener: ((reason: string) => void) | null = null;
let forcedEnd: Promise<void> | null = null;
// Native start/verify/stop calls run one at a time, so a Stop still in flight can
// never terminate the service of the next Start after it was verified.
let nativeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const next = nativeQueue.then(op, op);
  nativeQueue = next.catch(() => undefined);
  return next;
}

/** The screen subscribes to learn why a trip was ended without the driver pressing End. */
export function setForcedEndListener(listener: ((reason: string) => void) | null): void {
  forcedEndListener = listener;
}

/**
 * "No tracking without the visible indicator": end the live trip through the
 * normal durable End path when a permission the indicator depends on is lost.
 */
export async function endTripForIndicatorLoss(reason: string): Promise<void> {
  if (forcedEnd) return forcedEnd;
  const controller = activeController;
  if (!controller || ['idle', 'conflict'].includes(controller.getState().phase)) return;
  logEvent({ kind: 'lifecycle', event: 'indicator_lost', reason });
  forcedEndListener?.(`Trip ended: ${reason}`);
  forcedEnd = controller.stop().finally(() => { forcedEnd = null; });
  return forcedEnd;
}

type TaskData = { locations?: Location.LocationObject[] };

if (Platform.OS !== 'web') {
  TaskManager.defineTask<TaskData>(TASK_NAME, async ({ data, error }) => {
    if (error) {
      logEvent({ kind: 'task', event: 'error', message: error.message });
      geoErrorListener?.({ code: 2, message: error.message });
      return;
    }
    const locations = data?.locations ?? [];
    if (!geoListener) {
      logEvent({ kind: 'task', event: 'without_tracker', message: 'Location task ran without a registered tracker.' });
      await serialized(async () => {
        // Re-checked inside the queue: a Start queued meanwhile owns the service again.
        if (!geoListener && await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
          await Location.stopLocationUpdatesAsync(TASK_NAME);
        }
      });
      return;
    }
    // Android keeps delivering locations after the notification permission is revoked
    // mid-trip, which would hide the indicator; the screen may never come back to notice.
    // Checked on every batch (~5 s) so no hidden batch is ever uploaded.
    const lost = await indicatorPermissionLoss();
    if (lost) {
      await endTripForIndicatorLoss(lost);
      return;
    }
    for (const location of locations) {
      geoListener({
        coords: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? 100_000,
        },
        timestamp: location.timestamp,
      });
    }
    const newest = locations.at(-1);
    if (newest) {
      logEvent({
        kind: 'location',
        capturedAt: newest.timestamp,
        accuracy: newest.coords.accuracy ?? 100_000,
        batch: locations.length,
        source: 'task',
      });
    }
  });
}

const geo: TrackerGeo = {
  // Resolves only once the OS has started collection (Android: foreground service
  // with its notification; iOS: background-capable updates). A rejection makes the
  // shared tracker abort Start before any server call.
  watchPosition(onPosition, onError) {
    if (Platform.OS === 'web') throw new Error('Background tracking needs the native build');
    geoListener = onPosition;
    geoErrorListener = onError;
    const watchId = nextWatchId++;
    return serialized(async () => {
      try {
        await Location.startLocationUpdatesAsync(TASK_NAME, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 5_000,
          distanceInterval: 0,
          deferredUpdatesInterval: 0,
          deferredUpdatesDistance: 0,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'PU Transit is sharing your bus location',
            notificationBody: 'Students can see this bus. End the trip in the app to stop.',
            notificationColor: '#0A76D6',
          },
        });
        if (!(await Location.hasStartedLocationUpdatesAsync(TASK_NAME))) {
          throw new Error('The OS did not start background location.');
        }
        logEvent({ kind: 'task', event: 'started' });
        return watchId;
      } catch (error) {
        geoListener = null;
        geoErrorListener = null;
        // Never leave a half-started service behind: nothing owns it after this rejection.
        await Location.stopLocationUpdatesAsync(TASK_NAME).catch(() => undefined);
        const message = error instanceof Error ? error.message : 'Background location failed to start.';
        logEvent({ kind: 'task', event: 'error', message });
        throw new Error(`Background location could not start: ${message}`);
      }
    });
  },
  clearWatch() {
    geoListener = null;
    geoErrorListener = null;
    if (Platform.OS !== 'web') {
      void serialized(async () => {
        if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
          await Location.stopLocationUpdatesAsync(TASK_NAME);
        }
      })
        .then(() => logEvent({ kind: 'task', event: 'stopped' }))
        .catch((error: unknown) => logEvent({
          kind: 'task',
          event: 'error',
          message: error instanceof Error ? error.message : 'Background location failed to stop.',
        }));
    }
  },
};

export const trackingStore: TrackingStore = {
  getItem: key => storeValues.get(key) ?? null,
  setItem: (key, value) => {
    storeValues.set(key, value);
    void AsyncStorage.setItem(key, value).catch(error => {
      logEvent({ kind: 'task', event: 'error', message: `Tracking persistence failed: ${String(error)}` });
    });
  },
  removeItem: key => {
    storeValues.delete(key);
    void AsyncStorage.removeItem(key).catch(error => {
      logEvent({ kind: 'task', event: 'error', message: `Tracking persistence failed: ${String(error)}` });
    });
  },
};

/** Sign-out (NAT-06): forget this account's device-held trip state — saved session and pending End. */
export async function clearTrackingState(uid: string): Promise<void> {
  const mine = `:${encodeURIComponent(uid)}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(STORE_PREFIX) && key.includes(mine));
  keys.forEach(key => storeValues.delete(key));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

export async function hydrateStores(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(STORE_PREFIX));
  const values = await AsyncStorage.multiGet(keys);
  storeValues.clear();
  values.forEach(([key, value]) => {
    if (value !== null) storeValues.set(key, value);
  });
}

type RequestOp = 'start' | 'sample' | 'heartbeat' | 'end' | 'feed';

function normalizeError(error: unknown): Error & { status: number; code?: string } {
  let status = 0;
  let code = 'NETWORK';
  let message = error instanceof Error ? error.message : 'Network request failed.';
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const apiError = error as { status?: unknown; data?: unknown; message?: unknown };
    status = typeof apiError.status === 'number' ? apiError.status : 0;
    const data = apiError.data as { error?: unknown; code?: unknown } | null;
    if (typeof data?.code === 'string') code = data.code;
    if (typeof data?.error === 'string') message = data.error;
  } else if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    code = 'TIMEOUT';
    message = 'Tracking request timed out.';
  } else if (!(error instanceof TypeError)) {
    code = 'NETWORK';
  }
  return Object.assign(new Error(message), { status, code });
}

function isEndResult(value: object): value is { acknowledged: boolean; outcome: string } {
  return 'acknowledged' in value && 'outcome' in value;
}

function responseFeed(value: LiveTrackingFeed | TripSession | { feed: LiveTrackingFeed }): LiveTrackingFeed {
  return 'feed' in value ? value.feed : value;
}

// AC-08 fault injection (NAT-05): on the next Start tap, the /start request
// reaches the server but its response is thrown away, so the client sees a
// timeout while the server holds the session — the ambiguous outcome a real
// timeout produces, on demand. The arm is consumed by the next Start tap even
// if that attempt never reaches /start, so it cannot leak into a later trip.
let startTimeoutArmed = false;
let injectStartTimeout = false;
export function armStartTimeout(): void {
  startTimeoutArmed = true;
  logEvent({ kind: 'lifecycle', event: 'fault_armed', fault: 'start_timeout' });
}

function createTransport(busId: string, uid: string): TrackingTransport {
  async function request<T extends LiveTrackingFeed | TripSession | { feed: LiveTrackingFeed }>(
    op: RequestOp,
    input: TripStartInput | TripSampleInput | TripHeartbeatInput | TripEndInput | undefined,
    signal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const sentAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    let injected = false;
    let rejectCancellation: ((reason?: unknown) => void) | null = null;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const abort = () => {
      const reason = signal?.reason ?? new DOMException('The request was aborted.', 'AbortError');
      controller.abort(reason);
      rejectCancellation?.(reason);
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    let rejectTimeout: ((reason: Error) => void) | null = null;
    const timeoutFailure = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      const reason = new DOMException('Tracking request timed out.', 'TimeoutError');
      controller.abort(reason);
      rejectTimeout?.(reason);
    }, 10_000);
    const base = {
      kind: 'request',
      op,
      tripId: input && 'tripId' in input ? input.tripId : undefined,
      sequence: input && 'sequence' in input ? input.sequence : undefined,
      capturedAt: input && 'capturedAt' in input ? input.capturedAt : undefined,
      sentAt,
    };
    try {
      if (auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed during tracking.');
      const result = await Promise.race([run(controller.signal), cancellation, timeoutFailure]);
      if (op === 'start' && injectStartTimeout) {
        injectStartTimeout = false;
        timedOut = true;
        injected = true;
        throw new DOMException('Tracking request timed out.', 'TimeoutError');
      }
      if (auth.currentUser?.uid !== uid) throw new Error('The signed-in account changed during tracking.');
      const feed = responseFeed(result);
      logEvent({
        ...base,
        doneAt: Date.now(),
        ok: true,
        status: 200,
        serverTime: feed.serverTime,
        serverReceivedAt: feed.lastReportReceivedAt,
        serverStatus: feed.status,
        // An End can come back HTTP 200 without being acknowledged yet (a
        // pending server-side End); the evidence must not read it as final.
        ...(isEndResult(result) ? { acknowledged: result.acknowledged, outcome: result.outcome } : {}),
      });
      return result;
    } catch (error) {
      const normalized = timedOut
        ? Object.assign(new Error('Tracking request timed out.'), { status: 0, code: 'TIMEOUT' })
        : normalizeError(error);
      logEvent({
        ...base,
        doneAt: Date.now(),
        ok: false,
        status: normalized.status,
        code: normalized.code,
        message: normalized.message.slice(0, 200),
        ...(injected ? { injected: true } : {}),
      });
      throw normalized;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    getFeed: signal => request('feed', undefined, signal, current => getTrackingFeed(busId, { signal: current })),
    start: (input, signal) => request('start', input, signal, current => startTracking(busId, input, { signal: current })),
    sample: (input, signal) => request('sample', input, signal, current => submitTrackingSample(busId, input, { signal: current })),
    heartbeat: (input, signal) => request('heartbeat', input, signal, current => sendTrackingHeartbeat(busId, input, { signal: current })),
    end: (input, signal) => request('end', input, signal, current => endTracking(busId, input, { signal: current })),
  };
}

export type TrackingController = {
  getState: () => TrackingState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
};

export function createTrackerForBus(
  uid: string,
  busId: string,
  notify: (state: TrackingState) => void,
) {
  let previousPhase: TrackingState['phase'] | null = null;
  let previousError: string | null = null;
  let tokenTimer: ReturnType<typeof setTimeout> | null = null;
  const tracker = createDriverTracker({
    uid,
    busId,
    geo,
    transport: createTransport(busId, uid),
    sessionStore: trackingStore,
    pendingStore: trackingStore,
    notify: state => {
      if (state.phase !== previousPhase || state.error !== previousError) {
        logEvent({
          kind: 'phase',
          phase: state.phase,
          error: state.error,
          feedStatus: state.feed?.status,
          lastSyncAt: state.lastSyncAt,
        });
        previousPhase = state.phase;
        previousError = state.error;
        if (state.phase === 'idle') {
          void flushEvidence().catch(error => console.error('Evidence flush failed', error));
        }
      }
      notify(state);
    },
  });

  const controller = {
    getState: tracker.getState,
    async start(): Promise<void> {
      injectStartTimeout = startTimeoutArmed;
      startTimeoutArmed = false;
      logEvent({ kind: 'lifecycle', event: 'start_pressed', busId });
      await tracker.start();
      if (tracker.getState().feed?.phase === 'active') {
        tokenTimer = setTimeout(() => {
          const started = Date.now();
          void auth.currentUser?.getIdToken(true).then(async () => {
            const result = await auth.currentUser?.getIdTokenResult();
            const expiresAt = result?.expirationTime;
            logEvent({ kind: 'token', event: 'forced_refresh', ok: true, latencyMs: Date.now() - started, expiresAt });
          }).catch((error: unknown) => {
            logEvent({
              kind: 'token',
              event: 'forced_refresh',
              ok: false,
              latencyMs: Date.now() - started,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }, 20 * 60_000);
      }
    },
    async stop(): Promise<void> {
      logEvent({ kind: 'lifecycle', event: 'end_pressed', busId, tripId: tracker.getState().feed?.tripId });
      if (tokenTimer) clearTimeout(tokenTimer);
      tokenTimer = null;
      await tracker.stop();
      await flushEvidence();
    },
    async dispose(): Promise<void> {
      if (tokenTimer) clearTimeout(tokenTimer);
      if (activeController === controller) activeController = null;
      await tracker.dispose();
    },
  };
  activeController = controller;
  return controller;
}

onIdTokenChanged(auth, user => {
  if (!user) return;
  void user.getIdTokenResult().then(result => {
    logEvent({ kind: 'token', event: 'changed', expiresAt: result.expirationTime });
  }).catch(error => {
    logEvent({ kind: 'task', event: 'error', message: `Token evidence failed: ${String(error)}` });
  });
});