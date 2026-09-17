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
import { DAY_MS, IST_OFFSET_MS, serviceDateAt, serviceDayBounds } from "../lib/assignments";
import { fakeDatabase as fakeDb, signInAs as signIn, member, bus, route, liveFeed, type Json } from "./fake-database";

const fakeDatabase = (initial: Json) => fakeDb(fetchFirebase, initial);
const signInAs = (uid: string) => signIn(verifyIdToken, uid);

const ROUTE_A = "8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c"; // First Shift on bus 2020
const ROUTE_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"; // General Shift on bus 2020
const BUS = "GJ06BX2020"; // the override bus
const OWN = "GJ06BX1414"; // driver's standing bus
const today = () => serviceDateAt(Date.now());
const tomorrow = () => serviceDateAt(Date.now() + DAY_MS);
const KEY = (date: string, shift = "firstshift", busId = BUS) => `${date}_${shift}_${busId}`;

function seed(extra: Json = {}): Json {
  return {
    memberships: {
      admin: member("admin", "admin"),
      driver: member("driver", "driver", OWN),
      other: member("other", "driver", BUS),
      student: member("student", "student"),
    },
    buses: { [BUS]: bus(BUS, "active", "Bus 2020"), [OWN]: bus(OWN), GJ06BX3030: bus("GJ06BX3030", "out_of_service") },
    routes: {
      [ROUTE_A]: { ...route(ROUTE_A, BUS), publishedVersion: 3 },
      [ROUTE_B]: { ...route(ROUTE_B, BUS), shift: "General Shift" },
    },
    ...extra,
  };
}

const assign = (body: object, token = "admin-token") =>
  request(app).post("/api/assignments").set("Authorization", `Bearer ${token}`).send(body);

const startBody = () => ({
  tripId: "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f",
  publisherId: "9c1f0d2e-3f4a-4b6c-8d7e-1a2b3c4d5e6f",
  expectedGeneration: 0,
  requestedAt: Date.now(),
});

