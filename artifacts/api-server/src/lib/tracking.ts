import type { Request } from "express";
import {
  FirebaseServiceError,
  readFirebase,
  serverTimestamp,
  writeFirebase,
} from "./firebase";

export const START_WINDOW_MS = 30_000;
export const GPS_FRESH_MS = 30_000;
export const HEARTBEAT_LEASE_MS = 90_000;
export const MAX_FUTURE_CAPTURE_MS = 5_000;
const SAFE_BUS_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

type StoredLocation = { lat: number; lng: number; accuracy: number };
export type TripDirection = "toCampus" | "fromCampus";
type StoredFeed = {
  protocolVersion: 2;
  busId: string;
  tripId: string | null;
  generation: number;
  phase: "active" | "ended";
  requestedAt: number;
  startedAt: number;
  endedAt: number;
  heartbeatAt: number;
  gpsQuality: "acquiring" | "good" | "weak" | "unavailable";
  lastReportCapturedAt: number;
  lastReportReceivedAt: number;
  reportedAccuracy: number;
  lastValidCapturedAt: number;
  lastValidReceivedAt: number;
  location?: StoredLocation | null;
  direction?: TripDirection;
  full?: boolean;
  /** RTE-02: published route versions pinned at Start, keyed by route id. */
  routeVersions?: Record<string, number>;
  /** ASG-01: the dated assignment that admitted Start when the standing bus did not match; frozen for the trip. */
  assignmentId?: string;
};

export type StoredTrackingNode = {
  driverUid: string;
  publisherId: string;
  sequence: number;
  feed: StoredFeed;
};

export type StartInput = {
  tripId: string;
  publisherId: string;
  expectedGeneration: number;
  requestedAt: number;
  direction?: TripDirection;
  /** Set by the API, never by the client (the strict body rejects it). */
  routeVersions?: Record<string, number>;
  /** Set by the API from the admitting dated assignment (ASG-01). */
  assignmentId?: string;
};

export type SampleInput = {
  tripId: string;
  publisherId: string;
  generation: number;
  sequence: number;
  capturedAt: number;
  lat: number;
  lng: number;
  accuracy: number;
  full?: boolean;
};

export type HeartbeatInput = {
  tripId: string;
  publisherId: string;
  generation: number;
  sequence: number;
  gpsUnavailable?: boolean;
  full?: boolean;
};

export type EndInput = {
  tripId: string;
  publisherId: string;
  generation: number;
  requestedAt: number;
};

export type PublicTrackingFeed = {
  protocolVersion: 2;
  busId: string;
  tripId: string | null;
  generation: number;
  phase: "not_started" | "active" | "ended";
  requestedAt: number;
  startedAt: number;
  endedAt: number;
  heartbeatAt: number;
  gpsQuality: StoredFeed["gpsQuality"];
  lastReportCapturedAt: number;
  lastReportReceivedAt: number;
  reportedAccuracy: number;
  lastValidCapturedAt: number;
  lastValidReceivedAt: number;
  location: StoredLocation | null;
  direction: TripDirection | null;
  full: boolean;
  routeVersions: Record<string, number>;
  status:
    | "not_started"
    | "acquiring"
    | "live"
    | "delayed"
    | "weak_gps"
    | "gps_unavailable"
    | "offline"
    | "ended";
  serverTime: number;
  freshUntil: number;
  offlineAfter: number;
};

export type TripSession = {
  tripId: string;
  publisherId: string;
  generation: number;
  sequence: number;
  feed: PublicTrackingFeed;
};

export type EndOutcome = "ended" | "superseded" | "cancelled" | "pending";

export type TripEndResult = {
  acknowledged: boolean;
  outcome: EndOutcome;
  feed: PublicTrackingFeed;
};

export type ForceEndResult = {
  outcome: "ended" | "already_ended";
  feed: PublicTrackingFeed;
  driverUid: string;
  tripId: string;
  generation: number;
};

export class TrackingConflictError extends Error {
  readonly conflictCode: string;

