import { Router, type IRouter, type Request, type Response } from "express";
import { CreateAssignmentBody } from "@workspace/api-zod";
import {
  ASSIGNMENT_KEY,
  AssignmentRefusal,
  assignmentConflict,
  assignmentFromValue,
  assignmentKey,
  readAllAssignments,
  serviceDateAt,
  serviceDayBounds,
  type Assignment,
} from "../lib/assignments";
import { appendAudit, type AuditAction } from "../lib/audit";
import { busKey, liveTrip, readBus, startDenial } from "../lib/buses";
import { FirebaseServiceError, readFirebase, serverTimestamp, writeFirebase } from "../lib/firebase";
import {
  errorResponse,
  firebaseFailure,
  firebaseIdentity,
  memberIsCurrent,
  memberCanDrive,
  readMember,
  requireActiveMember,
  requireAdmin,
  requireVerifiedEmail,
  ROOT_ADMIN_UID,
} from "../middleware/firebase-auth";

// ASG-01: dated assignments. Conflicts are refused with names before anything is
// persisted; the Rules verify the record shape and references, the API owns the
// cross-driver conflict check (Rules cannot scan other drivers' subtrees).

const router: IRouter = Router();
const adminOnly = [firebaseIdentity, requireVerifiedEmail, requireActiveMember, requireAdmin];

function providerFailure(req: Request, res: Response, error: unknown): void {
  firebaseFailure(req, res, error, "Firebase assignments are unavailable");
}

async function audit(req: Request, action: AuditAction, target: string, summary: string): Promise<void> {
  await appendAudit(req.firebaseToken ?? "", {
    actorUid: req.firebaseIdentity?.uid ?? "",
    actorEmail: req.firebaseIdentity?.email ?? "",
    action,
    target,
    summary,
  });
}

function auditFailure(req: Request, res: Response, error: unknown): void {
  req.log.error({ err: error }, "Change applied but audit append failed");
  errorResponse(res, 502, "Change applied but the audit record could not be written", "AUDIT_FAILED");
}

router.get("/", ...adminOnly, async (req, res): Promise<void> => {
  try {
    res.json(await readAllAssignments(req.firebaseToken ?? ""));
  } catch (error) {
    providerFailure(req, res, error);
  }
});

export type SaveAssignmentInput = { driverUid: string; busId: string; routeId: string; serviceDate: string };

/**
 * Validates and writes assignments/{driverUid}/{id}; every refusal is an AssignmentRefusal thrown
 * before anything is persisted. A `handover` (ADM-10) reassigns the bus itself, so whoever it was
 * booked for that shift is overridden (the same known limit as a standing driver); the driver being
 * booked on another bus at the same time is still refused with names.
 */
