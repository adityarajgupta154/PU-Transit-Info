import { BUS_KEY } from "./buses";
import { readFirebase } from "./firebase";

// ASG-01: dated assignments live under assignments/{driverUid}/{id} so Rules can find a
// driver's own records by auth.uid and drivers read only their own subtree. The key is
// derived from the record (date_shiftKey_busId), so the same bus+date+shift for one
// driver is one record; a second driver would write a different key and is refused by
// the API's conflict check.

export const IST_OFFSET_MS = 19_800_000; // Asia/Kolkata is fixed +05:30 (no DST)
export const DAY_MS = 86_400_000;
export const ASSIGNMENT_KEY = /^\d{4}-\d{2}-\d{2}_[a-z0-9]{1,40}_[A-Z0-9]{2,20}$/; // mirrored in Rules
export const SERVICE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Assignment = {
  id: string;
  driverUid: string;
  driverEmail: string;
  busId: string;
  routeId: string;
  /** The route's published version when the assignment was saved; informational (Start pins its own). */
  routeVersion: number | null;
  shift: string;
  /** Calendar date in Asia/Kolkata. */
  serviceDate: string;
  startsAt: number;
  endsAt: number;
  createdAt: number;
  createdBy: string;
};

/** Calendar date in Asia/Kolkata for an epoch instant. */
export function serviceDateAt(nowMs: number): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch bounds of one IST calendar day, or null for a malformed or impossible date. */
export function serviceDayBounds(date: string): { startsAt: number; endsAt: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const startsAt = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - IST_OFFSET_MS;
  return serviceDateAt(startsAt) === date ? { startsAt, endsAt: startsAt + DAY_MS } : null;
}

export function shiftKey(shift: string): string {
  return shift.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40) || "shift";
}

export function assignmentKey(serviceDate: string, shift: string, busId: string): string {
  return `${serviceDate}_${shiftKey(shift)}_${busId}`;
}

export function assignmentFromValue(value: unknown, driverUid: string, id: string): Assignment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : null);
  const number = (key: string) => (typeof record[key] === "number" ? (record[key] as number) : null);
  const busId = text("busId");
  const routeId = text("routeId");
  const shift = text("shift");
  const serviceDate = text("serviceDate");
  const startsAt = number("startsAt");
  const endsAt = number("endsAt");
  if (!ASSIGNMENT_KEY.test(id) || record.id !== id || record.driverUid !== driverUid) return null;
  if (!busId || !BUS_KEY.test(busId) || !routeId || !shift || !serviceDate || startsAt === null || endsAt === null) {
    return null;
  }
  return {
    id,
    driverUid,
    driverEmail: text("driverEmail") ?? "",
    busId,
    routeId,
    routeVersion: number("routeVersion"),
    shift,
    serviceDate,
    startsAt,
    endsAt,
    createdAt: number("createdAt") ?? 0,
    createdBy: text("createdBy") ?? "",
  };
}

function fromSubtree(value: unknown, driverUid: string): Assignment[] {
  const list: Assignment[] = [];
  for (const [id, record] of Object.entries((value as Record<string, unknown> | null) ?? {})) {
    const assignment = assignmentFromValue(record, driverUid, id);
    if (assignment) list.push(assignment);
  }
  return list;
}

const SHIFT_ORDER = ["First Shift", "ADM / Medical Shift", "General Shift"];

export function sortAssignments(list: Assignment[]): Assignment[] {
  const rank = (shift: string) => {
    const index = SHIFT_ORDER.indexOf(shift);
    return index === -1 ? SHIFT_ORDER.length : index;
  };
  return list.sort(
    (a, b) =>
      a.serviceDate.localeCompare(b.serviceDate) ||
      rank(a.shift) - rank(b.shift) ||
      a.shift.localeCompare(b.shift) ||
      a.busId.localeCompare(b.busId) ||
      a.driverEmail.localeCompare(b.driverEmail),
  );
}

/** A driver's own assignments (Rules: self or admin). */
export async function readDriverAssignments(token: string, driverUid: string): Promise<Assignment[]> {
  const result = await readFirebase<unknown>(`assignments/${driverUid}`, token);
  return sortAssignments(fromSubtree(result.value, driverUid));
}

/** Every assignment (admin read). */
export async function readAllAssignments(token: string): Promise<Assignment[]> {
  const result = await readFirebase<Record<string, unknown> | null>("assignments", token);
  const list: Assignment[] = [];
  for (const [driverUid, subtree] of Object.entries(result.value ?? {})) {
    list.push(...fromSubtree(subtree, driverUid));
  }
  return sortAssignments(list);
}

/** The assignment window covers `now`; `graceMs` lets a trip that crossed midnight keep reporting. */
/** A save the API refuses before anything is written (bad input, ineligible driver, parked bus, wrong route, conflict). */
export class AssignmentRefusal extends Error {
  constructor(readonly status: 400 | 403 | 409, readonly code: string, message: string) {
    super(message);
    this.name = "AssignmentRefusal";
  }
}

export function coversNow(assignment: Assignment, now: number, graceMs = 0): boolean {
  return assignment.startsAt <= now && now < assignment.endsAt + graceMs;
}

/**
 * Why `candidate` may not be saved next to `existing`, with names so the admin can act on it:
 * the bus is already someone else's for that date and shift, or the driver already has another
 * bus then. Same driver, bus, date and shift is the same key and simply overwrites (route change).
 */
export function assignmentConflict(candidate: Assignment, existing: Assignment[]): string | null {
  const when = `${candidate.serviceDate} (${candidate.shift})`;
  for (const other of existing) {
    if (other.serviceDate !== candidate.serviceDate || other.shift !== candidate.shift) continue;
    if (other.busId === candidate.busId && other.driverUid !== candidate.driverUid) {
      return `Bus ${candidate.busId} is already assigned to ${other.driverEmail || other.driverUid} on ${when}.`;
    }
    if (other.driverUid === candidate.driverUid && other.busId !== candidate.busId) {
      return `${candidate.driverEmail || candidate.driverUid} already drives bus ${other.busId} on ${when}.`;
    }
  }
  return null;
}
