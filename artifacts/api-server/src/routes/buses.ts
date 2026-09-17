import { Router, type IRouter, type Request, type Response } from "express";
import { CreateBusBody, UpdateBusBody } from "@workspace/api-zod";
import { appendAudit, type AuditAction } from "../lib/audit";
import { BUS_KEY, busFromValue, busKey, liveTrip, readBus, readBuses, type Bus } from "../lib/buses";
import {
  conditionalCreateFirebase,
  FirebaseServiceError,
  readFirebase,
  serverTimestamp,
  writeFirebase,
} from "../lib/firebase";
import {
  errorResponse,
  firebaseFailure,
  firebaseIdentity,
  requireActiveMember,
  requireAdmin,
  requireVerifiedEmail,
} from "../middleware/firebase-auth";

const router: IRouter = Router();
const memberOnly = [firebaseIdentity, requireVerifiedEmail, requireActiveMember];
const adminOnly = [...memberOnly, requireAdmin];

function strictBody<T>(
  body: unknown,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  keys: string[],
): T | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !keys.includes(key))) return null;
  const parsed = schema.safeParse(body);
  return parsed.success && parsed.data ? parsed.data : null;
}

function providerFailure(req: Request, res: Response, error: unknown): void {
  firebaseFailure(req, res, error, "Firebase bus registry is unavailable");
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

function activeTripFailure(res: Response, busId: string, trip: { tripId: string | null; startedAt: number }): void {
  errorResponse(
    res,
    409,
    `Bus ${busId} has a live trip${trip.tripId ? ` (${trip.tripId})` : ""} since ${new Date(trip.startedAt).toISOString()}; end it from Fleet first.`,
    "BUS_ACTIVE_TRIP",
  );
}

router.get("/", ...memberOnly, async (req, res): Promise<void> => {
  try {
    const buses = await readBuses(req.firebaseToken ?? "");
    res.json(
      req.membership?.role === "admin" ? buses : buses.filter((bus) => bus.status === "active"),
    );
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.post("/", ...adminOnly, async (req, res): Promise<void> => {
  const body = strictBody(req.body, CreateBusBody, ["registration", "label"]);
  const busId = body ? busKey(body.registration) : null;
  if (!body || !busId) {
    errorResponse(
      res,
      400,
      "A registration must contain 2 to 20 letters or digits once spaces and dashes are removed",
      "INVALID_REQUEST",
    );
    return;
  }
  const label = (body.label ?? body.registration).trim() || busId;
  const token = req.firebaseToken ?? "";
  try {
    const result = await conditionalCreateFirebase<unknown>(`buses/${busId}`, token, {
      busId,
      label,
      status: "active",
      reason: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (!result.created) {
      const existing = busFromValue(result.value, busId);
      errorResponse(
        res,
        409,
        `Registration ${busId} is already registered as "${existing?.label ?? busId}" (${existing?.status ?? "unknown"})`,
        "BUS_EXISTS",
      );
      return;
    }
    const saved = await readBus(token, busId);
    if (!saved) throw new FirebaseServiceError("unavailable", "missing saved bus");
    try {
      await audit(req, "bus.save", busId, `registered "${label}"`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(201).json(saved);
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.patch("/:busId", ...adminOnly, async (req, res): Promise<void> => {
  const busId = Array.isArray(req.params.busId) ? req.params.busId[0] : req.params.busId;
  const body = strictBody(req.body, UpdateBusBody, ["label", "status", "reason"]);
  if (typeof busId !== "string" || !BUS_KEY.test(busId) || !body || Object.keys(body).length === 0) {
    errorResponse(res, 400, "Invalid bus update", "INVALID_REQUEST");
    return;
  }
  const token = req.firebaseToken ?? "";
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await readFirebase<unknown>(`buses/${busId}`, token, true);
      if (snapshot.value === null) {
        errorResponse(res, 404, "Bus not found", "NOT_FOUND");
        return;
      }
      const current = busFromValue(snapshot.value, busId);
      if (!current) throw new FirebaseServiceError("unavailable", "Firebase bus data is invalid");
      if (!snapshot.etag) throw new FirebaseServiceError("unavailable", "Firebase bus version is missing");
      const status = body.status ?? current.status;
      const deactivating = status === "out_of_service" && current.status === "active";
      const reactivating = status === "active" && current.status === "out_of_service";
      if (deactivating) {
        const trip = await liveTrip(token, busId);
        if (trip) {
          activeTripFailure(res, busId, trip);
          return;
        }
      }
      const next: Bus = {
        ...current,
        label: body.label?.trim() || current.label,
        status,
        reason: status === "active" ? "" : (body.reason ?? current.reason).trim(),
      };
      try {
        await writeFirebase(`buses/${busId}`, token, "PUT", { ...next, updatedAt: serverTimestamp() }, {
          "If-Match": snapshot.etag,
        });
      } catch (error) {
        // Re-read, re-merge and recheck trips; never overwrite a newer admin save.
        if (error instanceof FirebaseServiceError && error.code === "conflict") continue;
        // A Start does not change the bus ETag. Rules guard the cross-record
        // race at commit time; only report a trip conflict after confirming it.
        if (deactivating && error instanceof FirebaseServiceError && error.code === "rules") {
          const trip = await liveTrip(token, busId);
          if (trip) {
            activeTripFailure(res, busId, trip);
            return;
          }
        }
        throw error;
      }
      const saved = await readBus(token, busId);
      if (!saved) throw new FirebaseServiceError("unavailable", "missing saved bus");
      const [action, summary]: [AuditAction, string] = deactivating
        ? ["bus.deactivate", `out of service${next.reason ? `: ${next.reason}` : ""}`]
        : reactivating
          ? ["bus.reactivate", "back in service"]
          : ["bus.save", `label "${current.label}" -> "${next.label}"${next.reason !== current.reason ? `; reason: ${next.reason}` : ""}`];
      try {
        await audit(req, action, busId, summary);
      } catch (error) {
        auditFailure(req, res, error);
        return;
      }
      res.json(saved);
      return;
    }
    errorResponse(res, 409, "Bus changed while saving; please retry", "BUS_CONFLICT");
  } catch (error) {
    providerFailure(req, res, error);
  }
});

export default router;