  constructor(conflictCode: string, message: string) {
    super(message);
    this.name = "TrackingConflictError";
    this.conflictCode = conflictCode;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeInteger(value: unknown): value is number {
  return finiteNumber(value) && Number.isSafeInteger(value);
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function locationFromValue(value: unknown): StoredLocation | null {
  if (value === null || value === undefined) return null;
  if (
    !record(value) ||
    !exactKeys(value, ["lat", "lng", "accuracy"]) ||
    !finiteNumber(value.lat) ||
    !finiteNumber(value.lng) ||
    !finiteNumber(value.accuracy) ||
    value.lat < -90 ||
    value.lat > 90 ||
    value.lng < -180 ||
    value.lng > 180 ||
    value.accuracy < 0 ||
    value.accuracy > 100
  ) {
    return null;
  }
  return { lat: value.lat, lng: value.lng, accuracy: value.accuracy };
}

function feedFromValue(value: unknown, busId: string): StoredFeed | null {
  if (!record(value)) return null;
  const keys = [
    "protocolVersion",
    "busId",
    "tripId",
    "generation",
    "phase",
    "requestedAt",
    "startedAt",
    "endedAt",
    "heartbeatAt",
    "gpsQuality",
    "lastReportCapturedAt",
    "lastReportReceivedAt",
    "reportedAccuracy",
    "lastValidCapturedAt",
    "lastValidReceivedAt",
    "location",
    "direction",
    "full",
    "routeVersions",
    "assignmentId",
  ];
  if (
    !exactKeys(value, keys) ||
    (value.routeVersions !== undefined && !routeVersionMap(value.routeVersions)) ||
    (value.assignmentId !== undefined && typeof value.assignmentId !== "string") ||
    (value.direction !== undefined && value.direction !== "toCampus" && value.direction !== "fromCampus") ||
    (value.full !== undefined && typeof value.full !== "boolean") ||
    value.protocolVersion !== 2 ||
    value.busId !== busId ||
    (value.tripId !== null && !uuid(value.tripId)) ||
    !safeInteger(value.generation) ||
    value.generation < 1 ||
    (value.phase !== "active" && value.phase !== "ended") ||
    !safeInteger(value.requestedAt) ||
    value.requestedAt < 0 ||
    !safeInteger(value.startedAt) ||
    value.startedAt < 0 ||
    !safeInteger(value.endedAt) ||
    value.endedAt < 0 ||
    !safeInteger(value.heartbeatAt) ||
    value.heartbeatAt < 0 ||
    !["acquiring", "good", "weak", "unavailable"].includes(String(value.gpsQuality)) ||
    !safeInteger(value.lastReportCapturedAt) ||
    value.lastReportCapturedAt < 0 ||
    !safeInteger(value.lastReportReceivedAt) ||
    value.lastReportReceivedAt < 0 ||
    !finiteNumber(value.reportedAccuracy) ||
    value.reportedAccuracy < 0 ||
    !safeInteger(value.lastValidCapturedAt) ||
    value.lastValidCapturedAt < 0 ||
    !safeInteger(value.lastValidReceivedAt) ||
    value.lastValidReceivedAt < 0
  ) {
    return null;
  }
  const location = locationFromValue(value.location);
  if (value.location !== null && value.location !== undefined && !location) return null;
  return {
    protocolVersion: 2,
    busId,
    tripId: value.tripId as string | null,
    generation: value.generation,
    phase: value.phase as StoredFeed["phase"],
    requestedAt: value.requestedAt,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    heartbeatAt: value.heartbeatAt,
    gpsQuality: value.gpsQuality as StoredFeed["gpsQuality"],
    lastReportCapturedAt: value.lastReportCapturedAt,
    lastReportReceivedAt: value.lastReportReceivedAt,
    reportedAccuracy: value.reportedAccuracy,
    lastValidCapturedAt: value.lastValidCapturedAt,
    lastValidReceivedAt: value.lastValidReceivedAt,
    location,
    ...(value.direction === undefined ? {} : { direction: value.direction as TripDirection }),
    ...(value.full === undefined ? {} : { full: value.full as boolean }),
    ...(value.routeVersions === undefined ? {} : { routeVersions: value.routeVersions as Record<string, number> }),
    ...(value.assignmentId === undefined ? {} : { assignmentId: value.assignmentId as string }),
  };
}

function routeVersionMap(value: unknown): value is Record<string, number> {
  return (
    record(value) &&
    Object.entries(value).every(([id, n]) => uuid(id) && safeInteger(n) && (n as number) >= 1)
  );
}

export function parseTrackingFeed(value: unknown, busId: string): StoredFeed | null {
  return feedFromValue(value, busId);
}

export function parseTrackingNode(value: unknown, busId: string): StoredTrackingNode | null {
  if (!record(value) || !exactKeys(value, ["driverUid", "publisherId", "sequence", "feed"])) {
    return null;
  }
  const feed = feedFromValue(value.feed, busId);
  if (
    typeof value.driverUid !== "string" ||
    value.driverUid.length === 0 ||
    !uuid(value.publisherId) ||
    !safeInteger(value.sequence) ||
    value.sequence < 0 ||
    !feed
  ) {
    return null;
  }
  return {
    driverUid: value.driverUid,
    publisherId: value.publisherId,
    sequence: value.sequence,
    feed,
  };
}

function emptyFeed(busId: string): PublicTrackingFeed {
  return {
    protocolVersion: 2,
    busId,
    tripId: null,
    generation: 0,
    phase: "not_started",
    requestedAt: 0,
    startedAt: 0,
    endedAt: 0,
    heartbeatAt: 0,
    gpsQuality: "acquiring",
    lastReportCapturedAt: 0,
    lastReportReceivedAt: 0,
    reportedAccuracy: 0,
    lastValidCapturedAt: 0,
    lastValidReceivedAt: 0,
    location: null,
    direction: null,
    full: false,
    routeVersions: {},
    status: "not_started",
    serverTime: Date.now(),
    freshUntil: 0,
    offlineAfter: 0,
  };
}

export function publicFeed(
  node: StoredTrackingNode | null,
  busId: string,
  now = Date.now(),
): PublicTrackingFeed {
  if (!node) {
    const feed = emptyFeed(busId);
    feed.serverTime = now;
    return feed;
  }

  return publicFeedValue(node.feed, busId, now);
}

function publicFeedValue(
  stored: StoredFeed,
  busId: string,
  now: number,
): PublicTrackingFeed {
  const offlineAfter = stored.heartbeatAt > 0 ? stored.heartbeatAt + HEARTBEAT_LEASE_MS : 0;
  let status: PublicTrackingFeed["status"];
  let location = stored.location ?? null;

  if (stored.phase === "ended") {
    status = "ended";
    location = null;
  } else if (stored.heartbeatAt <= 0 || now - stored.heartbeatAt > HEARTBEAT_LEASE_MS) {
    status = "offline";
    location = null;
  } else if (stored.gpsQuality === "unavailable") {
    status = "gps_unavailable";
  } else if (stored.gpsQuality === "weak") {
    const weakReportFresh =
      stored.lastReportCapturedAt > 0 &&
      stored.lastReportReceivedAt > 0 &&
      now - stored.lastReportCapturedAt <= GPS_FRESH_MS &&
      now - stored.lastReportReceivedAt <= GPS_FRESH_MS;
    if (weakReportFresh) {
      status = "weak_gps";
    } else if (
      stored.lastValidCapturedAt > 0 &&
      stored.lastValidReceivedAt > 0 &&
      location
    ) {
      status = "delayed";
    } else {
      status = stored.lastReportCapturedAt > 0 ? "gps_unavailable" : "acquiring";
      location = null;
    }
  } else if (
    stored.lastValidCapturedAt <= 0 ||
    stored.lastValidReceivedAt <= 0 ||
    now - stored.lastValidCapturedAt > GPS_FRESH_MS ||
    now - stored.lastValidReceivedAt > GPS_FRESH_MS
  ) {
    status = stored.lastReportCapturedAt > 0 ? "delayed" : "acquiring";
  } else {
    status = "live";
  }
  const freshUntil =
    status === "weak_gps" &&
    stored.lastReportCapturedAt > 0 &&
    stored.lastReportReceivedAt > 0
      ? Math.min(stored.lastReportCapturedAt, stored.lastReportReceivedAt) + GPS_FRESH_MS
      : status === "live" &&
          stored.lastValidCapturedAt > 0 &&
          stored.lastValidReceivedAt > 0
        ? Math.min(stored.lastValidCapturedAt, stored.lastValidReceivedAt) + GPS_FRESH_MS
        : 0;

  return {
    protocolVersion: 2,
    busId,
    tripId: stored.tripId,
    generation: stored.generation,
    phase: stored.phase,
    requestedAt: stored.requestedAt,
    startedAt: stored.startedAt,
    endedAt: stored.endedAt,
    heartbeatAt: stored.heartbeatAt,
    gpsQuality: stored.gpsQuality,
    lastReportCapturedAt: stored.lastReportCapturedAt,
    lastReportReceivedAt: stored.lastReportReceivedAt,
    reportedAccuracy: stored.reportedAccuracy,
    lastValidCapturedAt: stored.lastValidCapturedAt,
    lastValidReceivedAt: stored.lastValidReceivedAt,
    location,
    direction: stored.direction ?? null,
    full: stored.phase === "active" && stored.full === true,
    routeVersions: stored.routeVersions ?? {},
    status,
    serverTime: now,
    freshUntil,
    offlineAfter,
  };
}

function nodeForStart(
  busId: string,
  uid: string,
  input: StartInput,
): Record<string, unknown> {
  return {
    driverUid: uid,
    publisherId: input.publisherId,
    sequence: 0,
    feed: {
      protocolVersion: 2,
      busId,
      tripId: input.tripId,
      generation: input.expectedGeneration + 1,
      phase: "active",
      requestedAt: input.requestedAt,
      startedAt: serverTimestamp(),
      endedAt: 0,
      heartbeatAt: serverTimestamp(),
      gpsQuality: "acquiring",
      lastReportCapturedAt: 0,
      lastReportReceivedAt: 0,
      reportedAccuracy: 0,
      lastValidCapturedAt: 0,
      lastValidReceivedAt: 0,
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.routeVersions && Object.keys(input.routeVersions).length > 0 ? { routeVersions: input.routeVersions } : {}),
      ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    },
  };
}

function nodeForTombstone(
  busId: string,
  uid: string,
  input: EndInput,
): Record<string, unknown> {
  return {
    driverUid: uid,
    publisherId: input.publisherId,
    sequence: 0,
    feed: {
      protocolVersion: 2,
      busId,
      tripId: input.tripId,
      generation: input.generation,
      phase: "ended",
      requestedAt: input.requestedAt,
      startedAt: serverTimestamp(),
      endedAt: serverTimestamp(),
      heartbeatAt: serverTimestamp(),
      gpsQuality: "unavailable",
      lastReportCapturedAt: 0,
      lastReportReceivedAt: 0,
      reportedAccuracy: 0,
      lastValidCapturedAt: 0,
      lastValidReceivedAt: 0,
    },
  };
}

function endedNode(node: StoredTrackingNode): Record<string, unknown> {
  return {
    driverUid: node.driverUid,
    publisherId: node.publisherId,
    sequence: node.sequence,
    feed: {
      ...node.feed,
      phase: "ended",
      endedAt: serverTimestamp(),
      heartbeatAt: node.feed.heartbeatAt,
      gpsQuality: "unavailable",
      location: null,
    },
  };
}

async function currentNode(
  token: string,
  busId: string,
  withEtag = true,
): Promise<{ node: StoredTrackingNode | null; etag?: string }> {
  const result = await readFirebase<unknown>(`tracking/${busId}`, token, withEtag);
  if (result.value === null) return { node: null, etag: result.etag };
  const node = parseTrackingNode(result.value, busId);
  if (!node) {
    throw new FirebaseServiceError("unavailable", "Firebase tracking data is invalid");
  }
  return { node, etag: result.etag };
}

async function casNode(
  token: string,
  busId: string,
  mutate: (
    node: StoredTrackingNode | null,
    now: number,
  ) => { value?: Record<string, unknown>; resultStatus?: number } | null,
): Promise<{ node: StoredTrackingNode; status: number }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await currentNode(token, busId);
    const decision = mutate(current.node, Date.now());
    if (!decision) {
      throw new TrackingConflictError("CONFLICT", "Tracking operation conflicted");
    }
    if (!decision.value) {
      if (!current.node) {
        throw new FirebaseServiceError("unavailable", "Firebase tracking data disappeared");
      }
      return { node: current.node, status: decision.resultStatus ?? 200 };
    }
    try {
      await writeFirebase(
        `tracking/${busId}`,
        token,
        "PUT",
        decision.value,
        { "If-Match": current.etag ?? "null_etag" },
      );
    } catch (error) {
      if (error instanceof FirebaseServiceError && error.code === "conflict") continue;
      throw error;
    }
    const saved = await currentNode(token, busId, false);
    if (!saved.node) {
      throw new FirebaseServiceError("unavailable", "Firebase tracking write was not readable");
    }
    return { node: saved.node, status: decision.resultStatus ?? 200 };
  }
  throw new FirebaseServiceError("conflict", "Firebase tracking write conflicted");
}

