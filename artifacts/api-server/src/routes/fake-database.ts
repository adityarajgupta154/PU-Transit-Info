// Shared by the route tests: enough of the RTDB REST surface (GET/PUT/PATCH/POST/DELETE, conditional writes,
// `.sv` timestamps, multi-path PATCH) plus fixture records. No query filtering.
import { createHash } from "node:crypto";
import type { Mock } from "vitest";

export type Json = Record<string, unknown>;

/** Enough of the RTDB REST surface for the registry: GET/PUT/PATCH/POST on paths, ETags, `.sv` timestamps. */
export function fakeDatabase(fetchFirebase: Mock, initial: Json) {
  const store: Json = structuredClone(initial);
  const audits: { action: string; target: string; summary: string }[] = [];
  const at = (path: string[]): unknown =>
    path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Json)[key] : undefined), store);
  const set = (path: string[], value: unknown) => {
    let node = store;
    for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Json;
    node[path[path.length - 1]] = value;
  };
  const resolve = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value), (_k, v) => (v && typeof v === "object" && v[".sv"] === "timestamp" ? Date.now() : v));
  const etag = (value: unknown) =>
    value == null ? "null_etag" : `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;

  fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/\.json$/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (method === "GET") {
      const value = at(path);
      return new Response(JSON.stringify(value ?? null), { status: 200, headers: { etag: etag(value) } });
    }
    if (method === "PUT") {
      if (headers.has("If-Match") && headers.get("If-Match") !== etag(at(path))) {
        return new Response("{}", { status: 412 });
      }
      const value = resolve(JSON.parse(String(init?.body)));
      set(path, value);
      return new Response(JSON.stringify(value), { status: 200 });
    }
    if (method === "PATCH") {
      const patch = JSON.parse(String(init?.body)) as Json; // multi-path update: keys are paths, null deletes
      for (const [key, value] of Object.entries(patch)) {
        set([...path, ...key.split("/").filter(Boolean)], value === null ? undefined : resolve(value));
      }
      return new Response(JSON.stringify(patch), { status: 200 });
    }
    if (method === "POST" && path[0] === "audit") {
      const entry = JSON.parse(String(init?.body)) as { action: string; target: string; summary: string };
      audits.push({ action: entry.action, target: entry.target, summary: entry.summary });
      return new Response(JSON.stringify({ name: `-audit-${audits.length}` }), { status: 200 });
    }
    if (method === "DELETE") {
      set(path, undefined);
      return new Response("null", { status: 200 });
    }
    return new Response("null", { status: 200 });
  });
  return { store, audits, at };
}

export const member = (uid: string, role: string, assignedBusId = "") => ({
  uid,
  email: `${uid}@paruluniversity.ac.in`,
  role,
  status: "approved",
  active: true,
  assignedBusId,
  createdAt: 1,
  updatedAt: 1,
});

export const bus = (busId: string, status = "active", label = busId) => ({
  busId,
  label,
  status,
  reason: "",
  createdAt: 1,
  updatedAt: 1,
});

export const route = (id: string, busNumber: string) => ({
  id,
  shift: "First Shift",
  busNumber,
  origin: "Waghodia",
  destination: "PU Campus",
  stops: [{ lat: 22.3, lng: 73.2, name: "Gate" }],
  pathData: [],
  status: "published",
  pathSource: "manual",
});

export const liveFeed = (busId: string) => ({
  protocolVersion: 2,
  busId,
  tripId: "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f",
  generation: 1,
  phase: "active",
  requestedAt: Date.now() - 60_000,
  startedAt: Date.now() - 60_000,
  endedAt: 0,
  heartbeatAt: Date.now() - 5_000,
  gpsQuality: "good",
  lastReportCapturedAt: Date.now() - 5_000,
  lastReportReceivedAt: Date.now() - 5_000,
  reportedAccuracy: 10,
  lastValidCapturedAt: Date.now() - 5_000,
  lastValidReceivedAt: Date.now() - 5_000,
  location: { lat: 22.3, lng: 73.2, accuracy: 10 },
});

export function signInAs(verifyIdToken: Mock, uid: string) {
  verifyIdToken.mockImplementation(async (token: string) =>
    token === `${uid}-token`
      ? { uid, email: `${uid}@paruluniversity.ac.in`, email_verified: true }
      : Promise.reject(new Error("bad token")));
}