describe("Dated assignments (ASG-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
  });
  afterEach(() => vi.useRealTimers());

  it("computes IST service days: date from an instant, midnight bounds, impossible dates refused", () => {
    // 2026-09-13T20:00Z is already 14 Sep in Kolkata.
    expect(serviceDateAt(Date.UTC(2026, 8, 13, 20))).toBe("2026-09-14");
    const bounds = serviceDayBounds("2026-09-14");
    expect(bounds).toEqual({ startsAt: Date.UTC(2026, 8, 13, 18, 30), endsAt: Date.UTC(2026, 8, 14, 18, 30) });
    expect(bounds!.startsAt % DAY_MS).toBe(DAY_MS - IST_OFFSET_MS); // the arithmetic the Rules check
    expect(serviceDayBounds("2026-02-30")).toBeNull();
    expect(serviceDayBounds("2026-9-1")).toBeNull();
  });

  it("requires an admin token", async () => {
    expect((await request(app).get("/api/assignments")).status).toBe(401);
    expect(fetchFirebase).not.toHaveBeenCalled();
    signInAs("driver");
    fakeDatabase(seed());
    const asDriver = await assign({ driverUid: "driver", busId: BUS, routeId: ROUTE_A, serviceDate: today() }, "driver-token");
    expect(asDriver.status).toBe(403);
    expect((await request(app).get("/api/assignments").set("Authorization", "Bearer driver-token")).status).toBe(403);
  });

  it("saves under a date_shift_bus key with the route's shift and version, then lists it", async () => {
    signInAs("admin");
    const db = fakeDatabase(seed());
    const saved = await assign({ driverUid: "driver", busId: "gj06 bx 2020", routeId: ROUTE_A, serviceDate: tomorrow() });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({
      id: KEY(tomorrow()),
      driverUid: "driver",
      driverEmail: "driver@paruluniversity.ac.in",
      busId: BUS,
      routeId: ROUTE_A,
      routeVersion: 3,
      shift: "First Shift",
      serviceDate: tomorrow(),
      createdBy: "admin",
    });
    expect(saved.body.endsAt - saved.body.startsAt).toBe(DAY_MS);
    expect(db.at(["assignments", "driver", KEY(tomorrow()), "busId"])).toBe(BUS);
    expect(db.audits).toEqual([
      { action: "assignment.save", target: KEY(tomorrow()), summary: expect.stringContaining("driver@paruluniversity.ac.in on bus GJ06BX2020") },
    ]);

    // Same driver, bus, date and shift: the route changes in place (no conflict with oneself).
    const legacy = await assign({ driverUid: "driver", busId: BUS, routeId: ROUTE_B, serviceDate: tomorrow() });
    expect(legacy.status).toBe(201);
    expect(legacy.body).toMatchObject({ id: KEY(tomorrow(), "generalshift"), routeVersion: null, shift: "General Shift" });

    const list = await request(app).get("/api/assignments").set("Authorization", "Bearer admin-token");
    expect(list.status).toBe(200);
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([KEY(tomorrow()), KEY(tomorrow(), "generalshift")]);
  });

  it("refuses bad references with a reason: past date, non-driver, parked bus, route of another bus", async () => {
    signInAs("admin");
    fakeDatabase(seed());
    const past = await assign({ driverUid: "driver", busId: BUS, routeId: ROUTE_A, serviceDate: serviceDateAt(Date.now() - DAY_MS) });
    expect(past.status).toBe(400);
    expect((await assign({ driverUid: "driver", busId: BUS, routeId: ROUTE_A, serviceDate: "2026-02-30" })).status).toBe(400);
    const student = await assign({ driverUid: "student", busId: BUS, routeId: ROUTE_A, serviceDate: today() });
    expect(student.status).toBe(409);
    expect(student.body.code).toBe("DRIVER_NOT_ELIGIBLE");
    expect(student.body.error).toContain("student@paruluniversity.ac.in");
    const parked = await assign({ driverUid: "driver", busId: "GJ06BX3030", routeId: ROUTE_A, serviceDate: today() });
    expect(parked.body.code).toBe("BUS_OUT_OF_SERVICE");
    const wrongBus = await assign({ driverUid: "driver", busId: OWN, routeId: ROUTE_A, serviceDate: today() });
    expect(wrongBus.status).toBe(409);
    expect(wrongBus.body.code).toBe("ROUTE_NOT_FOR_BUS");
  });

  it("rejects conflicts before persisting and names the other driver or bus", async () => {
    signInAs("admin");
    const db = fakeDatabase(seed());
    expect((await assign({ driverUid: "other", busId: BUS, routeId: ROUTE_A, serviceDate: today() })).status).toBe(201);

    const doubleBooked = await assign({ driverUid: "driver", busId: BUS, routeId: ROUTE_A, serviceDate: today() });
    expect(doubleBooked.status).toBe(409);
    expect(doubleBooked.body.code).toBe("ASSIGNMENT_CONFLICT");
    expect(doubleBooked.body.error).toBe(`Bus ${BUS} is already assigned to other@paruluniversity.ac.in on ${today()} (First Shift).`);
    expect(db.at(["assignments", "driver"])).toBeUndefined();

    db.store.routes = { ...(db.store.routes as Json), [ROUTE_B]: { ...route(ROUTE_B, OWN) } }; // First Shift on the driver's own bus
    expect((await assign({ driverUid: "other", busId: OWN, routeId: ROUTE_B, serviceDate: today() })).body.error).toBe(
      `other@paruluniversity.ac.in already drives bus ${BUS} on ${today()} (First Shift).`,
    );
    // A different shift the same day is not a conflict.
    db.store.routes = { ...(db.store.routes as Json), [ROUTE_B]: { ...route(ROUTE_B, OWN), shift: "General Shift" } };
    expect((await assign({ driverUid: "other", busId: OWN, routeId: ROUTE_B, serviceDate: today() })).status).toBe(201);
    expect(db.audits.map((entry) => entry.action)).toEqual(["assignment.save", "assignment.save"]);
  });

  it("admits Start on the override bus for today only, pins the assignment id, and keeps the standing bus", async () => {
    signInAs("driver");
    const date = today();
    const db = fakeDatabase(
      seed({
        assignments: {
          driver: {
            [KEY(date)]: {
              id: KEY(date), driverUid: "driver", driverEmail: "driver@paruluniversity.ac.in", busId: BUS, routeId: ROUTE_A,
              routeVersion: 3, shift: "First Shift", serviceDate: date, ...serviceDayBounds(date), createdAt: 1, createdBy: "admin",
            },
          },
        },
      }),
    );
    const me = await request(app).get("/api/auth/me").set("Authorization", "Bearer driver-token");
    expect(me.status).toBe(200);
    expect(me.body.bus.busId).toBe(OWN);
    expect(me.body.assignments).toHaveLength(1);
    expect(me.body.assignments[0].assignment.id).toBe(KEY(date));
    expect(me.body.assignments[0].bus).toMatchObject({ busId: BUS, label: "Bus 2020" });

    const started = await request(app).post(`/api/tracking/${BUS}/start`).set("Authorization", "Bearer driver-token").send(startBody());
    expect(started.status).toBe(201);
    expect(db.at(["tracking", BUS, "feed", "assignmentId"])).toBe(KEY(date));
    expect(db.at(["tracking", BUS, "feed", "routeVersions"])).toEqual({ [ROUTE_A]: 3 });

    // The standing bus is still the driver's; no assignment id is pinned there.
    const own = await request(app).post(`/api/tracking/${OWN}/start`).set("Authorization", "Bearer driver-token").send(startBody());
    expect(own.status).toBe(201);
    expect(db.at(["tracking", OWN, "feed", "assignmentId"])).toBeUndefined();

    // A bus with no assignment at all is refused as before.
    const none = await request(app).post("/api/tracking/GJ06BX3030/start").set("Authorization", "Bearer driver-token").send(startBody());
    expect(none.status).toBe(403);
    expect(none.body.code).toBe("BUS_ASSIGNMENT_REQUIRED");

    // After midnight IST the override no longer admits a new Start, but the running trip may still report and end.
    vi.useFakeTimers({ now: serviceDayBounds(date)!.endsAt + 60_000, toFake: ["Date"] });
    const late = await request(app).post(`/api/tracking/${BUS}/start`).set("Authorization", "Bearer driver-token").send({ ...startBody(), requestedAt: Date.now(), expectedGeneration: 1 });
    expect(late.status).toBe(403);
    expect(late.body.error).toContain("today");
    const heartbeat = await request(app)
      .post(`/api/tracking/${BUS}/heartbeat`)
      .set("Authorization", "Bearer driver-token")
      .send({ tripId: startBody().tripId, publisherId: startBody().publisherId, generation: 1, sequence: 1 });
    expect(heartbeat.status).toBe(200);
    expect(db.at(["tracking", BUS, "feed", "assignmentId"])).toBe(KEY(date));
  });

  it("removes an assignment unless a live trip runs under it", async () => {
    signInAs("admin");
    const record = {
      id: KEY(today()), driverUid: "driver", driverEmail: "driver@paruluniversity.ac.in", busId: BUS, routeId: ROUTE_A,
      shift: "First Shift", serviceDate: today(), ...serviceDayBounds(today()), createdAt: 1, createdBy: "admin",
    };
    const db = fakeDatabase(
      seed({
        assignments: { driver: { [KEY(today())]: record } },
        tracking: { [BUS]: { driverUid: "driver", publisherId: "p", sequence: 3, feed: { ...liveFeed(BUS), assignmentId: KEY(today()) } } },
      }),
    );
    const remove = () => request(app).delete(`/api/assignments/driver/${KEY(today())}`).set("Authorization", "Bearer admin-token");
    const inUse = await remove();
    expect(inUse.status).toBe(409);
    expect(inUse.body.code).toBe("ASSIGNMENT_IN_USE");
    expect(inUse.body.error).toContain("driver@paruluniversity.ac.in");
    expect(db.at(["assignments", "driver", KEY(today())])).toBeDefined();

    (db.store.tracking as Json)[BUS] = { driverUid: "driver", publisherId: "p", sequence: 4, feed: { ...liveFeed(BUS), phase: "ended", assignmentId: KEY(today()) } };
    expect((await remove()).status).toBe(204);
    expect(db.at(["assignments", "driver", KEY(today())])).toBeUndefined();
    expect(db.audits).toEqual([{ action: "assignment.delete", target: KEY(today()), summary: expect.stringContaining("off bus GJ06BX2020") }]);
    expect((await remove()).status).toBe(204); // idempotent
    expect((await request(app).delete("/api/assignments/driver/not-a-key").set("Authorization", "Bearer admin-token")).status).toBe(400);
  });
});