function checkFuture(value: number, now: number, name: string): void {
  if (value > now + MAX_FUTURE_CAPTURE_MS) {
    throw new TrackingConflictError("FUTURE_TIMESTAMP", `${name} is too far in the future`);
  }
}

function checkAttemptFresh(requestedAt: number, now: number): void {
  checkFuture(requestedAt, now, "requestedAt");
  if (now - requestedAt > START_WINDOW_MS) {
    throw new TrackingConflictError("START_EXPIRED", "The tracking start attempt expired");
  }
}

function sameAttempt(node: StoredTrackingNode, uid: string, input: StartInput): boolean {
  return (
    node.driverUid === uid &&
    node.publisherId === input.publisherId &&
    node.feed.tripId === input.tripId &&
    node.feed.requestedAt === input.requestedAt &&
    node.feed.generation === input.expectedGeneration + 1
  );
}

function session(node: StoredTrackingNode, now: number): TripSession {
  return {
    tripId: node.feed.tripId as string,
    publisherId: node.publisherId,
    generation: node.feed.generation,
    sequence: node.sequence,
    feed: publicFeed(node, node.feed.busId, now),
  };
}

export async function readTrackingFeed(
  token: string,
  busId: string,
): Promise<PublicTrackingFeed> {
  const result = await readFirebase<unknown>(`tracking/${busId}/feed`, token, false);
  if (result.value === null) return publicFeed(null, busId);
  const feed = parseTrackingFeed(result.value, busId);
  if (!feed) {
    throw new FirebaseServiceError("unavailable", "Firebase tracking data is invalid");
  }
  return publicFeedValue(feed, busId, Date.now());
}

