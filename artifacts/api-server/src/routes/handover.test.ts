import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { verifyIdToken, fetchFirebase, getApps, initializeApp } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  fetchFirebase: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: "pu-transit-api" })),
}));

vi.mock("firebase-admin/app", () => ({ getApps, initializeApp }));
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn(() => ({ verifyIdToken })) }));
vi.mock("@workspace/db", () => ({ db: { select: vi.fn() }, routesTable: {} }));

import app from "../app";
import { resetRateLimits } from "../middleware/rate-limit";
import { serviceDateAt, serviceDayBounds } from "../lib/assignments";
import { fakeDatabase as fakeDb, member, bus, route, liveFeed, type Json } from "./fake-database";

const fakeDatabase = (initial: Json) => fakeDb(fetchFirebase, initial);
const ROUTE = "8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c"; // First Shift on BUS
const BUS = "GJ06BX2020";
const OTHER = "GJ06BX1414"; // relief's standing bus
const KEY = () => `${serviceDateAt(Date.now())}_firstshift_${BUS}`;
const TRIP = "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f"; // liveFeed's trip
const PUBLISHER = "9c1f0d2e-3f4a-4b6c-8d7e-1a2b3c4d5e6f";

// Every seeded uid signs in with `${uid}-token`, so one test can act as admin and both drivers.
function signInEveryone(): void {
  verifyIdToken.mockImplementation(async (token: string) => {
    const uid = token.replace(/-token$/, "");
    if (uid === token) throw new Error("bad token");
    return { uid, email: `${uid}@paruluniversity.ac.in`, email_verified: true };
  });
}

function seed(extra: Json = {}): Json {
  return {
    memberships: {
      admin: member("admin", "admin"),
      current: member("current", "driver", BUS), // standing driver of BUS, mid-trip
      relief: member("relief", "driver", OTHER), // usual bus is OTHER → needs a dated assignment
      spare: member("spare", "driver", BUS), // second standing driver of BUS
      student: member("student", "student"),
    },
    buses: { [BUS]: bus(BUS), [OTHER]: bus(OTHER) },
    routes: { [ROUTE]: { ...route(ROUTE, BUS), publishedVersion: 3 } },
    tracking: { [BUS]: { driverUid: "current", publisherId: PUBLISHER, sequence: 3, feed: liveFeed(BUS) } },
    ...extra,
  };
}

const handover = (body: object, token = "admin-token", busId = BUS) =>
  request(app).post(`/api/tracking/${busId}/handover`).set("Authorization", `Bearer ${token}`).send(body);
const upload = (path: string, token: string, body: object) =>
  request(app).post(`/api/tracking/${BUS}/${path}`).set("Authorization", `Bearer ${token}`).send(body);
const sample = (generation: number, sequence: number, publisherId = PUBLISHER, tripId = TRIP) => ({
  tripId, publisherId, generation, sequence, capturedAt: Date.now(), lat: 22.3, lng: 73.2, accuracy: 10,
});

