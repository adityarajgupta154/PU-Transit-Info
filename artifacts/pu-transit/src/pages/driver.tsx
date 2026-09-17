import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, Play, RefreshCw, Square, X } from 'lucide-react';
import type { TripDirection } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/auth-context';
import { Headline, Tile, TileButton } from '@/components/metro/tile';
import { StateTile } from '@/components/metro/state-tile';
import {
  createDriverTracker,
  createTrackingTransport,
  driverBusOptions,
  type DriverBusOption,
  type TrackingPhase,
  type TrackingState,
} from '@/lib/driver-tracking';
import {
  DRIVER_LANGUAGES,
  driverStamps,
  driverText,
  formatDriverAge,
  readDriverLanguage,
  saveDriverLanguage,
  translateDriverError,
  type DriverLanguage,
} from '@/lib/driver-locale';
import { shiftLabel } from '@/lib/shifts';
import { cn } from '@/lib/utils';

function browserStorage(name: 'sessionStorage' | 'localStorage'): Storage {
  try {
    const store = window[name];
    if (!store) throw new Error(`${name} is unavailable.`);
    // Access can throw in restricted/private browsing contexts. Let the
    // controller surface the failure rather than silently losing End state.
    void store.length;
    return store;
  } catch {
    throw new Error(`${name} is unavailable. Tracking cannot persist safely.`);
  }
}

const unavailableGeolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'> = {
  watchPosition: () => {
    throw new Error('Geolocation is unavailable or this page is not secure.');
  },
  clearWatch: () => undefined,
};

const ACTIVE_PHASES: TrackingPhase[] = ['starting', 'acquiring', 'live', 'delayed', 'weak_gps', 'gps_unavailable', 'offline'];

type Check = { label: string; state: 'ok' | 'warn' | 'fail'; detail: string };

function LanguageSelect({
  language,
  onChange,
}: {
  language: DriverLanguage;
  onChange: (language: DriverLanguage) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-base">
      <span>{driverText(language, 'language')}</span>
      <select
        data-testid="select-driver-language"
        value={language}
        onChange={(event) => onChange(event.target.value as DriverLanguage)}
        className="h-11 border-2 border-border bg-white px-3 text-base text-foreground"
      >
        {DRIVER_LANGUAGES.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Keeps the screen awake while a trip is running; a locked screen stops GPS in every mobile browser. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Battery saver or a hidden tab can refuse it; the on-screen hint covers that case.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    };
  }, [active]);
}

