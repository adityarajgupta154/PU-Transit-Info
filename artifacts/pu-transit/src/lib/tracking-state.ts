import type { LiveTrackingFeed, LiveTrackingFeedStatus } from '@workspace/api-client-react';

/**
 * One stamp per tracking state. The tone is the whole message:
 *  - blue    = the bus is live right now
 *  - outline = waiting on something (white tile, ink outline)
 *  - red     = a fault the rider should not trust the map through
 *  - ended   = the trip is over (10% ink wash)
 */
export type StateTone = 'blue' | 'outline' | 'red' | 'ended';

export type StateStamp = {
  label: string;
  tone: StateTone;
  /** One line of what the rider should do with this state. */
  hint: string;
};

export const TRACKING_STAMPS: Record<LiveTrackingFeedStatus, StateStamp> = {
  not_started: { label: 'not running', tone: 'outline', hint: 'the driver has not started this trip yet' },
  acquiring: { label: 'starting', tone: 'outline', hint: 'trip started, waiting for the first gps fix' },
  live: { label: 'live', tone: 'blue', hint: 'position is fresh' },
  delayed: { label: 'delayed', tone: 'outline', hint: 'last fix is stale, showing the last known position' },
  weak_gps: { label: 'weak gps', tone: 'outline', hint: 'fix is coarse, position may be off by a street' },
  gps_unavailable: { label: 'gps lost', tone: 'red', hint: 'no usable fix, last known position only' },
  offline: { label: 'offline', tone: 'red', hint: 'the driver device stopped reporting' },
  ended: { label: 'ended', tone: 'ended', hint: 'the driver ended this trip' },
};

export function stampFor(status: LiveTrackingFeedStatus | null): StateStamp {
  return status ? TRACKING_STAMPS[status] : TRACKING_STAMPS.not_started;
}

/** Estimated server clock now, given the feed's serverTime and when we received it. */
export function serverNow(feed: LiveTrackingFeed, receivedAt: number, now: number): number {
  return feed.serverTime + (now - receivedAt);
}

/** Age of the last valid fix in whole seconds, or null when there has never been one. */
export function fixAgeSeconds(feed: LiveTrackingFeed, receivedAt: number, now: number): number | null {
  if (!feed.lastValidCapturedAt) return null;
  return Math.max(0, Math.round((serverNow(feed, receivedAt, now) - feed.lastValidCapturedAt) / 1000));
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) return 'no fix yet';
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}