export async function listTrackingFeeds(
  token: string,
): Promise<Record<string, PublicTrackingFeed>> {
  const result = await readFirebase<unknown>("tracking", token, false);
  if (result.value === null) return {};
  if (!record(result.value)) {
    throw new FirebaseServiceError("unavailable", "Firebase tracking data is invalid");
  }
  const feeds: Record<string, PublicTrackingFeed> = {};
  for (const [busId, value] of Object.entries(result.value)) {
    if (!SAFE_BUS_ID.test(busId)) {
      throw new FirebaseServiceError("unavailable", "Firebase tracking data is invalid");
    }
    if (value === null) continue;
    const node = parseTrackingNode(value, busId);
    if (!node) {
      throw new FirebaseServiceError("unavailable", "Firebase tracking data is invalid");
    }
    feeds[busId] = publicFeed(node, busId);
  }
  return feeds;
}

export async function startTracking(
  token: string,
  uid: string,
  busId: string,
  input: StartInput,
): Promise<{ session: TripSession; status: number }> {
  if (
    !safeInteger(input.expectedGeneration) ||
    input.expectedGeneration < 0 ||
    !safeInteger(input.requestedAt) ||
    input.requestedAt < 0
  ) {
    throw new TrackingConflictError("INVALID_START", "Invalid tracking start");
  }
  const result = await casNode(token, busId, (node, now) => {
    const expectedGeneration = input.expectedGeneration + 1;
    if (!node) {
      checkAttemptFresh(input.requestedAt, now);
      if (input.expectedGeneration !== 0) {
        throw new TrackingConflictError(
          "GENERATION_CONFLICT",
          "The expected tracking generation is not current",
        );
      }
      return { value: nodeForStart(busId, uid, input), resultStatus: 201 };
    }
    if (sameAttempt(node, uid, input)) {
      if (node.feed.phase !== "active") {
        throw new TrackingConflictError("START_CANCELLED", "The tracking start was cancelled");
      }
      return {
        resultStatus: 200,
      };
    }
    checkAttemptFresh(input.requestedAt, now);
    if (
      node.feed.generation === input.expectedGeneration + 1 &&
      node.feed.phase === "active" &&
      node.feed.heartbeatAt > 0 &&
      now - node.feed.heartbeatAt <= HEARTBEAT_LEASE_MS
    ) {
      throw new TrackingConflictError("OWNER_ACTIVE", "Another publisher owns this bus");
    }
    if (node.feed.generation !== input.expectedGeneration) {
      throw new TrackingConflictError(
        "GENERATION_CONFLICT",
        "The expected tracking generation is not current",
      );
    }
    if (node.feed.phase === "active") {
      if (node.feed.heartbeatAt > 0 && now - node.feed.heartbeatAt <= HEARTBEAT_LEASE_MS) {
        throw new TrackingConflictError("OWNER_ACTIVE", "Another publisher owns this bus");
      }
    } else if (
      node.feed.tripId === input.tripId &&
      node.publisherId === input.publisherId &&
      node.feed.requestedAt === input.requestedAt
    ) {
      throw new TrackingConflictError("START_CANCELLED", "The tracking start was cancelled");
    }
    if (expectedGeneration !== node.feed.generation + 1) {
      throw new TrackingConflictError(
        "GENERATION_CONFLICT",
        "The expected tracking generation is not current",
      );
    }
    return { value: nodeForStart(busId, uid, input), resultStatus: 201 };
  });
  if (
    result.node.feed.phase !== "active" ||
    result.node.feed.tripId !== input.tripId ||
    result.node.publisherId !== input.publisherId
  ) {
    throw new TrackingConflictError("START_CANCELLED", "The tracking start was cancelled");
  }
  return { session: session(result.node, Date.now()), status: result.status };
}

