import { describe, expect, it } from 'vitest';
import { calculateAgedStatus } from './status-aging';
import type { LiveTrackingFeed, LiveTrackingFeedStatus } from '@workspace/api-client-react';

const baseFeed: LiveTrackingFeed = {
  direction: null,
  full: false,
  protocolVersion: 2,
  busId: 'BUS-1',
  tripId: 'trip-1',
  generation: 1,
  phase: 'active',
  requestedAt: 1000,
  startedAt: 1000,
  endedAt: 0,
  heartbeatAt: 1000,
  gpsQuality: 'good',
  lastReportCapturedAt: 1000,
  lastReportReceivedAt: 1000,
  reportedAccuracy: 10,
  lastValidCapturedAt: 1000,
  lastValidReceivedAt: 1000,
  location: { lat: 0, lng: 0, accuracy: 10 },
  status: 'live',
  serverTime: 1000,
  freshUntil: 1500,
  offlineAfter: 2000,
};

describe('calculateAgedStatus', () => {
  it('returns current status if not active', () => {
    const feed = { ...baseFeed, phase: 'ended' as const, status: 'ended' as LiveTrackingFeedStatus };
    expect(calculateAgedStatus(feed, 100, 200)).toBe('ended');
  });

  it('does not age live status if within freshUntil', () => {
    expect(calculateAgedStatus({ ...baseFeed, status: 'live' }, 100, 100 + 400)).toBe('live'); // serverNow = 1400
  });

  it('ages live status to delayed after freshUntil', () => {
    expect(calculateAgedStatus({ ...baseFeed, status: 'live' }, 100, 100 + 600)).toBe('delayed'); // serverNow = 1600
  });

  it('ages live status to offline after offlineAfter', () => {
    expect(calculateAgedStatus({ ...baseFeed, status: 'live' }, 100, 100 + 1100)).toBe('offline'); // serverNow = 2100
  });

  it('ages delayed status to offline after offlineAfter', () => {
    expect(calculateAgedStatus({ ...baseFeed, status: 'delayed' }, 100, 100 + 1100)).toBe('offline'); // serverNow = 2100
  });

  it('ages weak_gps to delayed if lastValidCapturedAt > 0 after freshUntil', () => {
    const feed = { ...baseFeed, status: 'weak_gps' as LiveTrackingFeedStatus, lastValidCapturedAt: 1000 };
    expect(calculateAgedStatus(feed, 100, 100 + 600)).toBe('delayed');
  });

  it('ages weak_gps to gps_unavailable if lastValidCapturedAt === 0 after freshUntil', () => {
    const feed = { ...baseFeed, status: 'weak_gps' as LiveTrackingFeedStatus, lastValidCapturedAt: 0 };
    expect(calculateAgedStatus(feed, 100, 100 + 600)).toBe('gps_unavailable');
  });

  it('ages weak_gps to offline after offlineAfter', () => {
    const feed = { ...baseFeed, status: 'weak_gps' as LiveTrackingFeedStatus, lastValidCapturedAt: 1000 };
    expect(calculateAgedStatus(feed, 100, 100 + 1100)).toBe('offline');
  });
});
