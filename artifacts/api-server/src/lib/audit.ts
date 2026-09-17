import { pushFirebase, readFirebaseQuery, serverTimestamp } from "./firebase";

export type AuditAction =
  | "tracking.force_end"
  | "tracking.handover"
  | "membership.update"
  | "route.save"
  | "route.delete"
  | "route.archive"
  | "notice.save"
  | "notice.delete"
  | "bus.save"
  | "bus.deactivate"
  | "bus.reactivate"
  | "assignment.save"
  | "assignment.delete"
  | "calendar.save"
  | "calendar.delete";

export type AuditEntry = {
  id: string;
  at: number;
  actorUid: string;
  actorEmail: string;
  action: AuditAction;
  target: string;
  summary: string;
};

type NewAuditEntry = Omit<AuditEntry, "id" | "at">;

// Mirrors the Rules validation for /audit entries. Summaries are built from
// user-controlled fields, so they are bounded here rather than trusted; an
// audit rejected after the change already applied would surface as 502.
export const AUDIT_SUMMARY_MAX = 300;
export const AUDIT_TARGET_MAX = 128;

export function boundAuditText(value: string, max: number, fallback: string): string {
  const text = value.trim() || fallback;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export async function appendAudit(token: string, entry: NewAuditEntry): Promise<string> {
  const result = await pushFirebase<{ name?: unknown }>("audit", token, {
    at: serverTimestamp(),
    ...entry,
    target: boundAuditText(entry.target, AUDIT_TARGET_MAX, "unknown"),
    summary: boundAuditText(entry.summary, AUDIT_SUMMARY_MAX, "no field changes"),
  });
  if (!result || typeof result.name !== "string" || !result.name) {
    throw new Error("Firebase audit append returned no ID");
  }
  return result.name;
}

export async function listAudit(token: string, limit: number): Promise<AuditEntry[]> {
  const result = await readFirebaseQuery<unknown>("audit", token, {
    orderBy: JSON.stringify("at"),
    limitToLast: limit,
  });
  if (result.value === null) return [];
  if (!result.value || typeof result.value !== "object" || Array.isArray(result.value)) {
    throw new Error("Firebase audit data is invalid");
  }
  return Object.entries(result.value as Record<string, Omit<AuditEntry, "id">>)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.at - a.at);
}

export function membershipChangeSummary(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const fields = ["role", "status", "active", "assignedBusId", "requestedRole", "expiresAt"] as const;
  return fields
    .filter((field) => before[field] !== after[field])
    .map((field) => {
      const display = (value: unknown): string =>
        typeof value === "string" ? `'${value}'` : field === "expiresAt" && typeof value === "number" ? new Date(value).toISOString() : String(value);
      return `${field} ${display(before[field])} -> ${display(after[field])}`;
    })
    .join("; ");
}