import type { NextFunction, Request, Response } from "express";
import { DAY_MS, readDriverAssignments, type Assignment } from "../lib/assignments";
import {
  FirebaseServiceError,
  type FirebaseErrorDetail,
  getUniversityEmailDomains,
  readFirebase,
  verifyFirebaseIdToken,
} from "../lib/firebase";

export type MemberRole = "student" | "staff" | "driver" | "admin";
export type MemberStatus = "pending" | "approved" | "rejected" | "suspended";
export type RequestedRole = "driver" | "admin";

export const MEMBER_ROLES: readonly MemberRole[] = ["student", "staff", "driver", "admin"];
export const REQUESTED_ROLES: readonly RequestedRole[] = ["driver", "admin"];

/** The owner's account: it verifies other admins and can never be demoted or suspended (mirrored in Rules). */
export const ROOT_ADMIN_UID = "hqKU3amnTzVBT3yF3p4DMRnirDq1";

/** Students who signed up with a personal email keep access this long before they must switch to a university email (mirrored in Rules). */
export const PERSONAL_EMAIL_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export type Member = {
  uid: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  active: boolean;
  assignedBusId: string;
  requestedRole: RequestedRole | null;
  /** IDN-01: UTC ms after which access ends (Rules and API agree); null = no expiry. */
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** IDN-01: a valid `expiresAt` — whole ms, positive, at most Date's maximum; the Rules validator says the same. */
export const MAX_EXPIRES_AT = 8_640_000_000_000_000;
export function isValidExpiresAt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_EXPIRES_AT;
}

/** Mirrors the Rules gate: approved, active, and not past `expiresAt`. */
export function memberIsCurrent(
  member: Pick<Member, "status" | "active" | "expiresAt"> | null | undefined,
  now = Date.now(),
): boolean {
  return !!member && member.status === "approved" && member.active && (member.expiresAt === null || member.expiresAt > now);
}

/** When a member's university access ends: null for university emails, createdAt + grace otherwise. */
export function graceEndsAt(member: Pick<Member, "email" | "createdAt">): number | null {
  return isUniversityEmail(member.email) ? null : member.createdAt + PERSONAL_EMAIL_GRACE_MS;
}

/** Mirrors the Rules member-read predicate: university email, or a student inside the personal-email grace period. */
export function hasUniversityAccess(member: Pick<Member, "email" | "role" | "createdAt">, now = Date.now()): boolean {
  const ends = graceEndsAt(member);
  return ends === null || (member.role === "student" && ends > now);
}

export type FirebaseIdentity = {
  uid: string;
  email: string;
  emailVerified: boolean;
};

declare global {
  namespace Express {
    interface Request {
      firebaseIdentity?: FirebaseIdentity;
      firebaseToken?: string;
      membership?: Member;
      /** ASG-01: the dated assignment that admitted this request when the standing bus did not match. */
      assignment?: Assignment;
    }
  }
}

declare module "express" {
  interface Request {
    firebaseIdentity?: FirebaseIdentity;
    firebaseToken?: string;
    membership?: Member;
    assignment?: Assignment;
  }
}

function errorResponse(
  res: Response,
  status: number,
  error: string,
  code: string,
): void {
  res.status(status).json({ error, code });
}

function bearerToken(req: Request): string | null {
  const value = req.header("authorization");
  if (!value) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function identityFromClaims(claims: Record<string, unknown>): FirebaseIdentity {
  const uid = typeof claims.uid === "string" ? claims.uid : "";
  const email = typeof claims.email === "string" ? claims.email.trim() : "";
  const emailVerified =
    claims.email_verified === true || claims.emailVerified === true;
  return { uid, email, emailVerified };
}

export function isUniversityEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@") !== at) {
    return false;
  }

  const domain = email.slice(at + 1).toLowerCase();
  return getUniversityEmailDomains().includes(domain);
}

export async function firebaseIdentity(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    errorResponse(res, 401, "Authentication required", "AUTH_REQUIRED");
    return;
  }

  try {
    const identity = identityFromClaims(await verifyFirebaseIdToken(token));
    if (!identity.uid) {
      errorResponse(res, 401, "Invalid Firebase token", "AUTH_INVALID");
      return;
    }
    req.firebaseIdentity = identity;
    req.firebaseToken = token;
    next();
  } catch (error) {
    if (error instanceof FirebaseServiceError) {
      if (error.code === "config") {
        errorResponse(
          res,
          503,
          "Firebase authentication is unavailable",
          "FIREBASE_UNAVAILABLE",
        );
        return;
      }
      if (error.code === "rules") {
        errorResponse(res, 401, "Invalid Firebase token", "AUTH_INVALID");
        return;
      }
    }
    errorResponse(
      res,
      503,
      "Firebase authentication is unavailable",
      "FIREBASE_UNAVAILABLE",
    );
  }
}

export function requireVerifiedEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const identity = req.firebaseIdentity;
  if (!identity) {
    errorResponse(res, 401, "Authentication required", "AUTH_REQUIRED");
    return;
  }
  if (!identity.emailVerified || !identity.email) {
    errorResponse(res, 403, "A verified email is required", "EMAIL_UNVERIFIED");
    return;
  }
  next();
}