export default function Driver() {
  const { membership, bus, assignments, user } = useAuth();
  const [tracking, setTracking] = useState<TrackingState>({ phase: 'idle', error: null, feed: null, lastSyncAt: null });
  const tracker = useRef<ReturnType<typeof createDriverTracker> | null>(null);
  // ASG-01: today's dated assignments plus the standing bus; the first option is the default.
  const options = useMemo(() => driverBusOptions({ membership, bus, assignments }), [membership, bus, assignments]);
  const [chosenBusId, setChosenBusId] = useState<string | null>(null);
  // A trip in flight keeps its bus even when the options change underneath (an office edit, the IST day
  // rolling over): rebuilding the tracker for another bus would dispose this one and end the trip.
  const [locked, setLocked] = useState<DriverBusOption | null>(null);
  const selected = locked ?? options.find((option) => option.busId === chosenBusId) ?? options[0] ?? null;
  const busId = selected?.busId ?? null;
  const activeBus = selected?.bus ?? null;
  const isOwner = membership?.role === 'admin' && membership.root === true;
  const [language, setLanguage] = useState<DriverLanguage>(readDriverLanguage);
  const [direction, setDirection] = useState<TripDirection | null>(null);
  const [fullPending, setFullPending] = useState<boolean | null>(null);
  const [fullError, setFullError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [geoPermission, setGeoPermission] = useState<PermissionState | 'unknown'>('unknown');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [, setTick] = useState(0);

  const phase = tracking.phase;
  const isActive = ACTIVE_PHASES.includes(phase);
  const stamps = driverStamps(language);
  useWakeLock(isActive);
  useEffect(() => {
    if (phase === 'idle' || phase === 'conflict') setLocked(null);
    else setLocked((current) => current ?? selected);
  }, [phase, selected]);

  const changeLanguage = (next: DriverLanguage) => {
    setLanguage(next);
    saveDriverLanguage(next);
  };

  useEffect(() => {
    setTracking({ phase: 'idle', error: null, feed: null, lastSyncAt: null });
    setDirection(null);
    setFullPending(null);
    setFullError(null);
    if (!busId || !user?.uid) {
      tracker.current = null;
      return;
    }

    let controller: ReturnType<typeof createDriverTracker> | null = null;
    try {
      let geo: Pick<Geolocation, 'watchPosition' | 'clearWatch'> = unavailableGeolocation;
      try {
        if (navigator.geolocation) geo = navigator.geolocation;
      } catch {
        // Keep the throwing adapter. Recovery and pending End must still be
        // constructed and synchronized without GPS.
      }
      controller = createDriverTracker({
        uid: user.uid,
        busId,
        geo,
        transport: createTrackingTransport(busId, user.uid),
        sessionStore: browserStorage('sessionStorage'),
        pendingStore: browserStorage('localStorage'),
        notify: (state) => setTracking(state),
        isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tracking storage is unavailable.';
      setTracking((prev) => ({ ...prev, error: message }));
      tracker.current = null;
      return;
    }

    tracker.current = controller;
    const handleOnline = () => {
      setIsOnline(true);
      void controller?.reconnect();
    };
    const handleOffline = () => {
      setIsOnline(false);
      void controller?.disconnect();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // This only flushes a durable pending End/reports recovery. The
    // controller never starts GPS or a new trip from this call.
    void controller.reconnect();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      tracker.current = null;
      void controller?.dispose();
    };
  }, [busId, user?.uid]);

  // Preflight: location permission state, kept current if the driver changes it in the browser.
  useEffect(() => {
    if (!('permissions' in navigator)) return;
    let status: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        status = result;
        setGeoPermission(result.state);
        result.onchange = () => setGeoPermission(result.state);
      })
      .catch(() => setGeoPermission('unknown'));
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  // The "synced n s ago" line ticks while a trip runs.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) setConfirmEnd(false);
  }, [isActive]);

  if (!busId) {
    return (
      <div className="metro-turnstile flex flex-1 flex-col gap-8 px-5 py-6 md:px-8 md:py-12 lg:px-12">
        <div className="flex justify-end">
          <LanguageSelect language={language} onChange={changeLanguage} />
        </div>
        <Headline>{driverText(language, 'noBusTitle')}</Headline>
        {isOwner && <p className="text-muted-foreground">owner admin · stored role admin · driver access</p>}
        <Tile tone="outline" className="max-w-xl px-5 py-6">
          <p className="text-xl">{driverText(language, 'noBusBody')}</p>
          <p className="mt-3 text-muted-foreground">{driverText(language, 'noBusAsk')}</p>
        </Tile>
      </div>
    );
  }

  const secure = typeof window === 'undefined' || window.isSecureContext;
  const checks: Check[] = [
    { label: driverText(language, 'signedIn'), state: 'ok', detail: user?.email ?? '' },
    {
      label: driverText(language, 'busAssigned'),
      state: 'ok',
      detail: selected?.assignment ? `${busId} · ${shiftLabel(selected.assignment.shift)} · ${driverText(language, 'todayAssignment')}` : busId,
    },
    {
      // FLT-03: the API and Rules refuse Start unless the registry says active; say why up front.
      label: driverText(language, 'busInService'),
      state: activeBus?.status === 'active' ? 'ok' : 'fail',
      detail: !activeBus
        ? driverText(language, 'busNotRegistered')
        : activeBus.status === 'active'
          ? activeBus.label
          : `${driverText(language, 'busOutOfService')}${activeBus.reason ? ` (${activeBus.reason})` : ''}`,
    },
    {
      label: driverText(language, 'network'),
      state: isOnline ? 'ok' : 'fail',
      detail: isOnline ? driverText(language, 'online') : driverText(language, 'offlineCannotStart'),
    },
    {
      label: driverText(language, 'location'),
      state: !secure ? 'fail' : geoPermission === 'denied' ? 'fail' : geoPermission === 'granted' ? 'ok' : 'warn',
      detail: !secure
        ? driverText(language, 'insecureLocation')
        : geoPermission === 'denied'
          ? driverText(language, 'locationDenied')
          : geoPermission === 'granted'
            ? driverText(language, 'locationGranted')
            : driverText(language, 'locationAsk'),
    },
    { label: driverText(language, 'battery'), state: 'warn', detail: driverText(language, 'batteryHint') },
  ];
  const blocked = checks.some((c) => c.state === 'fail');
  const stamp = stamps[phase];
  const syncedAgo = tracking.lastSyncAt !== null ? Math.max(0, Math.round((Date.now() - tracking.lastSyncAt) / 1000)) : null;
  // The tracker stamps syncs on the wall clock; the tile ages fixes on the monotonic clock.
  const feedReceivedAt = tracking.lastSyncAt !== null ? performance.now() - (Date.now() - tracking.lastSyncAt) : null;
  const actualDirection = isActive ? tracking.feed?.direction ?? null : null;
  const selectedDirection = actualDirection ?? direction;
  const hasOwner = isActive && tracking.feed?.phase === 'active' && Boolean(tracking.feed.tripId);
  const displayedFull = fullPending ?? tracking.feed?.full ?? false;
  const showFullControl = Boolean(tracking.feed) && (isActive || phase === 'stopping' || phase === 'pending_end');
  const updateFull = async (): Promise<void> => {
    if (fullPending !== null || !hasOwner || !tracker.current) return;
    const next = !displayedFull;
    setFullPending(next);
    setFullError(null);
    const acknowledged = await tracker.current.setFull(next);
    if (!acknowledged) setFullError(driverText(language, 'fullError'));
    setFullPending(null);
  };

  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-8 px-5 py-6 md:px-8 md:py-12 lg:flex-row lg:gap-10 lg:px-12">
      <div className="flex flex-col gap-6 lg:w-[40%] lg:shrink-0">
        <div className="flex justify-end">
          <LanguageSelect language={language} onChange={changeLanguage} />
        </div>
        <Headline clip className="normal-case">{driverText(language, 'busLabel')} {busId}</Headline>
        {isOwner && <p className="text-muted-foreground">owner admin · stored role admin · driver access</p>}
        {options.length > 1 && (
          <label className="flex flex-col gap-2 text-base">
            <span>{driverText(language, 'pickBus')}</span>
            <select
              data-testid="select-driver-bus"
              value={busId}
              disabled={phase !== 'idle'}
              onChange={(event) => setChosenBusId(event.target.value)}
              className="h-12 border-2 border-border bg-white px-3 text-base text-foreground disabled:opacity-60"
            >
              {options.map((option) => (
                <option key={option.busId} value={option.busId}>
                  {option.busId} · {option.assignment ? `${shiftLabel(option.assignment.shift)} · ${driverText(language, 'todayAssignment')}` : driverText(language, 'usualBus')}
                </option>
              ))}
            </select>
          </label>
        )}
        <div data-testid="status-driver-tracking">
          <StateTile
            status={null}
            stamp={stamp}
            feed={tracking.feed}
            receivedAt={feedReceivedAt}
            formatAgeText={(seconds) => formatDriverAge(language, seconds)}
          />
        </div>
        <p className="sr-only" role="status">{stamp.label}</p>
        <p className="-mt-3 text-muted-foreground">
          {stamp.hint}
          {syncedAgo !== null && isActive && (
            <span className="tabular-nums"> · {driverText(language, 'synced')} {syncedAgo} s ago</span>
          )}
        </p>
        {tracking.error && (
          <p role="alert" className="text-destructive">
            {translateDriverError(tracking.error, language)}
          </p>
        )}
        {fullError && <p role="alert" className="text-destructive">{fullError}</p>}

        {(phase === 'idle' || phase === 'conflict') && (
          <fieldset className="flex flex-col gap-2" data-testid="direction-selector">
            <legend className="text-xl">{driverText(language, 'direction')}</legend>
            <p className="text-muted-foreground">{driverText(language, 'directionHelp')}</p>
            <div className="grid grid-cols-2 gap-2">
              <TileButton
                tone={direction === 'toCampus' ? 'blue' : 'outline'}
                aria-pressed={direction === 'toCampus'}
                data-testid="button-direction-to-campus"
                onClick={() => setDirection('toCampus')}
                className="min-h-20 text-lg"
              >
                {driverText(language, 'toCampus')}
              </TileButton>
              <TileButton
                tone={direction === 'fromCampus' ? 'blue' : 'outline'}
                aria-pressed={direction === 'fromCampus'}
                data-testid="button-direction-from-campus"
                onClick={() => setDirection('fromCampus')}
                className="min-h-20 text-lg"
              >
                {driverText(language, 'fromCampus')}
              </TileButton>
            </div>
          </fieldset>
        )}
        {isActive && selectedDirection && (
          <Tile tone="white" className="px-5 py-4" data-testid="status-trip-direction">
            <span className="text-base text-muted-foreground">{driverText(language, 'direction')}</span>
            <p className="text-xl">
              {selectedDirection === 'toCampus' ? driverText(language, 'toCampus') : driverText(language, 'fromCampus')}
            </p>
          </Tile>
        )}
        {showFullControl && tracking.feed && (
          <div className="flex flex-col gap-2" data-testid="control-bus-full" aria-live="polite">
            <span className="text-xl">{driverText(language, 'full')}</span>
            <TileButton
              tone={displayedFull ? 'blue' : 'outline'}
              aria-pressed={displayedFull}
              aria-busy={fullPending !== null}
              data-testid="button-toggle-bus-full"
              onClick={() => void updateFull()}
              disabled={!hasOwner || fullPending !== null}
              className="min-h-20 text-xl"
            >
              <span>
                {fullPending !== null
                  ? driverText(language, 'updating')
                  : displayedFull
                    ? driverText(language, 'fullYes')
                    : driverText(language, 'fullNo')}
              </span>
            </TileButton>
          </div>
        )}

        {/* Primary action per phase */}
        {phase === 'idle' || phase === 'conflict' ? (
          <TileButton
            tone="blue"
            className="min-h-28 text-2xl"
            onClick={() => direction && void tracker.current?.start(direction)}
            disabled={blocked || direction === null}
            data-testid="button-start-trip"
          >
            <span>{phase === 'conflict' ? driverText(language, 'startAgain') : driverText(language, 'startTrip')}</span>
            <Play className="h-8 w-8" strokeWidth={1.5} aria-hidden />
          </TileButton>
        ) : phase === 'starting' ? (
          <TileButton
            tone="outline"
            className="min-h-28 text-2xl"
            onClick={() => void tracker.current?.stop()}
            data-testid="button-cancel-starting"
          >
            <span>{driverText(language, 'cancelStarting')}</span>
            <X className="h-8 w-8" strokeWidth={1.5} aria-hidden />
          </TileButton>
        ) : phase === 'stopping' ? (
          <TileButton tone="outline" className="min-h-28 text-2xl" disabled data-testid="button-ending">
            <span>{driverText(language, 'ending')}</span>
            <Square className="h-8 w-8" strokeWidth={1.5} aria-hidden />
          </TileButton>
        ) : phase === 'pending_end' ? (
          <TileButton
            tone="outline"
            className="min-h-28 text-2xl"
            onClick={() => void tracker.current?.reconnect()}
            data-testid="button-retry-end"
          >
            <span>{driverText(language, 'retryEnd')}</span>
            <RefreshCw className="h-8 w-8" strokeWidth={1.5} aria-hidden />
          </TileButton>
        ) : phase === 'recovery' ? (
          <TileButton
            tone="red"
            className="min-h-28 text-2xl"
            onClick={() => void tracker.current?.stop()}
            data-testid="button-end-recovered"
          >
            <span>{driverText(language, 'endRecovered')}</span>
            <Square className="h-8 w-8" strokeWidth={1.5} aria-hidden />
          </TileButton>
        ) : !confirmEnd ? (
          <TileButton
            tone="outline"
            className="min-h-28 text-2xl"
            onClick={() => setConfirmEnd(true)}
            data-testid="button-end-trip"
          >
            <span>{driverText(language, 'endTrip')}</span>
            <Square className="h-8 w-8" strokeWidth={1.5} aria-hidden />
          </TileButton>
        ) : (
          <div className="flex flex-col gap-2" role="group" aria-label={driverText(language, 'endTrip')}>
            <p className="text-lg">{driverText(language, 'endPrompt')}</p>
            <div className="grid grid-cols-2 gap-2">
              <TileButton
                tone="red"
                className="min-h-20 text-xl"
                data-testid="button-confirm-end-trip"
                onClick={() => {
                  setConfirmEnd(false);
                  void tracker.current?.stop();
                }}
              >
                {driverText(language, 'confirmEnd')}
              </TileButton>
              <TileButton
                tone="outline"
                className="min-h-20 text-xl"
                onClick={() => setConfirmEnd(false)}
                data-testid="button-keep-driving"
              >
                {driverText(language, 'keepDriving')}
              </TileButton>
            </div>
          </div>
        )}
        {(phase === 'idle' || phase === 'conflict') && blocked && (
          <p className="text-destructive">{driverText(language, 'checklistFix')}</p>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Headline as="h2" size="section">
          {driverText(language, 'beforeStart')}
        </Headline>
        <ul className="flex flex-col">
          {checks.map((check) => {
            const Icon = check.state === 'ok' ? Check : check.state === 'warn' ? Minus : X;
            return (
              <li key={check.label} className="flex items-start gap-4 border-t-2 border-border/50 py-4 first:border-t-0">
                <span
                  className={cn(
                    'mt-1 flex h-8 w-8 shrink-0 items-center justify-center',
                    check.state === 'ok' && 'bg-primary text-primary-foreground',
                    check.state === 'warn' && 'border-2 border-foreground text-foreground',
                    check.state === 'fail' && 'bg-destructive text-white',
                  )}
                  aria-label={
                    check.state === 'ok'
                      ? driverText(language, 'ok')
                      : check.state === 'warn'
                        ? driverText(language, 'note')
                        : driverText(language, 'problem')
                  }
                >
                  <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-2xl font-light">{check.label}</span>
                  <span className={cn('break-words', check.state === 'fail' ? 'text-destructive' : 'text-muted-foreground')}>{check.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground">
          {driverText(language, 'backgroundHelp')}
        </p>
      </div>
    </div>
  );
}
