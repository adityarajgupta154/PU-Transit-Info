import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, MockFirebaseServiceError } = vi.hoisted(() => {
  class ServiceError extends Error {
    code: "config" | "unavailable" | "rules" | "conflict";

    constructor(code: ServiceError["code"], message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    state: {
      value: null as Record<string, unknown> | null,
      version: 0,
    },
    MockFirebaseServiceError: ServiceError,
  };
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveServerValues(value: unknown, now: number): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveServerValues(item, now));
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (object[".sv"] === "timestamp") return now;
    return Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, resolveServerValues(item, now)]),
    );
  }
  return value;
}

vi.mock("./firebase", () => ({
  FirebaseServiceError: MockFirebaseServiceError,
  readFirebase: vi.fn(async (path: string, _token: string, withEtag = false) => {
    if (path === "tracking") {
      return { value: state.value ? { "BUS-1": state.value } : null };
    }
    if (path === "tracking/BUS-1/feed") {
      return { value: state.value?.feed ?? null };
    }
    return {
      value: state.value ? clone(state.value) : null,
      etag: withEtag ? `etag-${state.version}` : undefined,
    };
  }),
  writeFirebase: vi.fn(async (
    _path: string,
    _token: string,
    _method: string,
    value: unknown,
    headers: Record<string, string>,
  ) => {
    const expected = headers["If-Match"];
    const current = `etag-${state.version}`;
    if (expected !== current && !(state.version === 0 && expected === "null_etag")) {
      throw new MockFirebaseServiceError("conflict", "CAS conflict");
    }
    state.value = resolveServerValues(value, Date.now()) as Record<string, unknown>;
    state.version += 1;
    return clone(state.value);
  }),
  serverTimestamp: () => ({ ".sv": "timestamp" }),
}));

import {
  GPS_FRESH_MS,
  START_WINDOW_MS,
  endTracking,
  forceEndTracking,
  publicFeed,
  sendTrackingHeartbeat,
  startTracking,
  submitTrackingSample,
  TrackingConflictError,
  type StartInput,
} from "./tracking";

const uid = "driver-uid";
const publisherId = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const nextPublisherId = "33333333-3333-4333-8333-333333333333";
const nextTripId = "44444444-4444-4444-8444-444444444444";

function startInput(overrides: Partial<StartInput> = {}): StartInput {
  return {
    tripId,
    publisherId,
    expectedGeneration: 0,
    requestedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  state.value = null;
  state.version = 0;
});

