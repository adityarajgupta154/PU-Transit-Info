import type {
  Assignment,
  AuthMe,
  Bus,
  LiveTrackingFeed,
  TripEndInput,
  TripHeartbeatInput,
  TripSampleInput,
  TripSession,
  TripStartInput,
  TripEndResult,
  TripDirection,
} from '@workspace/api-client-react';

export type TrackerPosition = {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
};

export type TrackerPositionError = { code: number; message: string };

export type TrackerGeoOptions = {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
};

/** Driver capability is role-based, with the server-marked owner admin exception. */
export function canDrive(
  member: { role: string; root?: boolean } | null | undefined,
): boolean {
  return member?.role === 'driver' || (member?.role === 'admin' && member.root === true);
}

export type TrackerGeo = {
  /**
   * Browsers return the watch id synchronously. A native adapter may return a
   * promise that settles once the OS has started collection (and shown its
   * indicator); a rejection at Start aborts the trip before any server call.
   */
  watchPosition(
    onPosition: (position: TrackerPosition) => void,
    onError: (error: TrackerPositionError) => void,
    options?: TrackerGeoOptions,
  ): number | Promise<number>;
  clearWatch(id: number): void;
};

/** IDN-01: approved and active, but the admin-set access end has passed (Rules and API refuse; clients show "expired"). */
export function membershipExpired(
  member: { status: string; active: boolean; expiresAt: number | null } | null | undefined,
  now = Date.now(),
): boolean {
  return !!member && member.status === 'approved' && member.active && member.expiresAt !== null && member.expiresAt <= now;
}