export function memberFromValue(value: unknown, uid: string): Member | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.uid !== uid ||
    typeof raw.email !== "string" ||
    typeof raw.role !== "string" ||
    typeof raw.status !== "string" ||
    typeof raw.active !== "boolean" ||
    typeof raw.assignedBusId !== "string" ||
    typeof raw.createdAt !== "number" ||
    typeof raw.updatedAt !== "number" ||
    !Number.isSafeInteger(raw.createdAt) ||
    !Number.isSafeInteger(raw.updatedAt) ||
    (raw.requestedRole !== undefined && !REQUESTED_ROLES.includes(raw.requestedRole as RequestedRole)) ||
    (raw.expiresAt !== undefined && !isValidExpiresAt(raw.expiresAt))
  ) {
    return null;
  }

  const role: MemberRole = raw.role as MemberRole;
  const status: MemberStatus = raw.status as MemberStatus;
  if (
    !MEMBER_ROLES.includes(role) ||
    !["pending", "approved", "rejected", "suspended"].includes(status)
  ) {
    return null;
  }

  return {
    uid,
    email: raw.email,
    role,
    status,
    active: raw.active,
    assignedBusId: raw.assignedBusId,
    requestedRole: (raw.requestedRole as RequestedRole | undefined) ?? null,
    expiresAt: (raw.expiresAt as number | undefined) ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function readMember(
  req: Request,
  uid = req.firebaseIdentity?.uid ?? "",
): Promise<Member | null> {
  const token = req.firebaseToken;
  if (!token || !uid) return null;
  const result = await readFirebase<unknown>(`memberships/${uid}`, token);
  return result.value === null ? null : memberFromValue(result.value, uid);
}

export async function requireActiveMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const member = await readMember(req);
    if (!member || member.status !== "approved" || !member.active) {
      errorResponse(
        res,
        403,
        "An approved active membership is required",
        "MEMBERSHIP_REQUIRED",
      );
      return;
    }
    if (!memberIsCurrent(member)) {
      errorResponse(
        res,
        403,
        `Your membership expired on ${new Date(member.expiresAt as number).toISOString()}; ask the transport office to extend it`,
        "MEMBERSHIP_EXPIRED",
      );
      return;
    }
    if (member.email !== req.firebaseIdentity?.email) {
      errorResponse(
        res,
        403,
        "The membership email does not match the Firebase email",
        "MEMBERSHIP_EMAIL_MISMATCH",
      );
      return;
    }
    if (!hasUniversityAccess(member)) {
      errorResponse(
        res,
        403,
        "A university email is required",
        "UNIVERSITY_EMAIL_REQUIRED",
      );
      return;
    }
    req.membership = member;
    next();
  } catch (error) {
    firebaseFailure(req, res, error, "Firebase membership is unavailable");
  }
}

/**
 * 503 for a Firebase failure. A Rules denial reaches here only after the API's own
 * gate passed, so either the live Rules and this build disagree (the rules file was
 * never published) or the data moved between the API's check and the write (a race the
 * Rules caught first; a retry gets the API's own 4xx). Name the refused path so a stale
 * publish is visible from the client instead of looking like a sign-in problem.
 */
export function firebaseFailure(req: Request, res: Response, error: unknown, message: string): void {
  const detail: { code: string } & FirebaseErrorDetail =
    error instanceof FirebaseServiceError ? { code: error.code, ...error.detail } : { code: "unavailable" };
  req.log.warn(detail, message);
  const denied = detail.code === "rules" && detail.path;
  errorResponse(
    res,
    503,
    denied
      ? `${message}: Firebase refused ${detail.path} (${detail.reason ?? "denied"}). Retry once; if it repeats, the published database rules are older than this build — publish the current rules from Setup`
      : message,
    "FIREBASE_UNAVAILABLE",
  );
}

export function requireRole(
  role: MemberRole,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next): Promise<void> => {
    if (!req.membership || req.membership.role !== role) {
      errorResponse(res, 403, `${role} membership is required`, "ROLE_REQUIRED");
      return;
    }
    next();
  };
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return requireRole("admin")(req, res, next);
}

export function requireDriver(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!memberCanDrive(req.membership)) {
    errorResponse(res, 403, "driver membership is required", "ROLE_REQUIRED");
    return Promise.resolve();
  }
  next();
  return Promise.resolve();
}

/** The owner keeps the ordinary admin role while also being allowed to drive. */
export function memberCanDrive(
  member: Pick<Member, "uid" | "role"> | null | undefined,
): boolean {
  return !!member && (member.role === "driver" || (member.role === "admin" && member.uid === ROOT_ADMIN_UID));
}

export async function requireDriverAssignment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const busId = Array.isArray(req.params.busId)
    ? req.params.busId[0]
    : req.params.busId;
  if (req.membership && req.membership.assignedBusId === busId) {
    next();
    return;
  }
  // ASG-01: a dated assignment for this bus also admits the driver. Start needs an
  // assignment whose IST day covers now; samples, heartbeats and end accept yesterday's
  // too, so a trip that crosses midnight can keep reporting and end (mirrored in Rules).
  const start = req.route?.path === "/:busId/start";
  if (req.membership && typeof busId === "string") {
    try {
      const now = Date.now();
      const match = (await readDriverAssignments(req.firebaseToken ?? "", req.membership.uid)).find(
        (assignment) =>
          assignment.busId === busId &&
          assignment.startsAt <= now &&
          now < assignment.endsAt + (start ? 0 : DAY_MS),
      );
      if (match) {
        req.assignment = match;
        next();
        return;
      }
    } catch (error) {
      firebaseFailure(req, res, error, "Firebase assignments are unavailable");
      return;
    }
  }
  errorResponse(
    res,
    403,
    start ? "The driver is not assigned to this bus today" : "The driver is not assigned to this bus",
    "BUS_ASSIGNMENT_REQUIRED",
  );
}

export { errorResponse };