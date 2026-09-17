import { FirebaseServiceError, readFirebase } from "./firebase";
import { HEARTBEAT_LEASE_MS, readTrackingFeed } from "./tracking";

/**
 * Bus registry: `buses/{busId}` where busId is the canonical key — the
 * registration uppercased with everything but A-Z and 0-9 removed. The same
 * rule lives in the web (`normalizeBusNumber`), the migration script and the
 * Rules key regex, so "GJ 06-BX 1414", "gj06bx1414" and "GJ06BX1414" are one bus.
 */
export type BusStatus = "active" | "out_of_service";
export type Bus = {
  busId: string;
  label: string;
  status: BusStatus;
  reason: string; // why it is out of service; empty while active
  createdAt: number;
  updatedAt: number;
};

export const BUS_KEY = /^[A-Z0-9]{2,20}$/; // mirrored in Rules
export const BUS_LABEL_MAX = 64; // mirrored in Rules
export const BUS_REASON_MAX = 200; // mirrored in Rules

export function busKey(raw: string): string | null {
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return BUS_KEY.test(key) ? key : null;
}

export function busFromValue(value: unknown, busId: string): Bus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.busId !== busId ||
    typeof record.label !== "string" ||
    record.label.length === 0 ||
    record.label.length > BUS_LABEL_MAX ||
    (record.status !== "active" && record.status !== "out_of_service") ||
    (record.reason !== undefined &&
      (typeof record.reason !== "string" || record.reason.length > BUS_REASON_MAX)) ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    busId,
    label: record.label,
    status: record.status,
    reason: typeof record.reason === "string" ? record.reason : "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function invalidData(): FirebaseServiceError {
  return new FirebaseServiceError("unavailable", "Firebase bus data is invalid");
}

export async function readBus(token: string, busId: string): Promise<Bus | null> {
  if (!BUS_KEY.test(busId)) return null; // legacy ids never match a registry key
  const result = await readFirebase<unknown>(`buses/${busId}`, token);
  if (result.value === null) return null;
  const bus = busFromValue(result.value, busId);
  if (!bus) throw invalidData();
  return bus;
}

export async function readBuses(token: string): Promise<Bus[]> {
  const result = await readFirebase<unknown>("buses", token);
  if (result.value === null) return [];
  if (typeof result.value !== "object" || Array.isArray(result.value)) throw invalidData();
  const buses: Bus[] = [];
  for (const [busId, value] of Object.entries(result.value as Record<string, unknown>)) {
    if (value === null) continue;
    const bus = BUS_KEY.test(busId) ? busFromValue(value, busId) : null;
    if (!bus) throw invalidData();
    buses.push(bus);
  }
  return buses.sort((a, b) => a.busId.localeCompare(b.busId));
}

/** The trip that blocks deactivation and route edits: active phase with a live heartbeat lease. */
export async function liveTrip(
  token: string,
  busId: string,
): Promise<{ tripId: string | null; startedAt: number } | null> {
  const feed = await readTrackingFeed(token, busId);
  const live =
    feed.phase === "active" &&
    feed.heartbeatAt > 0 &&
    Date.now() - feed.heartbeatAt <= HEARTBEAT_LEASE_MS;
  return live ? { tripId: feed.tripId, startedAt: feed.startedAt } : null;
}

/** RTE-02: { routeId: publishedVersion } for every published, versioned route of a bus; legacy routes (no version) are skipped. */
export async function publishedRouteVersions(token: string, busId: string): Promise<Record<string, number>> {
  const result = await readFirebase<Record<string, unknown> | null>("routes", token);
  const pins: Record<string, number> = {};
  for (const [id, value] of Object.entries(result.value ?? {})) {
    const route = value as Record<string, unknown> | null;
    if (
      route?.busNumber === busId &&
      (route.status ?? "published") === "published" &&
      Number.isSafeInteger(route.publishedVersion)
    ) {
      pins[id] = route.publishedVersion as number;
    }
  }
  return pins;
}

/** FLT-03: why a trip may not start on this bus (mirrored in the Rules Start branch), or null when it may. */
export function startDenial(bus: Bus | null, busId: string): { code: string; message: string } | null {
  if (!bus) {
    return { code: "BUS_NOT_REGISTERED", message: `Bus ${busId} is not registered; ask the transport admin to add it under Fleet.` };
  }
  if (bus.status !== "active") {
    return {
      code: "BUS_OUT_OF_SERVICE",
      message: `Bus ${busId} is out of service${bus.reason ? `: ${bus.reason}` : ""}. Ask the transport admin before starting.`,
    };
  }
  return null;
}