describe("reliable tracking state machine", () => {
  it("serializes concurrent starts and returns the original attempt on retry", async () => {
    const input = startInput();
    const results = await Promise.all([
      startTracking("token", uid, "BUS-1", input),
      startTracking("token", uid, "BUS-1", input),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    expect(state.value?.feed).toMatchObject({ generation: 1, tripId, phase: "active" });
    expect((state.value as Record<string, unknown>).driverUid).toBe(uid);
  });

  it("returns an exact active retry even after the start deadline", async () => {
    const input = startInput();
    const started = await startTracking("token", uid, "BUS-1", input);

    vi.advanceTimersByTime(START_WINDOW_MS + 1);

    const retry = await startTracking("token", uid, "BUS-1", input);
    expect(retry.status).toBe(200);
    expect(retry.session).toMatchObject({
      tripId: started.session.tripId,
      publisherId: started.session.publisherId,
      generation: started.session.generation,
      sequence: started.session.sequence,
      feed: {
        tripId: started.session.feed.tripId,
        generation: started.session.feed.generation,
        phase: started.session.feed.phase,
      },
    });
    expect(retry.session.feed.serverTime).toBe(Date.now());
  });

  it("rejects old generations, repeated sequences, and older captures", async () => {
    const input = startInput();
    await startTracking("token", uid, "BUS-1", input);
    await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 1,
      capturedAt: Date.now(),
      lat: 22,
      lng: 73,
      accuracy: 10,
    });

    await expect(
      submitTrackingSample("token", uid, "BUS-1", {
        tripId,
        publisherId,
        generation: 0,
        sequence: 2,
        capturedAt: Date.now(),
        lat: 22,
        lng: 73,
        accuracy: 10,
      }),
    ).rejects.toMatchObject({ conflictCode: "INVALID_SAMPLE" });
    await expect(
      submitTrackingSample("token", uid, "BUS-1", {
        tripId,
        publisherId,
        generation: 1,
        sequence: 1,
        capturedAt: Date.now(),
        lat: 22,
        lng: 73,
        accuracy: 10,
      }),
    ).rejects.toMatchObject({ conflictCode: "SEQUENCE_REPLAY" });
    await expect(
      submitTrackingSample("token", uid, "BUS-1", {
        tripId,
        publisherId,
        generation: 1,
        sequence: 2,
        capturedAt: Date.now(),
        lat: 22,
        lng: 73,
        accuracy: 10,
      }),
    ).rejects.toMatchObject({ conflictCode: "STALE_CAPTURE" });
    await expect(
      submitTrackingSample("token", uid, "BUS-1", {
        tripId,
        publisherId,
        generation: 1,
        sequence: 2,
        capturedAt: Date.now() - 1,
        lat: 22,
        lng: 73,
        accuracy: 10,
      }),
    ).rejects.toMatchObject({ conflictCode: "STALE_CAPTURE" });
  });

  it("keeps the last valid fix when a weak report arrives", async () => {
    const input = startInput();
    await startTracking("token", uid, "BUS-1", input);
    await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 1,
      capturedAt: Date.now(),
      lat: 22,
      lng: 73,
      accuracy: 10,
    });
    const validCapturedAt = (state.value?.feed as Record<string, unknown>).lastValidCapturedAt;
    vi.advanceTimersByTime(1);

    const result = await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 2,
      capturedAt: Date.now(),
      lat: 25,
      lng: 75,
      accuracy: 101,
    });
    expect(result.feed.status).toBe("weak_gps");
    expect(result.feed.location).toEqual({ lat: 22, lng: 73, accuracy: 10 });
    expect(result.feed.lastValidCapturedAt).toBe(validCapturedAt);
    expect(result.feed.reportedAccuracy).toBe(101);
  });

  it("allows an unavailable heartbeat with the next sequence and preserves GPS history", async () => {
    await startTracking("token", uid, "BUS-1", startInput());
    await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 1,
      capturedAt: Date.now(),
      lat: 22,
      lng: 73,
      accuracy: 10,
    });
    const before = clone(state.value?.feed) as Record<string, unknown>;

    const result = await sendTrackingHeartbeat("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 2,
      gpsUnavailable: true,
    });

    expect(result.sequence).toBe(2);
    expect(result.feed.status).toBe("gps_unavailable");
    expect(result.feed.gpsQuality).toBe("unavailable");
    expect(result.feed.lastReportCapturedAt).toBe(before.lastReportCapturedAt);
    expect(result.feed.lastReportReceivedAt).toBe(before.lastReportReceivedAt);
    expect(result.feed.reportedAccuracy).toBe(before.reportedAccuracy);
    expect(result.feed.lastValidCapturedAt).toBe(before.lastValidCapturedAt);
    expect(result.feed.lastValidReceivedAt).toBe(before.lastValidReceivedAt);
    expect(result.feed.location).toEqual(before.location);
  });

  it("carries direction and the bus-full flag while active and drops full at End", async () => {
    const input = startInput({ direction: "fromCampus" });
    const started = await startTracking("token", uid, "BUS-1", input);
    expect(started.session.feed).toMatchObject({ direction: "fromCampus", full: false });

    const sample = await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 1,
      capturedAt: Date.now(),
      lat: 22,
      lng: 73,
      accuracy: 10,
      full: true,
    });
    expect(sample.feed.full).toBe(true);

    const heartbeat = await sendTrackingHeartbeat("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 2,
    });
    expect(heartbeat.feed.full).toBe(true);
    expect(heartbeat.feed.direction).toBe("fromCampus");

    const ended = await endTracking("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      requestedAt: input.requestedAt,
    });
    expect(ended.feed.full).toBe(false);
    expect(ended.feed.direction).toBe("fromCampus");
  });

  it("ages a weak report despite a healthy heartbeat", async () => {
    const input = startInput();
    await startTracking("token", uid, "BUS-1", input);
    await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 1,
      capturedAt: Date.now(),
      lat: 22,
      lng: 73,
      accuracy: 10,
    });
    vi.advanceTimersByTime(1);
    await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 2,
      capturedAt: Date.now(),
      lat: 25,
      lng: 75,
      accuracy: 101,
    });

    vi.advanceTimersByTime(GPS_FRESH_MS + 1);
    const heartbeat = await sendTrackingHeartbeat("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 3,
    });

    expect(heartbeat.feed.status).toBe("delayed");
    expect(heartbeat.feed.location).toEqual({ lat: 22, lng: 73, accuracy: 10 });
    expect(heartbeat.feed.freshUntil).toBe(0);
  });

  it("rejects stale and materially future captures", async () => {
    await startTracking("token", uid, "BUS-1", startInput());
    await expect(
      submitTrackingSample("token", uid, "BUS-1", {
        tripId,
        publisherId,
        generation: 1,
        sequence: 1,
        capturedAt: Date.now() - 30_001,
        lat: 22,
        lng: 73,
        accuracy: 10,
      }),
    ).rejects.toMatchObject({ conflictCode: "STALE_CAPTURE" });
    await expect(
      submitTrackingSample("token", uid, "BUS-1", {
        tripId,
        publisherId,
        generation: 1,
        sequence: 1,
        capturedAt: Date.now() + 5_001,
        lat: 22,
        lng: 73,
        accuracy: 10,
      }),
    ).rejects.toMatchObject({ conflictCode: "FUTURE_TIMESTAMP" });
  });

  it("allows an explicit takeover only after the heartbeat lease expires", async () => {
    await startTracking("token", uid, "BUS-1", startInput());
    await expect(
      startTracking("token", "other-driver", "BUS-1", startInput({
        tripId: nextTripId,
        publisherId: nextPublisherId,
        expectedGeneration: 1,
      })),
    ).rejects.toMatchObject({ conflictCode: "OWNER_ACTIVE" });

    vi.advanceTimersByTime(90_001);
    const result = await startTracking("token", "other-driver", "BUS-1", startInput({
      tripId: nextTripId,
      publisherId: nextPublisherId,
      expectedGeneration: 1,
    }));
    expect(result.status).toBe(201);
    expect(result.session.generation).toBe(2);
    expect(result.session.publisherId).toBe(nextPublisherId);
  });

  it("cancels an expired pending End behind a healthy preceding owner", async () => {
    await startTracking("token", uid, "BUS-1", startInput());
    const requestedAt = Date.now();
    const input = {
      tripId: nextTripId,
      publisherId: nextPublisherId,
      generation: 2,
      requestedAt,
    };

    const pending = await endTracking("token", uid, "BUS-1", input);
    expect(pending).toMatchObject({ acknowledged: false, outcome: "pending" });
    const versionBeforeExpiry = state.version;

    vi.advanceTimersByTime(START_WINDOW_MS + 1);

    const cancelled = await endTracking("token", uid, "BUS-1", input);
    expect(cancelled).toMatchObject({ acknowledged: true, outcome: "cancelled" });
    expect(state.version).toBe(versionBeforeExpiry);
    expect(cancelled.feed.generation).toBe(1);
    expect(cancelled.feed.phase).toBe("active");
  });

  it("ends atomically, cancels a delayed start, and never exposes private ownership", async () => {
    const input = startInput();
    await startTracking("token", uid, "BUS-1", input);
    await submitTrackingSample("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      sequence: 1,
      capturedAt: Date.now(),
      lat: 22,
      lng: 73,
      accuracy: 10,
    });
    const result = await endTracking("token", uid, "BUS-1", {
      tripId,
      publisherId,
      generation: 1,
      requestedAt: input.requestedAt,
    });
    expect(result).toMatchObject({ acknowledged: true, outcome: "ended" });
    expect(result.feed.location).toBeNull();
    expect(result.feed.status).toBe("ended");
    expect(JSON.stringify(result)).not.toContain("driverUid");

    await expect(startTracking("token", uid, "BUS-1", input)).rejects.toMatchObject({
      conflictCode: "START_CANCELLED",
    });
    await expect(
      sendTrackingHeartbeat("token", uid, "BUS-1", {
        tripId,
        publisherId,
        generation: 1,
        sequence: 2,
      }),
    ).rejects.toMatchObject({ conflictCode: "SESSION_CONFLICT" });
  });

  it("writes an End tombstone before acknowledging a not-yet-created trip", async () => {
    const input = {
      tripId,
      publisherId,
      generation: 1,
      requestedAt: Date.now(),
    };
    const ended = await endTracking("token", uid, "BUS-1", input);
    expect(ended).toMatchObject({ acknowledged: true, outcome: "cancelled" });
    expect((state.value?.feed as Record<string, unknown>).phase).toBe("ended");
    await expect(startTracking("token", uid, "BUS-1", startInput())).rejects.toMatchObject({
      conflictCode: "START_CANCELLED",
    });
  });

  it("force-ends an active trip and is idempotent for an ended trip", async () => {
    await startTracking("token", uid, "BUS-1", startInput());
    const ended = await forceEndTracking("token", "admin", "BUS-1");
    expect(ended).toMatchObject({
      outcome: "ended",
      driverUid: uid,
      tripId,
      generation: 1,
      feed: { phase: "ended", location: null },
    });
    const repeated = await forceEndTracking("token", "admin", "BUS-1");
    expect(repeated.outcome).toBe("already_ended");
    expect(state.version).toBe(2);
  });

  it("reports NOT_STARTED when an admin force-ends an absent bus", async () => {
    await expect(forceEndTracking("token", "admin", "BUS-1")).rejects.toMatchObject({
      conflictCode: "NOT_STARTED",
    });
  });
});

describe("feed DTO", () => {
  it("hides coordinates for offline feeds and keeps the DTO sanitized", () => {
    const node = {
      driverUid: uid,
      publisherId,
      sequence: 2,
      feed: {
        protocolVersion: 2 as const,
        busId: "BUS-1",
        tripId,
        generation: 1,
        phase: "active" as const,
        requestedAt: 1_700_000_000_000,
        startedAt: 1_700_000_000_000,
        endedAt: 0,
        heartbeatAt: 1_700_000_000_000,
        gpsQuality: "good" as const,
        lastReportCapturedAt: 1_700_000_000_000,
        lastReportReceivedAt: 1_700_000_000_000,
        reportedAccuracy: 10,
        lastValidCapturedAt: 1_700_000_000_000,
        lastValidReceivedAt: 1_700_000_000_000,
        location: { lat: 22, lng: 73, accuracy: 10 },
      },
    };
    const feed = publicFeed(node, "BUS-1", 1_700_000_100_000);
    expect(feed.status).toBe("offline");
    expect(feed.location).toBeNull();
    expect(JSON.stringify(feed)).not.toContain("publisherId");
    expect(JSON.stringify(feed)).not.toContain("driverUid");
  });
});