function validateCurrent(
  node: StoredTrackingNode,
  uid: string,
  input: { tripId: string; publisherId: string; generation: number },
): void {
  if (
    node.driverUid !== uid ||
    node.publisherId !== input.publisherId ||
    node.feed.tripId !== input.tripId ||
    node.feed.generation !== input.generation ||
    node.feed.phase !== "active"
  ) {
    throw new TrackingConflictError("SESSION_CONFLICT", "The tracking session is no longer current");
  }
}

export async function submitTrackingSample(
  token: string,
  uid: string,
  busId: string,
  input: SampleInput,
): Promise<TripSession> {
  if (
    !finiteNumber(input.lat) ||
    !finiteNumber(input.lng) ||
    !finiteNumber(input.accuracy) ||
    input.lat < -90 ||
    input.lat > 90 ||
    input.lng < -180 ||
    input.lng > 180 ||
    input.accuracy < 0 ||
    input.accuracy > 100000 ||
    !safeInteger(input.sequence) ||
    input.sequence < 1 ||
    !safeInteger(input.generation) ||
    input.generation < 1 ||
    !safeInteger(input.capturedAt) ||
    input.capturedAt < 0
  ) {
    throw new TrackingConflictError("INVALID_SAMPLE", "Invalid tracking sample");
  }
  const result = await casNode(token, busId, (node, now) => {
    if (!node) throw new TrackingConflictError("SESSION_CONFLICT", "Tracking session not found");
    validateCurrent(node, uid, input);
    checkFuture(input.capturedAt, now, "capturedAt");
    if (input.sequence <= node.sequence) {
      throw new TrackingConflictError("SEQUENCE_REPLAY", "Tracking sequence is not increasing");
    }
    if (
      node.feed.lastReportCapturedAt > 0 &&
      input.capturedAt <= node.feed.lastReportCapturedAt
    ) {
      throw new TrackingConflictError("STALE_CAPTURE", "Tracking capture time is not increasing");
    }
    if (now - input.capturedAt > GPS_FRESH_MS) {
      throw new TrackingConflictError("STALE_CAPTURE", "Tracking capture is too old");
    }
    const fresh = input.accuracy <= 100;
    const feed: Record<string, unknown> = {
      ...node.feed,
      lastReportCapturedAt: input.capturedAt,
      lastReportReceivedAt: serverTimestamp(),
      reportedAccuracy: input.accuracy,
      heartbeatAt: serverTimestamp(),
      gpsQuality: fresh ? "good" : "weak",
      location: node.feed.location ?? null,
      ...(input.full === undefined ? {} : { full: input.full }),
    };
    if (fresh) {
      feed.lastValidCapturedAt = input.capturedAt;
      feed.lastValidReceivedAt = serverTimestamp();
      feed.location = {
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy,
      };
    }
    return {
      value: {
        driverUid: node.driverUid,
        publisherId: node.publisherId,
        sequence: input.sequence,
        feed,
      },
    };
  });
  if (result.node.feed.phase !== "active" || result.node.sequence !== input.sequence) {
    throw new TrackingConflictError("SESSION_CONFLICT", "The tracking session is no longer current");
  }
  return session(result.node, Date.now());
}