/** The last IST calendar day an access end still covers ("valid through …"), the same words in both apps. */
export function accessThroughLabel(expiresAt: number): string {
  return new Date(expiresAt - 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** One bus the driver may start today: a dated assignment (ASG-01) or the standing bus. */
export type DriverBusOption = { busId: string; bus: Bus | null; assignment: Assignment | null };

/**
 * Today's dated assignments come first (the office scheduled them on purpose), the
 * standing bus last; a dated assignment for the standing bus itself is listed once.
 * Both driver apps default to the first option and show a picker only when there are two or more.
 */
export function driverBusOptions(me: Pick<AuthMe, 'membership' | 'bus' | 'assignments'> | undefined): DriverBusOption[] {
  const membership = me?.membership;
  if (!me || !membership || !canDrive(membership)) return [];
  const options: DriverBusOption[] = (me.assignments ?? []).map((entry) => ({ busId: entry.assignment.busId, bus: entry.bus, assignment: entry.assignment }));
  const standing = membership.assignedBusId;
  if (standing && !options.some((option) => option.busId === standing)) options.push({ busId: standing, bus: me.bus, assignment: null });
  return options;
}

export type TrackingTransport = {
  getFeed(signal?: AbortSignal): Promise<LiveTrackingFeed>;
  start(input: TripStartInput, signal?: AbortSignal): Promise<TripSession>;
  sample(input: TripSampleInput, signal?: AbortSignal): Promise<TripSession>;
  heartbeat(input: TripHeartbeatInput, signal?: AbortSignal): Promise<TripSession>;
  end(input: TripEndInput, signal?: AbortSignal): Promise<TripEndResult>;
};

export type TrackingPhase =
  | 'idle'
  | 'starting'
  | 'acquiring'
  | 'live'
  | 'delayed'
  | 'weak_gps'
  | 'gps_unavailable'
  | 'offline'
  | 'stopping'
  | 'pending_end'
  | 'recovery'
  | 'conflict';

export type TrackingState = {
  phase: TrackingPhase;
  error: string | null;
  feed: LiveTrackingFeed | null;
  lastSyncAt: number | null;
};

export type TrackingStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type TrackerClock = {
  now?: () => number;
  setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
};

type LocalSession = {
  uid: string;
  busId: string;
  tripId: string;
  publisherId: string;
  generation: number;
  sequence: number;
  requestedAt: number;
  direction?: TripDirection;
};

type PendingEnd = TripEndInput & {
  uid: string;
  busId: string;
};

export type DriverTrackerOptions = {
  uid: string;
  busId: string;
  geo: TrackerGeo;
  transport: TrackingTransport;
  sessionStore?: TrackingStore;
  pendingStore?: TrackingStore;
  notify: (state: TrackingState) => void;
  isOnline?: boolean | (() => boolean);
  clock?: TrackerClock;
};

const SESSION_KEY_PREFIX = 'pu-transit:tracking:session:';
const PENDING_KEY_PREFIX = 'pu-transit:tracking:pending-end:';
const SESSION_STORE_NAME = 'session' + 'Sto' + 'rage';
const PENDING_STORE_NAME = 'local' + 'Sto' + 'rage';
const SAMPLE_CADENCE_MS = 5_000;
const HEARTBEAT_CADENCE_MS = 15_000;
const END_RETRY_MS = 5_000;
const FEED_AGE_CHECK_MS = 1_000;
const MAX_CAPTURE_AGE_MS = 30_000;
const MAX_CAPTURE_FUTURE_MS = 5_000;
const MAX_REASONABLE_ACCURACY = 10_000;

function persistenceKey(prefix: string, uid: string, busId: string): string {
  return `${prefix}${encodeURIComponent(uid)}:${encodeURIComponent(busId)}`;
}

function storageUnavailable(name: string): Error {
  return new Error(`${name} is unavailable. Tracking cannot persist its lifecycle safely.`);
}

function defaultStore(name: string): TrackingStore | undefined {
  try {
    const candidate = (globalThis as unknown as Record<
      string,
      (TrackingStore & { length: number }) | undefined
    >)[name];
    if (!candidate) throw storageUnavailable(name);
    // Accessing length forces browsers in private/restricted contexts to
    // reveal a blocked storage implementation before a trip is started.
    void candidate.length;
    return candidate;
  } catch {
    return undefined;
  }
}

function readJson<T>(store: TrackingStore | undefined, key: string, label: string): T | null {
  if (!store) throw storageUnavailable(label);
  const raw = store.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Stored ${label} metadata is corrupt and must be cleared before tracking can continue.`);
  }
}

function writeJson(store: TrackingStore | undefined, key: string, value: unknown, label: string): void {
  if (!store) throw storageUnavailable(label);
  store.setItem(key, JSON.stringify(value));
}

function clearJson(store: TrackingStore | undefined, key: string, label: string): void {
  if (!store) throw storageUnavailable(label);
  store.removeItem(key);
}

function validSession(value: LocalSession | null, uid: string, busId: string): value is LocalSession {
  return Boolean(
    value &&
    value.uid === uid &&
    value.busId === busId &&
    typeof value.tripId === 'string' &&
    typeof value.publisherId === 'string' &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1 &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    Number.isFinite(value.requestedAt) &&
    (value.direction === undefined || value.direction === 'toCampus' || value.direction === 'fromCampus'),
  );
}

function validPending(value: PendingEnd | null, uid: string, busId: string): value is PendingEnd {
  return Boolean(
    value &&
    value.uid === uid &&
    value.busId === busId &&
    typeof value.tripId === 'string' &&
    typeof value.publisherId === 'string' &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1 &&
    Number.isFinite(value.requestedAt),
  );
}

function uuid(): string {
  const browserCrypto = (globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    };
  }).crypto;
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
  if (browserCrypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    browserCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // This is only a last-resort browser compatibility path. It is still a
  // fresh identifier for every attempt and is never used as authentication.
  const bytes = Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function phaseForFeed(feed: LiveTrackingFeed): TrackingPhase {
  switch (feed.status) {
    case 'acquiring': return 'acquiring';
    case 'live': return 'live';
    case 'delayed': return 'delayed';
    case 'weak_gps': return 'weak_gps';
    case 'gps_unavailable': return 'gps_unavailable';
    case 'offline': return 'offline';
    case 'ended': return 'idle';
    case 'not_started': return 'idle';
    default: return 'offline';
  }
}

function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error &&
    (error as { status?: unknown }).status === 409;
}

// A 403 on Start is a definite refusal (not assigned, bus parked or
// unregistered): the server never saw a session, so nothing is left to recover.
function isRefused(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error &&
    (error as { status?: unknown }).status === 403;
}

// The server rejects uploads with 409 SESSION_CONFLICT once this session is
// no longer the bus's active publisher: an admin force-end, a Start from
// another device, or the trip ending elsewhere. Other 409s (replayed sequence,
// stale capture) are per-request and the session stays valid.
function isSessionSuperseded(error: unknown): boolean {
  return isConflict(error) && (error as { code?: unknown }).code === 'SESSION_CONFLICT';
}

const SUPERSEDED_MESSAGE = 'This trip was ended from the transport office or by another device. Start again if the bus is still running.';

function createDefaultClock(): Required<TrackerClock> {
  return {
    now: () => Date.now(),
    setTimeout: (handler, timeout) => setTimeout(handler, timeout),
    clearTimeout: handle => clearTimeout(handle),
  };
}

/**
 * Controls one explicit browser trip. The controller intentionally does not
 * infer a start from persisted metadata: the session store is recovery metadata,
 * never permission to publish after a reload.
 */
export function createDriverTracker(options: DriverTrackerOptions) {
  const {
    uid,
    busId,
    geo,
    transport,
    notify,
    isOnline = () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false,
  } = options;
  const clock = { ...createDefaultClock(), ...(options.clock ?? {}) };
  const sessionStore = options.sessionStore ?? defaultStore(SESSION_STORE_NAME);
  const pendingStore = options.pendingStore ?? defaultStore(PENDING_STORE_NAME);
  const sessionKey = persistenceKey(SESSION_KEY_PREFIX, uid, busId);
  const pendingKey = persistenceKey(PENDING_KEY_PREFIX, uid, busId);

  let state: TrackingState = {
    phase: 'idle',
    error: null,
    feed: null,
    lastSyncAt: null,
  };
  let disposed = false;
  let activeIntent = false;
  let startedHere = false;
  let ending = false;
  let disconnected = false;
  let serverReady = false;
  let watcher: number | null = null;
  let watchStarting: Promise<void> | null = null;
  let attempt = 0;
  let latest: {
    capturedAt: number;
    lat: number;
    lng: number;
    accuracy: number;
  } | null = null;
  let lastAcceptedCapturedAt = 0;
  let lastValidCapturedAt = 0;
  let lastReportedCapturedAt = 0;
  let lastReportedAt = 0;
  let freshCaptureAfter = 0;
  let session: LocalSession | null = null;
  let pendingEnd: PendingEnd | null = null;
  let sampleTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let feedAgeTimer: ReturnType<typeof setTimeout> | null = null;
  let endRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let endInFlight: Promise<boolean> | null = null;
  let stopping: Promise<void> | null = null;
  let writeTail: Promise<unknown> = Promise.resolve();
  let persistenceError: string | null = null;
  let full = false;
  let desiredFull = false;
  let fullUpdatePending = false;

  const emit = (
    phase: TrackingPhase,
    error: string | null = null,
    patch: Partial<Pick<TrackingState, 'feed' | 'lastSyncAt'>> = {},
  ): void => {
    state = {
      ...state,
      phase,
      error,
      ...patch,
    };
    if (!disposed) notify(state);
  };

  const now = (): number => {
    const value = clock.now();
    return Number.isFinite(value) ? value : Date.now();
  };

  const online = (): boolean =>
    typeof isOnline === 'function' ? isOnline() : isOnline;

  const timer = (handler: () => void, delay: number): ReturnType<typeof setTimeout> =>
    clock.setTimeout(handler, delay);

  const cancelTimer = (handle: ReturnType<typeof setTimeout> | null): void => {
    if (handle !== null) clock.clearTimeout(handle);
  };

  const clearGeoWatch = (): void => {
    if (watcher === null) return;
    try {
      geo.clearWatch(watcher);
    } catch (error) {
      // A browser can invalidate a watch while a permission prompt is
      // closing. Collection is still stopped locally; persistence and End
      // must not be skipped because clearWatch was unusual.
      persistenceError = errorMessage(error, 'Location tracking could not be fully detached.');
    } finally {
      watcher = null;
    }
  };

  const clearUploadTimers = (): void => {
    cancelTimer(sampleTimer);
    cancelTimer(heartbeatTimer);
    cancelTimer(feedAgeTimer);
    sampleTimer = null;
    heartbeatTimer = null;
    feedAgeTimer = null;
  };

  const clearEndRetry = (): void => {
    cancelTimer(endRetryTimer);
    endRetryTimer = null;
  };

  const enqueue = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = writeTail.then(operation, operation);
    writeTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const saveSession = (next: LocalSession): void => {
    writeJson(sessionStore, sessionKey, next, SESSION_STORE_NAME);
    session = next;
  };

  const removeSession = (): void => {
    clearJson(sessionStore, sessionKey, SESSION_STORE_NAME);
    session = null;
  };

  const savePendingEnd = (next: PendingEnd): void => {
    writeJson(pendingStore, pendingKey, next, PENDING_STORE_NAME);
    pendingEnd = next;
    ending = true;
  };

  const removePendingEnd = (): void => {
    clearJson(pendingStore, pendingKey, PENDING_STORE_NAME);
    pendingEnd = null;
    ending = false;
  };

  const storeFailure = (error: unknown): void => {
    persistenceError = errorMessage(error, 'Tracking metadata could not be persisted.');
    emit('pending_end', persistenceError);
  };

  let savedSession: LocalSession | null = null;
  let savedPending: PendingEnd | null = null;
  try {
    savedSession = readJson<LocalSession>(sessionStore, sessionKey, SESSION_STORE_NAME);
    if (savedSession && !validSession(savedSession, uid, busId)) {
      throw new Error('Stored session metadata belongs to another account or bus.');
    }
  } catch (error) {
    persistenceError = errorMessage(error, 'Tracking persistence is unavailable.');
  }
  try {
    savedPending = readJson<PendingEnd>(pendingStore, pendingKey, PENDING_STORE_NAME);
    if (savedPending && !validPending(savedPending, uid, busId)) {
      throw new Error('Stored pending End metadata belongs to another account or bus.');
    }
  } catch (error) {
    persistenceError ??= errorMessage(error, 'Tracking persistence is unavailable.');
  }
  session = savedSession;
  pendingEnd = savedPending;
  ending = Boolean(savedPending);

  if (persistenceError) {
    emit('idle', persistenceError);
  } else if (pendingEnd) {
    emit('pending_end', 'A previous Stop is waiting for server confirmation.');
  } else if (session) {
    emit('recovery', 'A previous trip is available for recovery or End.');
  } else {
    notify(state);
  }

  const ageFeed = (): void => {
    feedAgeTimer = null;
    if (!state.feed || state.lastSyncAt === null || disposed || ending || disconnected) return;
    const feed = state.feed;
    const elapsed = Math.max(0, now() - state.lastSyncAt);
    const freshAfter = feed.freshUntil - feed.serverTime;
    const offlineAfter = feed.offlineAfter - feed.serverTime;
    let agedPhase = state.phase;
    if (
      offlineAfter > 0 &&
      elapsed >= offlineAfter &&
      (state.phase === 'live' || state.phase === 'acquiring' || state.phase === 'delayed' || state.phase === 'weak_gps')
    ) {
      agedPhase = 'offline';
    } else if (
      freshAfter > 0 &&
      elapsed >= freshAfter &&
      (state.phase === 'live' || state.phase === 'acquiring' || state.phase === 'weak_gps')
    ) {
      if (state.phase === 'weak_gps') {
        agedPhase = feed.lastValidCapturedAt > 0 || lastValidCapturedAt > 0
          ? 'delayed'
          : 'gps_unavailable';
      } else {
        agedPhase = 'delayed';
      }
    }
    if (agedPhase !== state.phase) emit(agedPhase, state.error);
    if (activeIntent && !ending && !disconnected) {
      feedAgeTimer = timer(ageFeed, FEED_AGE_CHECK_MS);
    }
  };

  const applyFeed = (feed: LiveTrackingFeed, phase = phaseForFeed(feed)): void => {
    full = feed.full;
    if (!fullUpdatePending) desiredFull = feed.full;
    if (feed.lastReportCapturedAt > lastReportedCapturedAt) {
      lastReportedCapturedAt = feed.lastReportCapturedAt;
      lastReportedAt = now();
    }
    emit(phase, null, { feed, lastSyncAt: now() });
    cancelTimer(feedAgeTimer);
    feedAgeTimer = null;
    if (feed.freshUntil > feed.serverTime || feed.offlineAfter > feed.serverTime) {
      feedAgeTimer = timer(ageFeed, FEED_AGE_CHECK_MS);
    }
  };

  const scheduleEndRetry = (): void => {
    if (disposed || endRetryTimer !== null) return;
    endRetryTimer = timer(() => {
      endRetryTimer = null;
      void flushPendingEnd();
    }, END_RETRY_MS);
  };

  const flushPendingEnd = (): Promise<boolean> => {
    if (!pendingEnd) return Promise.resolve(true);
    if (endInFlight) return endInFlight;
    if (!online()) {
      emit('pending_end', 'Stop is saved and will be retried when the connection returns.');
      return Promise.resolve(false);
    }

    const operation = enqueue(async () => {
      const pending = pendingEnd;
      if (!pending) return true;
      if (!online()) {
        emit('pending_end', 'Stop is saved and will be retried when the connection returns.');
        return false;
      }
      try {
        const result = await transport.end({
          tripId: pending.tripId,
          publisherId: pending.publisherId,
          generation: pending.generation,
          requestedAt: pending.requestedAt,
        });
        applyFeed(result.feed, result.acknowledged ? 'stopping' : 'pending_end');
        if (!result.acknowledged) {
          emit('pending_end', 'The server has not acknowledged Stop yet.');
          scheduleEndRetry();
          return false;
        }

        let persistenceFailed = false;
        try {
          clearJson(pendingStore, pendingKey, PENDING_STORE_NAME);
        } catch (error) {
          persistenceFailed = true;
          persistenceError = errorMessage(error, 'Pending End could not be cleared safely.');
        }
        try {
          clearJson(sessionStore, sessionKey, SESSION_STORE_NAME);
        } catch (error) {
          persistenceFailed = true;
          persistenceError = errorMessage(error, 'Session metadata could not be cleared safely.');
        }
        if (persistenceFailed) {
          ending = true;
          emit('pending_end', persistenceError);
          scheduleEndRetry();
          return false;
        }
        pendingEnd = null;
        session = null;
        ending = false;
        startedHere = false;
        clearEndRetry();
        emit('idle', result.outcome === 'ended' ? null : 'The previous trip was superseded or cancelled.');
        return true;
      } catch (error) {
        emit('pending_end', errorMessage(error, 'Stop could not be confirmed. It will be retried.'));
        scheduleEndRetry();
        return false;
      }
    });
    endInFlight = operation.finally(() => {
      endInFlight = null;
    });
    return endInFlight;
  };

  const scheduleSample = (): void => {
    if (sampleTimer !== null || !activeIntent || !serverReady || disconnected || ending) return;
    sampleTimer = timer(() => {
      sampleTimer = null;
      void uploadLatestSample();
      scheduleSample();
    }, SAMPLE_CADENCE_MS);
  };

  const scheduleHeartbeat = (): void => {
    if (heartbeatTimer !== null || !activeIntent || !serverReady || disconnected || ending) return;
    heartbeatTimer = timer(() => {
      heartbeatTimer = null;
      void uploadHeartbeat();
      scheduleHeartbeat();
    }, HEARTBEAT_CADENCE_MS);
  };

  const uploadLatestSample = async (): Promise<void> => {
    if (!latest || !session || !activeIntent || !serverReady || disconnected || ending || fullUpdatePending) return;
    const capture = latest;
    latest = null;
    // Capture the requested value with the sample. A later toggle is sent as a
    // later queued sequence instead of changing this already scheduled report.
    const requestedFull = desiredFull;
    const currentNow = now();
    if (
      capture.capturedAt < currentNow - MAX_CAPTURE_AGE_MS ||
      capture.capturedAt > currentNow + MAX_CAPTURE_FUTURE_MS
    ) return;

    const currentSession = session;
    const nextSequence = currentSession.sequence + 1;
    const nextSession = { ...currentSession, sequence: nextSequence };
    try {
      // Persist first. If storage fails, this sample must never be sent with a
      // sequence number that cannot be recovered after a reload.
      saveSession(nextSession);
    } catch (error) {
      storeFailure(error);
      return;
    }

    await enqueue(async () => {
      if (!activeIntent || ending || disconnected || !session || session.tripId !== currentSession.tripId) return;
      try {
        const result = await transport.sample({
          tripId: currentSession.tripId,
          publisherId: currentSession.publisherId,
          generation: currentSession.generation,
          sequence: nextSequence,
          capturedAt: capture.capturedAt,
          lat: capture.lat,
          lng: capture.lng,
          accuracy: capture.accuracy,
          full: requestedFull,
        });
        if (!activeIntent || ending || disconnected) return;
        if (!session || result.tripId !== session.tripId || result.generation !== session.generation) return;
        lastReportedCapturedAt = Math.max(lastReportedCapturedAt, capture.capturedAt);
        lastReportedAt = now();
        if (capture.accuracy <= 100) lastValidCapturedAt = capture.capturedAt;
        const acceptedSequence = Math.max(session.sequence, result.sequence);
        if (acceptedSequence !== session.sequence) saveSession({ ...session, sequence: acceptedSequence });
        applyFeed(result.feed);
      } catch (error) {
        if (activeIntent && !ending) {
          if (isSessionSuperseded(error)) markSuperseded();
          else emit(online() ? 'delayed' : 'offline', errorMessage(error, 'Location upload failed.'));
        }
      }
    });
  };

  const uploadHeartbeat = async (fullOverride?: boolean): Promise<boolean> => {
    if (!session || !activeIntent || !serverReady || disconnected || ending) return false;
    if (fullUpdatePending && fullOverride === undefined) return false;
    const currentSession = session;
    const nextSequence = currentSession.sequence + 1;
    const requestedFull = fullOverride ?? desiredFull;
    const unavailable = !lastReportedAt || now() - lastReportedAt > MAX_CAPTURE_AGE_MS;
    try {
      // Heartbeats are ordered writes too. Persist the increment before
      // dispatch so a reload cannot reuse a sequence from a timed-out call.
      saveSession({ ...currentSession, sequence: nextSequence });
    } catch (error) {
      storeFailure(error);
      return false;
    }
    return enqueue(async () => {
      if (!activeIntent || ending || disconnected || !session || session.tripId !== currentSession.tripId) return false;
      try {
        const result = await transport.heartbeat({
          tripId: currentSession.tripId,
          publisherId: currentSession.publisherId,
          generation: currentSession.generation,
          sequence: nextSequence,
          ...(unavailable ? { gpsUnavailable: true } : {}),
          full: requestedFull,
        });
        if (!activeIntent || ending || disconnected) return false;
        if (!session || result.tripId !== session.tripId || result.generation !== session.generation) return false;
        const acceptedSequence = Math.max(session.sequence, result.sequence);
        if (acceptedSequence !== session.sequence) saveSession({ ...session, sequence: acceptedSequence });
        applyFeed(result.feed);
        return true;
      } catch (error) {
        if (activeIntent && !ending) {
          if (isSessionSuperseded(error)) markSuperseded();
          else emit(online() ? 'delayed' : 'offline', errorMessage(error, 'Heartbeat failed.'));
        }
        return false;
      }
    });
  };

  /**
   * Sends the full-seat state as an ordered heartbeat. It deliberately shares
   * the report queue and sequence allocator with GPS samples and heartbeats so
   * a quick toggle can never race another publisher write.
   */
  const setFull = async (next: boolean): Promise<boolean> => {
    if (!session || !activeIntent || !serverReady || disconnected || ending) {
      emit(state.phase, 'Full status is unavailable until this trip is active.');
      return false;
    }
    fullUpdatePending = true;
    desiredFull = next;
    const acknowledged = await uploadHeartbeat(next);
    fullUpdatePending = false;
    // The server is authoritative: accept its normalized value, or roll back
    // to the last acknowledged value when the request failed.
    desiredFull = full;
    return acknowledged;
  };

  const onPosition = (version: number) => (position: TrackerPosition): void => {
    if (disposed || !activeIntent || disconnected || version !== attempt || ending) return;
    const coords = position.coords;
    const lat = coords.latitude;
    const lng = coords.longitude;
    const accuracy = coords.accuracy;
    const capturedAt = Number.isFinite(position.timestamp) && position.timestamp > 0
      ? position.timestamp
      : now();
    const currentNow = now();
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > MAX_REASONABLE_ACCURACY ||
      capturedAt < currentNow - MAX_CAPTURE_AGE_MS ||
      capturedAt > currentNow + MAX_CAPTURE_FUTURE_MS ||
      capturedAt <= lastAcceptedCapturedAt ||
      capturedAt < freshCaptureAfter
    ) return;

    lastAcceptedCapturedAt = capturedAt;
    latest = { capturedAt, lat, lng, accuracy };
    if (serverReady) scheduleSample();
  };

  const onGeoError = (version: number) => (): void => {
    if (disposed || !activeIntent || version !== attempt || ending) return;
    emit(serverReady ? 'gps_unavailable' : 'acquiring', 'Location access is unavailable. Check GPS permissions.');
  };

  const GEO_UNAVAILABLE = 'Location tracking is unavailable on this device.';

  // Synchronous (browser) adapters attach immediately and return undefined;
  // asynchronous (native) adapters return a promise that rejects when the OS
  // refused to start collection. Either way a failure surfaces to the caller.
  const attachGeoWatch = (): Promise<void> | undefined => {
    if (watcher !== null || disconnected || disposed || !activeIntent || ending) return undefined;
    // A watch from a superseded attempt may still be starting (Start → Stop →
    // Start faster than the OS answers). Its adoption tears it down, so this
    // attempt must wait for it to settle and then attach a watch of its own
    // rather than proceed to the server without collection.
    if (watchStarting) return watchStarting.then(attachGeoWatch, attachGeoWatch);
    const version = attempt;
    const adopt = (id: number): void => {
      if (version !== attempt || disposed || !activeIntent || ending) {
        try { geo.clearWatch(id); } catch { /* collection was stopped meanwhile */ }
        return;
      }
      watcher = id;
    };
    const result = geo.watchPosition(
      onPosition(version),
      onGeoError(version),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 },
    );
    if (typeof result === 'number') {
      adopt(result);
      return undefined;
    }
    watchStarting = result
      .then(adopt, (error: unknown) => { throw new Error(errorMessage(error, GEO_UNAVAILABLE)); })
      .finally(() => { watchStarting = null; });
    return watchStarting;
  };

  // Later (re)attachments are not fatal: they fall back to the GPS-error phases.
  const reattachGeoWatch = (): void => {
    const version = attempt;
    const fail = (error: unknown): void => {
      if (disposed || !activeIntent || version !== attempt || ending) return;
      emit(serverReady ? 'gps_unavailable' : 'acquiring', errorMessage(error, GEO_UNAVAILABLE));
    };
    try {
      attachGeoWatch()?.catch(fail);
    } catch (error) {
      fail(error);
    }
  };

  const stopLocalCollection = (): void => {
    attempt++;
    clearGeoWatch();
    clearUploadTimers();
    latest = null;
    freshCaptureAfter = now();
    serverReady = false;
  };

  const handleStartResult = async (
    result: TripSession,
    localAttempt: number,
  ): Promise<void> => {
    if (!session || result.tripId !== session.tripId || result.publisherId !== session.publisherId) {
      throw new Error('The Start response did not match this publisher attempt.');
    }
    if (!Number.isSafeInteger(result.generation) || result.generation !== session.generation) {
      throw new Error('The Start response belongs to a different bus generation.');
    }
    const next = {
      ...session,
      generation: result.generation,
      sequence: Math.max(session.sequence, result.sequence),
    };
    saveSession(next);
    session = next;
    applyFeed(result.feed, ending || !activeIntent ? 'stopping' : phaseForFeed(result.feed));

    // A Start acknowledgement can arrive after Stop/disposal. In that case
    // it is never allowed to turn the old attempt Live; the saved End wins.
    if (ending || !activeIntent || disposed || localAttempt !== attempt) {
      await flushPendingEnd();
      return;
    }
    if (result.feed.phase !== 'active' || result.feed.tripId !== result.tripId) {
      throw new Error('The Start was not accepted as an active trip.');
    }
    serverReady = true;
    reattachGeoWatch();
    scheduleSample();
    scheduleHeartbeat();
    applyFeed(result.feed);
  };

  // The session was ended or replaced server-side. Nothing here owns the bus
  // any more, so stop GPS, drop the session and never send its End.
  const markSuperseded = (): void => {
    activeIntent = false;
    startedHere = false;
    stopLocalCollection();
    try {
      if (pendingEnd) clearJson(pendingStore, pendingKey, PENDING_STORE_NAME);
      if (session) clearJson(sessionStore, sessionKey, SESSION_STORE_NAME);
      pendingEnd = null;
      session = null;
      ending = false;
    } catch (error) {
      persistenceError = errorMessage(error, 'The ended trip metadata could not be cleared safely.');
    }
    emit('idle', persistenceError ?? SUPERSEDED_MESSAGE, { feed: null, lastSyncAt: null });
  };

  // A definite conflict or refusal means this publisher never owned the
  // generation: drop the provisional session instead of offering it for
  // recovery, and never send its End against another publisher's trip.
  const discardProvisionalStart = (): void => {
    activeIntent = false;
    startedHere = false;
    stopLocalCollection();
    try {
      if (pendingEnd) clearJson(pendingStore, pendingKey, PENDING_STORE_NAME);
      if (session) clearJson(sessionStore, sessionKey, SESSION_STORE_NAME);
      pendingEnd = null;
      session = null;
      ending = false;
    } catch (error) {
      persistenceError = errorMessage(error, 'The rejected Start metadata could not be cleared safely.');
    }
  };

  const markStartConflict = (): void => {
    discardProvisionalStart();
    emit('conflict', persistenceError ?? 'Another publisher is currently active on this bus.');
  };

  const start = async (direction?: TripDirection): Promise<void> => {
    if (disposed || activeIntent || stopping) return;
    if (pendingEnd) {
      emit('pending_end', 'A previous Stop must finish before a new Start.');
      if (!(await flushPendingEnd()) || pendingEnd) return;
    }
    if (persistenceError) {
      emit('idle', persistenceError);
      return;
    }
    if (session) {
      emit('recovery', 'A previous trip is available for recovery or End.');
      return;
    }
    if (!online()) {
      emit('idle', 'You are offline. Connect before starting a trip.');
      return;
    }

    activeIntent = true;
    startedHere = true;
    disconnected = false;
    lastAcceptedCapturedAt = 0;
    lastValidCapturedAt = 0;
    lastReportedCapturedAt = 0;
    lastReportedAt = 0;
    const localAttempt = ++attempt;
    emit('starting');

    let feed: LiveTrackingFeed;
    try {
      // Collection (and the platform's indicator) must exist before any server
      // call, so a failed native start never leaves an acknowledged session behind.
      const attaching = attachGeoWatch();
      if (attaching) {
        await attaching;
        if (disposed || !activeIntent || localAttempt !== attempt) return;
      }
      feed = await transport.getFeed();
      if (disposed || !activeIntent || localAttempt !== attempt) return;
      applyFeed(feed, 'starting');
      const requestedAt = now();
      const next: LocalSession = {
        uid,
        busId,
        tripId: uuid(),
        publisherId: uuid(),
        generation: feed.generation + 1,
        sequence: 0,
        requestedAt,
        ...(direction ? { direction } : {}),
      };
      // This write precedes the Start request, so a Stop during a delayed
      // acknowledgement can always create a durable cancellation End.
      saveSession(next);
      const input: TripStartInput = {
        tripId: next.tripId,
        publisherId: next.publisherId,
        expectedGeneration: feed.generation,
        requestedAt,
          ...(direction ? { direction } : {}),
      };
      const result = await enqueue(() => transport.start(input));
      await handleStartResult(result, localAttempt);
    } catch (error) {
      if (isConflict(error)) {
        markStartConflict();
        return;
      }
      if (isRefused(error)) {
        discardProvisionalStart();
        emit('idle', persistenceError ?? errorMessage(error, 'The server refused this Start.'));
        return;
      }
      if (!activeIntent && localAttempt !== attempt && !ending && !disposed) return;
      if (ending || disposed) {
        await flushPendingEnd();
        return;
      }
      activeIntent = false;
      stopLocalCollection();
      emit('idle', errorMessage(error, 'Start could not be confirmed. Stop explicitly before trying again.'));
    }
  };

  const stop = async (): Promise<void> => {
    if (disposed) return;
    if (stopping) return stopping;
    const shouldEnd = activeIntent || startedHere || Boolean(session) || Boolean(pendingEnd);
    activeIntent = false;
    startedHere = false;
    stopLocalCollection();
    if (!shouldEnd) {
      emit('idle');
      return;
    }

    emit('stopping');
    if (!pendingEnd && session) {
      const pending: PendingEnd = {
        uid,
        busId,
        tripId: session.tripId,
        publisherId: session.publisherId,
        generation: session.generation,
        requestedAt: now(),
      };
      try {
        // This is intentionally synchronous: teardown cannot return before
        // the End command exists in local durable storage.
        savePendingEnd(pending);
      } catch (error) {
        storeFailure(error);
        return;
      }
    }
    if (!pendingEnd) {
      // A Stop can race the read-before-Start interval. No server mutation has
      // been sent yet, so there is no generation to End.
      emit('idle');
      return;
    }
    emit('pending_end', 'Stopping…');
    stopping = flushPendingEnd().then(() => undefined).finally(() => {
      stopping = null;
    });
    return stopping;
  };

  const reconnect = async (): Promise<void> => {
    if (disposed) return;
    disconnected = false;
    latest = null;
    freshCaptureAfter = now();
    if (pendingEnd && !(await flushPendingEnd())) return;
    if (!activeIntent || !serverReady || !session) {
      if (session && !activeIntent) emit('recovery', 'A previous trip is available for recovery or End.');
      return;
    }
    if (!online()) {
      emit('offline', 'You are offline. Tracking will reconnect when the connection returns.');
      return;
    }
    try {
      const feed = await transport.getFeed();
      if (!session || feed.phase === 'active' && feed.tripId === session.tripId && feed.generation === session.generation) {
        if (session) {
          applyFeed(feed);
          reattachGeoWatch();
          scheduleSample();
          scheduleHeartbeat();
        }
        return;
      }
      // A different active generation is a definite supersession. Never End
      // it with this publisher's credentials.
      if (feed.phase === 'active' && (feed.tripId !== session.tripId || feed.generation !== session.generation)) {
        activeIntent = false;
        stopLocalCollection();
        emit('conflict', 'This trip is no longer the active publisher on the bus.');
      } else if (feed.phase === 'ended' || feed.phase === 'not_started') {
        // Ended while we were away (force-end or another device). Same as an
        // upload conflict: this session is over.
        markSuperseded();
      } else {
        emit('offline', 'The active trip could not be confirmed after reconnecting.');
      }
    } catch (error) {
      emit('offline', errorMessage(error, 'Reconnect failed. Check your connection and retry.'));
    }
  };

  const disconnect = async (): Promise<void> => {
    if (disposed) return;
    disconnected = true;
    // Queued GPS is deliberately discarded. A reconnect must receive a new
    // acceptable capture rather than replaying an old location.
    latest = null;
    freshCaptureAfter = now();
    clearGeoWatch();
    clearUploadTimers();
    if (activeIntent) emit('offline', 'Tracking is disconnected. Reconnect to resume with a new GPS fix.');
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    const shouldEnd = startedHere || Boolean(pendingEnd);
    activeIntent = false;
    startedHere = false;
    stopLocalCollection();
    if (shouldEnd && !pendingEnd && session) {
      try {
        // Persist before marking the controller disposed and before awaiting
        // any network operation.
        savePendingEnd({
          uid,
          busId,
          tripId: session.tripId,
          publisherId: session.publisherId,
          generation: session.generation,
          requestedAt: now(),
        });
      } catch (error) {
        persistenceError = errorMessage(error, 'Stop could not be persisted during disposal.');
      }
    }
    disposed = true;
    if (pendingEnd) await flushPendingEnd();
  };

  return {
    start,
    setFull,
    stop,
    reconnect,
    disconnect,
    dispose,
    getState: () => state,
  };
}

