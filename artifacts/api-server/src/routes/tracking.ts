import { Router, type IRouter, type Request, type Response } from "express";
import {
  EndTrackingBody,
  EndTrackingParams,
  EndTrackingResponse,
  ForceEndTrackingBody,
  ForceEndTrackingResponse,
  GetTrackingFeedParams,
  GetTrackingFeedResponse,
  HandoverTrackingBody,
  HandoverTrackingResponse,
  ListTrackingFeedsResponse,
  SendTrackingHeartbeatBody,
  SendTrackingHeartbeatParams,
  SendTrackingHeartbeatResponse,
  StartTrackingBody,
  StartTrackingParams,
  StartTrackingResponse,
  SubmitTrackingSampleBody,
  SubmitTrackingSampleParams,
  SubmitTrackingSampleResponse,
} from "@workspace/api-zod";
import {
  errorResponse,
  firebaseFailure,
  firebaseIdentity,
  memberCanDrive,
  memberIsCurrent,
  readMember,
  requireActiveMember,
  requireAdmin,
  requireDriver,
  requireDriverAssignment,
  requireVerifiedEmail,
  ROOT_ADMIN_UID,
} from "../middleware/firebase-auth";
import { rateLimit } from "../middleware/rate-limit";
import { AssignmentRefusal, serviceDateAt } from "../lib/assignments";
import { saveAssignment } from "./assignments";
import { appendAudit } from "../lib/audit";
import { publishedRouteVersions, readBus, startDenial } from "../lib/buses";
import { FirebaseServiceError } from "../lib/firebase";
import {
  endTracking,
  forceEndTracking,
  listTrackingFeeds,
  readTrackingFeed,
  readTrackingOwner,
  requestToken,
  sendTrackingHeartbeat,
  startTracking,
  submitTrackingSample,
  TrackingConflictError,
  type EndInput,
  type HeartbeatInput,
  type SampleInput,
  type StartInput,
} from "../lib/tracking";

const router: IRouter = Router();
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

const memberOnly = [firebaseIdentity, requireVerifiedEmail, requireActiveMember];
// SEC-01: a bus reports at most about once a second (normal cadence is 16 requests a minute); one IP may front a depot.
const driverOnly = [
  firebaseIdentity,
  rateLimit("tracking", 60, 600),
  requireVerifiedEmail,
  requireActiveMember,
  requireDriver,
  requireDriverAssignment,
];
const adminOnly = [...memberOnly, requireAdmin];

function bodyObject(body: unknown): body is Record<string, unknown> {
  return !!body && typeof body === "object" && !Array.isArray(body);
}

function strictBody(
  body: unknown,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
  keys: string[],
): unknown | null {
  if (!bodyObject(body) || Object.keys(body).some((key) => !keys.includes(key))) return null;
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data ?? null : null;
}

function busIdFrom(req: Request): string | null {
  const value = Array.isArray(req.params.busId) ? req.params.busId[0] : req.params.busId;
  return typeof value === "string" && SAFE_PATH_SEGMENT.test(value) ? value : null;
}

function providerFailure(req: Request, res: Response, error: unknown): void {
  firebaseFailure(req, res, error, "Firebase tracking is unavailable");
}

function trackingFailure(res: Response, error: unknown): void {
  if (error instanceof TrackingConflictError) {
    const badRequestCodes = new Set([
      "INVALID_SAMPLE",
      "INVALID_HEARTBEAT",
      "INVALID_START",
      "INVALID_END",
      "FUTURE_TIMESTAMP",
      "STALE_CAPTURE",
    ]);
    if (badRequestCodes.has(error.conflictCode)) {
      errorResponse(res, 400, error.message, "INVALID_REQUEST");
      return;
    }
    errorResponse(res, 409, error.message, error.conflictCode);
    return;
  }
  throw error;
}