export async function sendTrackingHeartbeat(
  token: string,
  uid: string,
  busId: string,
  input: HeartbeatInput,
): Promise<TripSession> {
  if (
    !safeInteger(input.sequence) ||
    input.sequence < 0 ||
    !safeInteger(input.generation) ||
    input.generation < 1
  ) {
    throw new TrackingConflictError("INVALID_HEARTBEAT", "Invalid tracking heartbeat");
  }
  const result = await casNode(token, busId, (node) => {
    if (!node) throw new TrackingConflictError("SESSION_CONFLICT", "Tracking session not found");
    validateCurrent(node, uid, input);
    if (input.sequence <= node.sequence) {
      throw new TrackingConflictError("SEQUENCE_REPLAY", "Heartbeat sequence is not increasing");
    }
    return {
      value: {
        driverUid: node.driverUid,
        publisherId: node.publisherId,
        sequence: input.sequence,
        feed: {
          ...node.feed,
          heartbeatAt: serverTimestamp(),
          gpsQuality: input.gpsUnavailable ? "unavailable" : node.feed.gpsQuality,
          ...(input.full === undefined ? {} : { full: input.full }),
        },
      },
    };
  });
  if (result.node.feed.phase !== "active" || result.node.sequence !== input.sequence) {
    throw new TrackingConflictError("SESSION_CONFLICT", "The tracking session is no longer current");
  }
  return session(result.node, Date.now());
}