describe("Handover (ADM-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
    signInEveryone();
  });
  afterEach(() => vi.useRealTimers());

  it("is admin-only", async () => {
    fakeDatabase(seed());
    expect((await request(app).post(`/api/tracking/${BUS}/handover`).send({ nextDriverUid: "relief" })).status).toBe(401);
    expect((await handover({ nextDriverUid: "relief" }, "current-token")).status).toBe(403);
    expect((await handover({ nextDriverUid: "relief" }, "student-token")).status).toBe(403);
  });

  it("ends the current publisher, authorizes the relief driver for today and writes one audit naming both", async () => {
    const db = fakeDatabase(seed());
    const done = await handover({ nextDriverUid: "relief", routeId: ROUTE, reason: "driver taken ill" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ outcome: "ended", previousDriverUid: "current", auditId: "-audit-1" });
    expect(done.body.feed.phase).toBe("ended");
    expect(done.body.assignment).toMatchObject({ id: KEY(), driverUid: "relief", busId: BUS, routeId: ROUTE, shift: "First Shift", routeVersion: 3 });
    expect(db.at(["assignments", "relief", KEY()])).toMatchObject({ driverUid: "relief", ...serviceDayBounds(serviceDateAt(Date.now())) });
    expect(db.audits).toEqual([
      {
        action: "tracking.handover",
        target: BUS,
        summary: expect.stringMatching(/^handed over bus GJ06BX2020 from current@paruluniversity\.ac\.in \(current\) to relief@paruluniversity\.ac\.in \(relief\); trip .* ended; assignment .*; reason: driver taken ill$/),
      },
    ]);

    // The previous phone drops to idle: its next sample or heartbeat is 409 SESSION_CONFLICT
    // (the tracker treats that as session gone); its own End stays idempotent.
    for (const [path, body] of [
      ["sample", sample(1, 4)],
      ["heartbeat", { tripId: TRIP, publisherId: PUBLISHER, generation: 1, sequence: 4 }],
    ] as const) {
      const denied = await upload(path, "current-token", body);
      expect(denied.status, path).toBe(409);
      expect(denied.body.code, path).toBe("SESSION_CONFLICT");
    }
    const ended = await upload("end", "current-token", { tripId: TRIP, publisherId: PUBLISHER, generation: 1, requestedAt: Date.now() });
    expect(ended.status).toBe(200);
    expect(ended.body.feed.phase).toBe("ended");

    // The relief driver starts at once on the handed-over bus, pinned to the new assignment.
    const relief = { tripId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", publisherId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e" };
    const started = await upload("start", "relief-token", { ...relief, expectedGeneration: 1, requestedAt: Date.now() });
    expect(started.status).toBe(201);
    expect(db.at(["tracking", BUS, "driverUid"])).toBe("relief");
    expect(db.at(["tracking", BUS, "feed", "assignmentId"])).toBe(KEY());
    expect((await upload("sample", "relief-token", sample(2, 1, relief.publisherId, relief.tripId))).status).toBe(200);

    // The old phone stays superseded even after the new trip is live.
    const late = await upload("sample", "current-token", sample(1, 5));
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("SESSION_CONFLICT");
    expect(db.audits).toHaveLength(1);
  });

  it("needs no assignment when the bus is already the next driver's standing bus", async () => {
    const db = fakeDatabase(seed());
    const done = await handover({ nextDriverUid: "spare" });
    expect(done.status).toBe(200);
    expect(done.body.assignment).toBeNull();
    expect(db.store.assignments).toBeUndefined();
    expect(db.audits[0].summary).toContain("to spare@paruluniversity.ac.in (spare); trip");
    expect(db.audits[0].summary).toContain("; their usual bus");
    expect((await upload("start", "spare-token", { tripId: TRIP, publisherId: PUBLISHER, expectedGeneration: 1, requestedAt: Date.now() })).status).toBe(201);
  });

  it("still authorizes the next driver when the trip ended in between, and reports it", async () => {
    const db = fakeDatabase(seed());
    ((db.store.tracking as Json)[BUS] as Json).feed = { ...liveFeed(BUS), phase: "ended", endedAt: Date.now() - 1000 };
    const done = await handover({ nextDriverUid: "relief", routeId: ROUTE });
    expect(done.status).toBe(200);
    expect(done.body.outcome).toBe("already_ended");
    expect(db.at(["assignments", "relief", KEY()])).toBeDefined();
    expect(db.audits[0].summary).toContain("had already ended");
  });

  it("refuses when the bus changed hands between the admin's look and the confirmation", async () => {
    const db = fakeDatabase(seed());
    // Simulate the race: the node the handler read (current, generation 1) is replaced before the CAS end.
    const original = fetchFirebase.getMockImplementation()!;
    let reads = 0;
    fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && String(input).includes(`/tracking/${BUS}`) && ++reads === 2) {
        (db.store.tracking as Json)[BUS] = { driverUid: "spare", publisherId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", sequence: 0, feed: { ...liveFeed(BUS), generation: 2 } };
      }
      return original(input, init);
    });
    const raced = await handover({ nextDriverUid: "relief", routeId: ROUTE });
    expect(raced.status, raced.text).toBe(409);
    expect(raced.body.code).toBe("OWNER_CHANGED");
    expect(db.at(["tracking", BUS, "feed", "phase"])).toBe("active"); // spare's trip is untouched
    expect(db.audits).toEqual([]);
  });

  it("refuses without changing anything: same driver, missing route, ineligible driver, wrong route, conflict, unknown bus", async () => {
    const conflictKey = `${serviceDateAt(Date.now())}_firstshift_GJ06BX3030`;
    const db = fakeDatabase(
      seed({
        buses: { [BUS]: bus(BUS), [OTHER]: bus(OTHER), GJ06BX3030: bus("GJ06BX3030") },
        assignments: {
          relief: {
            [conflictKey]: {
              id: conflictKey, driverUid: "relief", driverEmail: "relief@paruluniversity.ac.in", busId: "GJ06BX3030", routeId: ROUTE,
              shift: "First Shift", serviceDate: serviceDateAt(Date.now()), ...serviceDayBounds(serviceDateAt(Date.now())), createdAt: 1, createdBy: "admin",
            },
          },
        },
      }),
    );
    const cases: [object, number, string][] = [
      [{ nextDriverUid: "current" }, 400, "INVALID_REQUEST"],
      [{ nextDriverUid: "relief" }, 400, "ROUTE_REQUIRED"],
      [{ nextDriverUid: "student", routeId: ROUTE }, 409, "DRIVER_NOT_ELIGIBLE"],
      [{ nextDriverUid: "nobody", routeId: ROUTE }, 409, "DRIVER_NOT_ELIGIBLE"],
      [{ nextDriverUid: "relief", routeId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }, 409, "ROUTE_NOT_FOR_BUS"],
      [{ nextDriverUid: "relief", routeId: ROUTE }, 409, "ASSIGNMENT_CONFLICT"], // relief already drives 3030 this shift
      [{ nextDriverUid: "relief", extra: true }, 400, "INVALID_REQUEST"],
    ];
    for (const [body, status, code] of cases) {
      const res = await handover(body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect(res.body.code, JSON.stringify(body)).toBe(code);
    }
    expect((await handover({ nextDriverUid: "relief", routeId: ROUTE }, "admin-token", OTHER)).status).toBe(404);
    expect(db.at(["tracking", BUS, "feed", "phase"])).toBe("active");
    expect(db.at(["assignments", "relief", KEY()])).toBeUndefined();
    expect(db.audits).toEqual([]);
    expect((await upload("heartbeat", "current-token", { tripId: TRIP, publisherId: PUBLISHER, generation: 1, sequence: 4 })).status).toBe(200);
  });

  it("overrides whoever the bus was booked for, so handovers can chain, but still refuses a driver booked elsewhere", async () => {
    const db = fakeDatabase(
      seed({
        memberships: { admin: member("admin", "admin"), current: member("current", "driver", OTHER), relief: member("relief", "driver", "") },
        assignments: {
          current: {
            [KEY()]: {
              id: KEY(), driverUid: "current", driverEmail: "current@paruluniversity.ac.in", busId: BUS, routeId: ROUTE,
              shift: "First Shift", serviceDate: serviceDateAt(Date.now()), ...serviceDayBounds(serviceDateAt(Date.now())), createdAt: 1, createdBy: "admin",
            },
          },
        },
      }),
    );
    ((db.store.tracking as Json)[BUS] as Json).feed = { ...liveFeed(BUS), assignmentId: KEY() };
    const done = await handover({ nextDriverUid: "relief", routeId: ROUTE });
    expect(done.status).toBe(200);
    expect(db.at(["assignments", "relief", KEY()])).toBeDefined();
    expect(db.at(["assignments", "current", KEY()])).toBeDefined(); // left in place: the API never deletes it, the trip is ended
    expect((await upload("heartbeat", "current-token", { tripId: TRIP, publisherId: PUBLISHER, generation: 1, sequence: 4 })).status).toBe(409);

    // relief starts, then hands over again to a third driver: current's stale booking does not block it.
    (db.store.memberships as Json).third = member("third", "driver", "");
    expect((await upload("start", "relief-token", { tripId: TRIP, publisherId: PUBLISHER, expectedGeneration: 1, requestedAt: Date.now() })).status).toBe(201);
    const chained = await handover({ nextDriverUid: "third", routeId: ROUTE });
    expect(chained.status, chained.text).toBe(200);
    expect(db.at(["assignments", "third", KEY()])).toBeDefined();
  });
});