router.get("/", ...adminOnly, async (req, res): Promise<void> => {
  try {
    const feeds = await listTrackingFeeds(req.firebaseToken ?? "");
    res.json(ListTrackingFeedsResponse.parse(feeds));
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.get("/:busId", ...memberOnly, async (req, res): Promise<void> => {
  const busId = busIdFrom(req);
  if (!busId) {
    errorResponse(res, 400, "Invalid bus ID", "INVALID_REQUEST");
    return;
  }
  try {
    const feed = await readTrackingFeed(req.firebaseToken ?? "", busId);
    res.json(GetTrackingFeedResponse.parse(feed));
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.post("/:busId/start", ...driverOnly, async (req, res): Promise<void> => {
  const params = StartTrackingParams.safeParse(req.params);
  const body = strictBody(
    req.body,
    StartTrackingBody,
    ["tripId", "publisherId", "expectedGeneration", "requestedAt", "direction"],
  ) as StartInput | null;
  if (!params.success || !busIdFrom(req) || !body) {
    errorResponse(res, 400, "Invalid tracking start", "INVALID_REQUEST");
    return;
  }
  const busId = busIdFrom(req) as string;
  try {
    const auth = requestToken(req);
    const denial = startDenial(await readBus(auth.token, busId), busId); // FLT-03: serviceable bus only
    if (denial) {
      errorResponse(res, 403, denial.message, denial.code);
      return;
    }
    // RTE-02: pin the route versions riders will see for the whole trip.
    const routeVersions = await publishedRouteVersions(auth.token, busId);
    // ASG-01: a trip admitted by a dated assignment carries its id so the Rules can keep admitting it.
    const assignmentId = req.assignment?.id;
    const result = await startTracking(auth.token, auth.uid, busId, { ...body, routeVersions, ...(assignmentId ? { assignmentId } : {}) });
    res.status(result.status).json(StartTrackingResponse.parse(result.session));
  } catch (error) {
    if (error instanceof TrackingConflictError) {
      trackingFailure(res, error);
      return;
    }
    // Deactivation can commit after the preflight read. A Rules refusal is
    // definitive, but classify it as a parked bus only if a caller-token read agrees.
    if (error instanceof FirebaseServiceError && error.code === "rules") {
      try {
        const denial = startDenial(await readBus(req.firebaseToken ?? "", busId), busId);
        if (denial) {
          errorResponse(res, 403, denial.message, denial.code);
          return;
        }
      } catch (readError) {
        providerFailure(req, res, readError);
        return;
      }
    }
    providerFailure(req, res, error);
  }
});

router.post("/:busId/sample", ...driverOnly, async (req, res): Promise<void> => {
  const params = SubmitTrackingSampleParams.safeParse(req.params);
  const body = strictBody(
    req.body,
    SubmitTrackingSampleBody,
    ["tripId", "publisherId", "generation", "sequence", "capturedAt", "lat", "lng", "accuracy", "full"],
  ) as SampleInput | null;
  if (!params.success || !busIdFrom(req) || !body) {
    errorResponse(res, 400, "Invalid tracking sample", "INVALID_REQUEST");
    return;
  }
  try {
    const auth = requestToken(req);
    const result = await submitTrackingSample(auth.token, auth.uid, busIdFrom(req) as string, body);
    res.json(SubmitTrackingSampleResponse.parse(result));
  } catch (error) {
    if (error instanceof TrackingConflictError) {
      trackingFailure(res, error);
      return;
    }
    providerFailure(req, res, error);
  }
});

router.post("/:busId/heartbeat", ...driverOnly, async (req, res): Promise<void> => {
  const params = SendTrackingHeartbeatParams.safeParse(req.params);
  const body = strictBody(
    req.body,
    SendTrackingHeartbeatBody,
    ["tripId", "publisherId", "generation", "sequence", "gpsUnavailable", "full"],
  ) as HeartbeatInput | null;
  if (!params.success || !busIdFrom(req) || !body) {
    errorResponse(res, 400, "Invalid tracking heartbeat", "INVALID_REQUEST");
    return;
  }
  try {
    const auth = requestToken(req);
    const result = await sendTrackingHeartbeat(auth.token, auth.uid, busIdFrom(req) as string, body);
    res.json(SendTrackingHeartbeatResponse.parse(result));
  } catch (error) {
    if (error instanceof TrackingConflictError) {
      trackingFailure(res, error);
      return;
    }
    providerFailure(req, res, error);
  }
});

router.post("/:busId/end", ...driverOnly, async (req, res): Promise<void> => {
  const params = EndTrackingParams.safeParse(req.params);
  const body = strictBody(
    req.body,
    EndTrackingBody,
    ["tripId", "publisherId", "generation", "requestedAt"],
  ) as EndInput | null;
  if (!params.success || !busIdFrom(req) || !body) {
    errorResponse(res, 400, "Invalid tracking end", "INVALID_REQUEST");
    return;
  }
  try {
    const auth = requestToken(req);
    const result = await endTracking(auth.token, auth.uid, busIdFrom(req) as string, body);
    res.json(EndTrackingResponse.parse(result));
  } catch (error) {
    if (error instanceof TrackingConflictError) {
      trackingFailure(res, error);
      return;
    }
    providerFailure(req, res, error);
  }
});

router.post("/:busId/force-end", ...adminOnly, async (req, res): Promise<void> => {
  const busId = busIdFrom(req);
  const body = strictBody(req.body, ForceEndTrackingBody, ["reason"]) as
    | { reason?: string }
    | null;
  if (!busId || !body) {
    errorResponse(res, 400, "Invalid force-end request", "INVALID_REQUEST");
    return;
  }
  try {
    const auth = requestToken(req);
    const result = await forceEndTracking(auth.token, auth.uid, busId);
    if (result.outcome === "already_ended") {
      res.json(ForceEndTrackingResponse.parse({
        outcome: result.outcome,
        feed: result.feed,
        auditId: null,
      }));
      return;
    }
    const reason = body.reason?.trim();
    const summary = `force-ended trip ${result.tripId} (generation ${result.generation}) of driver ${result.driverUid}${reason ? `; reason: ${reason}` : ""}`;
    try {
      const auditId = await appendAudit(auth.token, {
        actorUid: auth.uid,
        actorEmail: req.firebaseIdentity?.email ?? "",
        action: "tracking.force_end",
        target: busId,
        summary,
      });
      res.json(ForceEndTrackingResponse.parse({
        outcome: result.outcome,
        feed: result.feed,
        auditId,
      }));
    } catch (error) {
      req.log.error({ err: error }, "Force-end applied but audit append failed");
      errorResponse(
        res,
        502,
        "Change applied but the audit record could not be written",
        "AUDIT_FAILED",
      );
    }
  } catch (error) {
    if (error instanceof TrackingConflictError && error.conflictCode === "NOT_STARTED") {
      errorResponse(res, 404, error.message, "NOT_STARTED");
      return;
    }
    providerFailure(req, res, error);
  }
});

// ADM-10: one confirmed action replaces "force-end, then ask the next driver to Start". The next
// driver is authorized first (their standing bus, or a dated assignment for today on the given
// route — a refusal there changes nothing), then the current publisher is ended; one audit record
// names both drivers. The previous phone learns of it through 409 SESSION_CONFLICT on its next upload.
router.post("/:busId/handover", ...adminOnly, async (req, res): Promise<void> => {
  const busId = busIdFrom(req);
  const body = strictBody(req.body, HandoverTrackingBody, ["nextDriverUid", "routeId", "reason"]) as
    | { nextDriverUid: string; routeId?: string; reason?: string }
    | null;
  if (!busId || !body) {
    errorResponse(res, 400, "Invalid handover request", "INVALID_REQUEST");
    return;
  }
  try {
    const auth = requestToken(req);
    const owner = await readTrackingOwner(auth.token, busId);
    if (!owner) {
      errorResponse(res, 404, "Tracking has not started", "NOT_STARTED");
      return;
    }
    if (
      (owner.driverUid === ROOT_ADMIN_UID || body.nextDriverUid === ROOT_ADMIN_UID) &&
      auth.uid !== ROOT_ADMIN_UID
    ) {
      errorResponse(
        res,
        403,
        "Only the root administrator can change the root administrator's trip",
        "ROOT_ADMIN_PROTECTED",
      );
      return;
    }
    if (owner.driverUid === body.nextDriverUid) {
      errorResponse(res, 400, "That driver already holds this trip", "INVALID_REQUEST");
      return;
    }
    const [next, previous] = await Promise.all([readMember(req, body.nextDriverUid), readMember(req, owner.driverUid)]);
    if (!next || !memberCanDrive(next) || !memberIsCurrent(next)) {
      errorResponse(res, 409, `${next?.email ?? body.nextDriverUid} is not an approved, active driver (or their membership has expired)`, "DRIVER_NOT_ELIGIBLE");
      return;
    }
    let assignment = null;
    if (next.assignedBusId !== busId) {
      if (!body.routeId) {
        errorResponse(res, 400, `${next.email} usually drives ${next.assignedBusId || "no bus"}; choose a published route of ${busId} for today's assignment`, "ROUTE_REQUIRED");
        return;
      }
      try {
        assignment = await saveAssignment(
          req,
          { driverUid: next.uid, busId, routeId: body.routeId, serviceDate: serviceDateAt(Date.now()) },
          true,
        );
      } catch (error) {
        if (error instanceof AssignmentRefusal) {
          errorResponse(res, error.status, error.message, error.code);
          return;
        }
        throw error;
      }
    }
    // Bound to the trip the admin looked at: a bus that changed hands meanwhile is 409 OWNER_CHANGED
    // (the next driver's assignment, if written, stays; running the handover again overwrites it).
    const result = await forceEndTracking(auth.token, auth.uid, busId, owner);
    const reason = body.reason?.trim();
    // Both names first: the summary is cut at the Rules limit and the reason is the part that may go.
    const summary =
      `handed over bus ${busId} from ${previous?.email ?? owner.driverUid} (${owner.driverUid}) to ${next.email} (${next.uid}); ` +
      `trip ${result.tripId} generation ${result.generation} ${result.outcome === "already_ended" ? "had already ended" : "ended"}` +
      `${assignment ? `; assignment ${assignment.id}` : "; their usual bus"}${reason ? `; reason: ${reason}` : ""}`;
    try {
      const auditId = await appendAudit(auth.token, {
        actorUid: auth.uid,
        actorEmail: req.firebaseIdentity?.email ?? "",
        action: "tracking.handover",
        target: busId,
        summary,
      });
      res.json(HandoverTrackingResponse.parse({
        outcome: result.outcome,
        feed: result.feed,
        previousDriverUid: result.driverUid,
        assignment,
        auditId,
      }));
    } catch (error) {
      req.log.error({ err: error }, "Handover applied but audit append failed");
      errorResponse(res, 502, "Change applied but the audit record could not be written", "AUDIT_FAILED");
    }
  } catch (error) {
    if (error instanceof TrackingConflictError && error.conflictCode === "NOT_STARTED") {
      errorResponse(res, 404, error.message, "NOT_STARTED");
      return;
    }
    try {
      trackingFailure(res, error);
    } catch (unhandled) {
      providerFailure(req, res, unhandled);
    }
  }
});

export default router;