export async function endTracking(
  token: string,
  uid: string,
  busId: string,
  input: EndInput,
): Promise<TripEndResult> {
  if (
    !safeInteger(input.generation) ||
    input.generation < 1 ||
    !safeInteger(input.requestedAt) ||
    input.requestedAt < 0
  ) {
    throw new TrackingConflictError("INVALID_END", "Invalid tracking end");
  }
  checkFuture(input.requestedAt, Date.now(), "requestedAt");
  const result = await casNode(token, busId, (node, now) => {
    if (!node) {
      if (input.generation !== 1) {
        throw new TrackingConflictError(
          "GENERATION_CONFLICT",
          "The requested generation is not next",
        );
      }
      return { value: nodeForTombstone(busId, uid, input), resultStatus: 201 };
    }
    if (node.feed.generation > input.generation) {
      return {
        resultStatus: 200,
      };
    }
    if (node.feed.generation < input.generation) {
      if (input.generation !== node.feed.generation + 1) {
        throw new TrackingConflictError("GENERATION_CONFLICT", "The requested generation is not next");
      }
      if (
        node.feed.phase === "active" &&
        node.feed.heartbeatAt > 0 &&
        now - node.feed.heartbeatAt <= HEARTBEAT_LEASE_MS
      ) {
        if (now <= input.requestedAt + START_WINDOW_MS) {
          return { resultStatus: 200 };
        }
        return { resultStatus: 202 };
      }
      return { value: nodeForTombstone(busId, uid, input), resultStatus: 201 };
    }
    if (
      node.feed.phase === "ended" &&
      node.feed.tripId === input.tripId &&
      node.publisherId === input.publisherId
    ) {
      return {
        resultStatus: 200,
      };
    }
    if (
      node.feed.phase === "active" &&
      node.driverUid === uid &&
      node.publisherId === input.publisherId &&
      node.feed.tripId === input.tripId
    ) {
      return {
        value: endedNode(node),
      };
    }
    if (node.feed.phase === "active") {
      return {
        resultStatus: 200,
      };
    }
    return {
      resultStatus: 200,
    };
  });
  const output = session(result.node, Date.now());
  const same =
    result.node.feed.generation === input.generation &&
    result.node.feed.tripId === input.tripId &&
    result.node.publisherId === input.publisherId;
  if (result.node.feed.phase === "ended" && same) {
    return {
      acknowledged: true,
      outcome:
        result.status === 201 || result.node.driverUid !== uid ? "cancelled" : "ended",
      feed: output.feed,
    };
  }
  if (result.node.feed.generation > input.generation) {
    return { acknowledged: true, outcome: "superseded", feed: output.feed };
  }
  if (result.status === 202) {
    return { acknowledged: true, outcome: "cancelled", feed: output.feed };
  }
  if (result.node.feed.phase === "ended" && !same) {
    return { acknowledged: true, outcome: "superseded", feed: output.feed };
  }
  return { acknowledged: false, outcome: "pending", feed: output.feed };
}

