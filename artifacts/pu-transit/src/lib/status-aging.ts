import type { LiveTrackingFeed, LiveTrackingFeedStatus } from '@workspace/api-client-react';

export function calculateAgedStatus(
  feed: LiveTrackingFeed,
  receivedAt: number,
  now: number
): LiveTrackingFeedStatus {
  if (feed.phase !== 'active' || feed.status === 'not_started' || feed.status === 'ended') {
    return feed.status;
  }

  const elapsed = now - receivedAt;
  const serverNow = feed.serverTime + elapsed;
  
  if (serverNow > feed.offlineAfter) {
    return 'offline';
  }

  if (feed.status === 'live') {
    if (serverNow > feed.freshUntil) {
      return 'delayed';
    }
  } else if (feed.status === 'weak_gps') {
    if (serverNow > feed.freshUntil) {
      return (feed.lastValidCapturedAt > 0) ? 'delayed' : 'gps_unavailable';
    }
  }

  return feed.status;
}