export async function saveAssignment(req: Request, input: SaveAssignmentInput, handover = false): Promise<Assignment> {
  const busId = busKey(input.busId);
  const bounds = serviceDayBounds(input.serviceDate);
  if (!busId || !bounds) {
    throw new AssignmentRefusal(400, "INVALID_REQUEST", "Invalid assignment: driver, bus, route and a valid service date are required");
  }
  const { driverUid, routeId, serviceDate } = input;
  if (driverUid === ROOT_ADMIN_UID && req.firebaseIdentity?.uid !== ROOT_ADMIN_UID) {
    throw new AssignmentRefusal(
      403,
      "ROOT_ADMIN_PROTECTED",
      "Only the root administrator can change the root administrator's assignments",
    );
  }
  if (serviceDate < serviceDateAt(Date.now())) {
    throw new AssignmentRefusal(400, "INVALID_REQUEST", "The service date has already passed");
  }
  const token = req.firebaseToken ?? "";
  const driver = await readMember(req, driverUid);
  if (!driver || !memberCanDrive(driver) || !memberIsCurrent(driver)) {
    throw new AssignmentRefusal(409, "DRIVER_NOT_ELIGIBLE", `${driver?.email ?? driverUid} is not an approved, active driver (or their membership has expired)`);
  }
  const denial = startDenial(await readBus(token, busId), busId);
  if (denial) throw new AssignmentRefusal(409, denial.code, denial.message);
  const route = (await readFirebase<Record<string, unknown> | null>(`routes/${routeId}`, token)).value;
  const shift = typeof route?.shift === "string" ? route.shift : "";
  if (!route || route.busNumber !== busId || (route.status ?? "published") !== "published" || !shift) {
    throw new AssignmentRefusal(409, "ROUTE_NOT_FOR_BUS", `Route ${routeId} is not a published route of bus ${busId}`);
  }
  const id = assignmentKey(serviceDate, shift, busId);
  const candidate: Assignment = {
    id,
    driverUid,
    driverEmail: driver.email,
    busId,
    routeId,
    routeVersion: Number.isSafeInteger(route.publishedVersion) ? (route.publishedVersion as number) : null,
    shift,
    serviceDate,
    startsAt: bounds.startsAt,
    endsAt: bounds.endsAt,
    createdAt: 0,
    createdBy: req.firebaseIdentity?.uid ?? "",
  };
  const existing = (await readAllAssignments(token)).filter((other) => !(handover && other.busId === busId));
  const conflict = assignmentConflict(candidate, existing);
  if (conflict) throw new AssignmentRefusal(409, "ASSIGNMENT_CONFLICT", conflict);
  const { createdAt: _createdAt, routeVersion, ...fields } = candidate;
  await writeFirebase(`assignments/${driverUid}/${id}`, token, "PUT", {
    ...fields,
    ...(routeVersion === null ? {} : { routeVersion }),
    createdAt: serverTimestamp(),
  });
  const saved = assignmentFromValue(
    (await readFirebase<unknown>(`assignments/${driverUid}/${id}`, token)).value,
    driverUid,
    id,
  );
  if (!saved) throw new FirebaseServiceError("unavailable", "missing saved assignment");
  return saved;
}

router.post("/", ...adminOnly, async (req, res): Promise<void> => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 400, "Invalid assignment: driver, bus, route and a valid service date are required", "INVALID_REQUEST");
    return;
  }
  try {
    const saved = await saveAssignment(req, parsed.data);
    try {
      await audit(req, "assignment.save", saved.id, `${saved.driverEmail} on bus ${saved.busId} for ${saved.serviceDate} (${saved.shift})`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(201).json(saved);
  } catch (error) {
    if (error instanceof AssignmentRefusal) {
      errorResponse(res, error.status, error.message, error.code);
      return;
    }
    providerFailure(req, res, error);
  }
});

router.delete("/:driverUid/:assignmentId", ...adminOnly, async (req, res): Promise<void> => {
  const driverUid = String(req.params.driverUid ?? "");
  const id = String(req.params.assignmentId ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(driverUid) || !ASSIGNMENT_KEY.test(id)) {
    errorResponse(res, 400, "Invalid assignment reference", "INVALID_REQUEST");
    return;
  }
  const token = req.firebaseToken ?? "";
  const path = `assignments/${driverUid}/${id}`;
  try {
    const existing = assignmentFromValue((await readFirebase<unknown>(path, token)).value, driverUid, id);
    if (!existing) {
      res.status(204).end();
      return;
    }
    if (driverUid === ROOT_ADMIN_UID && req.firebaseIdentity?.uid !== ROOT_ADMIN_UID) {
      errorResponse(
        res,
        403,
        "Only the root administrator can change the root administrator's assignments",
        "ROOT_ADMIN_PROTECTED",
      );
      return;
    }
    // A trip running under this assignment would lose its write permission mid-trip.
    const [live, pinned] = await Promise.all([
      liveTrip(token, existing.busId),
      readFirebase<unknown>(`tracking/${existing.busId}/feed/assignmentId`, token),
    ]);
    if (live && pinned.value === id) {
      errorResponse(
        res,
        409,
        `${existing.driverEmail} is driving bus ${existing.busId} under this assignment right now; end the trip first`,
        "ASSIGNMENT_IN_USE",
      );
      return;
    }
    await writeFirebase(path, token, "DELETE");
    try {
      await audit(
        req,
        "assignment.delete",
        id,
        `${existing.driverEmail} off bus ${existing.busId} for ${existing.serviceDate} (${existing.shift})`,
      );
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(204).end();
  } catch (error) {
    providerFailure(req, res, error);
  }
});

export default router;