/** ADM-10: who holds the bus right now; null when the bus has never reported. */
export async function readTrackingOwner(
  token: string,
  busId: string,
): Promise<{ driverUid: string; phase: string; tripId: string; generation: number } | null> {
  const { node } = await currentNode(token, busId, false);
  if (!node) return null;
  return {
    driverUid: node.driverUid,
    phase: node.feed.phase,
    tripId: node.feed.tripId as string,
    generation: node.feed.generation,
  };
}

/** `expected` (ADM-10) binds the end to the trip the admin looked at; a bus that changed hands meanwhile is refused. */
export async function forceEndTracking(
  token: string,
  _adminUid: string,
  busId: string,
  expected?: { driverUid: string; generation: number },
): Promise<ForceEndResult> {
  let outcome: ForceEndResult["outcome"] = "ended";
  const result = await casNode(token, busId, (node) => {
    if (!node) throw new TrackingConflictError("NOT_STARTED", "Tracking has not started");
    if (expected && (node.driverUid !== expected.driverUid || node.feed.generation !== expected.generation)) {
      throw new TrackingConflictError("OWNER_CHANGED", "The bus changed hands while you confirmed; look again before handing it over");
    }
    if (node.feed.phase === "ended") {
      outcome = "already_ended";
      return { resultStatus: 200 };
    }
    return { value: endedNode(node) };
  });
  return {
    outcome,
    feed: publicFeed(result.node, busId),
    driverUid: result.node.driverUid,
    tripId: result.node.feed.tripId as string,
    generation: result.node.feed.generation,
  };
}

export function requestToken(req: Request): { token: string; uid: string } {
  const token = req.firebaseToken;
  const uid = req.firebaseIdentity?.uid;
  if (!token || !uid) throw new FirebaseServiceError("config", "Authentication required");
  return { token, uid };
}