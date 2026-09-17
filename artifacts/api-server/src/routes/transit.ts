import { randomUUID } from "node:crypto";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { coversNow, readDriverAssignments } from "../lib/assignments";
import { appendAudit, listAudit, membershipChangeSummary } from "../lib/audit";
import { busKey, liveTrip, readBus, readBuses } from "../lib/buses";
import { offPathStops } from "../lib/route-path";
import {
  conditionalCreateFirebase,
  FirebaseServiceError,
  isFirebaseDemoMode,
  readFirebase,
  serverTimestamp,
  writeFirebase,
} from "../lib/firebase";
import {
  errorResponse,
  firebaseFailure,
  firebaseIdentity,
  graceEndsAt,
  isUniversityEmail,
  isValidExpiresAt,
  MEMBER_ROLES,
  memberCanDrive,
  memberFromValue,
  memberIsCurrent,
  readMember,
  requireActiveMember,
  requireAdmin,
  requireVerifiedEmail,
  ROOT_ADMIN_UID,
} from "../middleware/firebase-auth";
import { rateLimit } from "../middleware/rate-limit";
import type { Member, MemberRole, RequestedRole } from "../middleware/firebase-auth";

const router: IRouter = Router();
const MAX_STRING_LENGTH = 200;
const MAX_BUS_ID_LENGTH = 128;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTICE_TEXT_MAX = 280; // mirrored in Rules
const NOTICE_MAX_MS = 30 * 24 * 60 * 60 * 1000; // mirrored in Rules
// STU-04b: serviceCalendar/{yyyy-mm-dd}; key regex and note length mirrored in Rules
const SERVICE_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SERVICE_NOTE_MAX = 140;

type Coordinate = { lat: number; lng: number };
type RouteStop = Coordinate & { name?: string };
type RouteKind = "bus" | "shuttle";
type RouteStatus = "draft" | "published" | "archived"; // archived: stored/filtered only until RTE-03 adds the action
type RoutePathSource = "ors" | "manual";
type TransitRoute = {
  id: string;
  shift: string;
  busNumber: string;
  origin: string;
  destination: string;
  stops: RouteStop[];
  pathData: Coordinate[];
  kind?: RouteKind;
  status: RouteStatus;
  pathSource?: RoutePathSource;
  /** RTE-02: the version riders see; absent until first published under versioning (legacy routes). */
  publishedVersion?: number;
  /** Admin lists only: the content is an unpublished draft of a published route. */
  hasDraft?: true;
};
/** RTE-02: immutable copy of what riders saw from a publish onwards. */
type RouteVersion = Omit<TransitRoute, "id" | "status" | "publishedVersion" | "hasDraft"> & {
  n: number;
  createdAt: number | ReturnType<typeof serverTimestamp>;
  createdBy: string;
};
type Notice = {
  id: string;
  text: string;
  routeId: string;
  until: number;
  createdBy: string;
  createdAt: number;
};
type ServiceDay = { date: string; noService: true; note?: string; updatedBy: string; updatedAt: number };

/** API shape of a membership: the stored record plus whether it is the owner's untouchable account. */
function memberResponse(member: Member): Member & { root: boolean } {
  return { ...member, root: member.uid === ROOT_ADMIN_UID };
}
function badRequest(res: Response, message: string): void {
  errorResponse(res, 400, message, "INVALID_REQUEST");
}

function notFound(res: Response, message: string): void {
  errorResponse(res, 404, message, "NOT_FOUND");
}

function providerFailure(
  req: Request,
  res: Response,
  error: unknown,
  message = "Firebase service is unavailable",
): void {
  firebaseFailure(req, res, error, message);
}

function bodyObject(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function safePathSegment(value: unknown, maxLength = MAX_BUS_ID_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    SAFE_PATH_SEGMENT.test(value)
  );
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseCoordinate(value: unknown): Coordinate | null {
  const object = bodyObject(value);
  if (
    !object ||
    !hasOnlyKeys(object, ["lat", "lng"]) ||
    !finiteCoordinate(object.lat) ||
    !finiteCoordinate(object.lng) ||
    object.lat < -90 ||
    object.lat > 90 ||
    object.lng < -180 ||
    object.lng > 180
  ) {
    return null;
  }
  return { lat: object.lat, lng: object.lng };
}

function parseStop(value: unknown): RouteStop | null {
  const object = bodyObject(value);
  if (
    !object ||
    !hasOnlyKeys(object, ["lat", "lng", "name"]) ||
    !finiteCoordinate(object.lat) ||
    !finiteCoordinate(object.lng) ||
    object.lat < -90 ||
    object.lat > 90 ||
    object.lng < -180 ||
    object.lng > 180 ||
    (object.name !== undefined &&
      (typeof object.name !== "string" || object.name.length > MAX_STRING_LENGTH))
  ) {
    return null;
  }
  return {
    lat: object.lat,
    lng: object.lng,
    ...(object.name === undefined ? {} : { name: object.name }),
  };
}

/** `stored` admits fields the API sets itself (publishedVersion, archived); request bodies may not. */
function parseRouteInput(
  value: unknown,
  requiredId = false,
  stored = false,
): TransitRoute | null {
  const object = bodyObject(value);
  if (
    !object ||
    !hasOnlyKeys(object, [
      "id",
      "shift",
      "busNumber",
      "origin",
      "destination",
      "stops",
      "pathData",
      "kind",
      "status",
      "pathSource",
      ...(stored ? ["publishedVersion"] : []),
    ]) ||
    (object.kind !== undefined && object.kind !== "bus" && object.kind !== "shuttle") ||
    (object.status !== "draft" && object.status !== "published" && !(stored && object.status === "archived")) ||
    (object.publishedVersion !== undefined &&
      (!Number.isSafeInteger(object.publishedVersion) || (object.publishedVersion as number) < 1)) ||
    (object.pathSource !== undefined && object.pathSource !== "ors" && object.pathSource !== "manual") ||
    (requiredId && !safePathSegment(object.id)) ||
    (object.id !== undefined && !safePathSegment(object.id)) ||
    typeof object.shift !== "string" ||
    typeof object.busNumber !== "string" ||
    typeof object.origin !== "string" ||
    typeof object.destination !== "string" ||
    object.shift.length === 0 ||
    object.busNumber.length === 0 ||
    object.origin.length === 0 ||
    object.destination.length === 0 ||
    object.shift.length > MAX_STRING_LENGTH ||
    object.busNumber.length > MAX_STRING_LENGTH ||
    object.origin.length > MAX_STRING_LENGTH ||
    object.destination.length > MAX_STRING_LENGTH ||
    !Array.isArray(object.stops) ||
    object.stops.length > 500 ||
    (object.pathData !== undefined &&
      (!Array.isArray(object.pathData) || object.pathData.length > 5000))
  ) {
    return null;
  }

  const stops = object.stops.map(parseStop);
  const pathData = (object.pathData ?? []).map(parseCoordinate);
  if (stops.some((stop) => stop === null) || pathData.some((point) => point === null)) {
    return null;
  }

  return {
    id: object.id as string,
    shift: object.shift,
    busNumber: object.busNumber,
    origin: object.origin,
    destination: object.destination,
    stops: stops as RouteStop[],
    pathData: pathData as Coordinate[],
    ...(object.kind === undefined ? {} : { kind: object.kind as RouteKind }),
    status: object.status as RouteStatus,
    ...(object.pathSource === undefined ? {} : { pathSource: object.pathSource as RoutePathSource }),
    ...(object.publishedVersion === undefined ? {} : { publishedVersion: object.publishedVersion as number }),
  };
}

// RTE-01: publishing needs road geometry through every stop, or the admin's
// explicit manual-path acknowledgement. An "ors" claim is checked on every save
// so a stale endpoint-only path can never masquerade as a verified one.
function pathRefusal(route: TransitRoute): string | null {
  if (route.pathSource === "ors") {
    const off = offPathStops(route.stops, route.pathData);
    if (off.length === 0) return null;
    return `The plotted road path misses ${off.map((stop) => `${stop.name} (${Number.isFinite(stop.metres) ? `${stop.metres} m away` : "no path"})`).join(", ")}. Plot the road path again through every stop, or tick manual path.`;
  }
  if (route.status !== "published" || route.pathSource === "manual") return null;
  return "Publishing needs the road path plotted through every stop, or the manual path acknowledgement. Save it as a draft until then.";
}

function routeForStorage(route: TransitRoute): TransitRoute {
  return {
    id: route.id,
    shift: route.shift,
    busNumber: route.busNumber,
    origin: route.origin,
    destination: route.destination,
    stops: route.stops,
    pathData: route.pathData,
    ...(route.kind === undefined ? {} : { kind: route.kind }),
    status: route.status,
    ...(route.pathSource === undefined ? {} : { pathSource: route.pathSource }),
    ...(route.publishedVersion === undefined ? {} : { publishedVersion: route.publishedVersion }),
  };
}

function versionForStorage(route: TransitRoute, n: number, createdBy: string): RouteVersion {
  const { id: _id, status: _status, publishedVersion: _version, hasDraft: _draft, ...content } = routeForStorage(route);
  return { n, ...content, createdAt: serverTimestamp(), createdBy };
}

function routeFromValue(value: unknown, id: string): TransitRoute | null {
  const object = bodyObject(value);
  if (!object || object.id !== id) return null;
  return parseRouteInput(
    {
      ...object,
      stops: object.stops ?? [],
      pathData: object.pathData ?? [],
      // Records written before RTE-01 carry no status: they were always visible, so they stay published (and unverified).
      status: object.status ?? "published",
    },
    true,
    true,
  );
}

function routeVersionFromValue(value: unknown, id: string, n: number): RouteVersion | null {
  const object = bodyObject(value);
  if (!object || object.n !== n || !Number.isSafeInteger(object.createdAt) || typeof object.createdBy !== "string") return null;
  const { n: _n, createdAt, createdBy, ...content } = object;
  const route = parseRouteInput({ ...content, id, status: "published" }, true);
  if (!route) return null;
  const { id: _id, status: _status, ...rest } = route;
  return { n, ...rest, createdAt: createdAt as number, createdBy };
}

/** Pending edits of published routes (RTE-02): admins see these in place of the node; riders never do. */
async function readDrafts(req: Request): Promise<Map<string, TransitRoute>> {
  const drafts = new Map<string, TransitRoute>();
  const result = await readFirebase<unknown>("routeDrafts", req.firebaseToken ?? "");
  const object = bodyObject(result.value);
  if (!object) return drafts;
  for (const [id, value] of Object.entries(object)) {
    if (value === null) continue;
    const draft = safePathSegment(id) ? routeFromValue(value, id) : null;
    if (!draft) throw new FirebaseServiceError("unavailable", "Firebase route data is invalid");
    drafts.set(id, draft);
  }
  return drafts;
}

function withDraft(route: TransitRoute, draft: TransitRoute | undefined): TransitRoute {
  if (!draft) return route;
  return {
    ...draft,
    status: route.status,
    ...(route.publishedVersion === undefined ? {} : { publishedVersion: route.publishedVersion }),
    hasDraft: true,
  };
}

async function readRoute(req: Request, id: string): Promise<TransitRoute | null> {
  const token = req.firebaseToken;
  if (!token) return null;
  const result = await readFirebase<unknown>(`routes/${id}`, token);
  if (result.value === null) return null;
  const route = routeFromValue(result.value, id);
  if (!route) {
    throw new FirebaseServiceError("unavailable", "Firebase route data is invalid");
  }
  return route;
}

async function readRoutes(req: Request): Promise<TransitRoute[]> {
  const token = req.firebaseToken;
  if (!token) return [];
  const result = await readFirebase<unknown>("routes", token);
  if (result.value === null) return [];
  const object = bodyObject(result.value);
  if (!object) {
    throw new FirebaseServiceError("unavailable", "Firebase route data is invalid");
  }

  const routes: TransitRoute[] = [];
  for (const [id, value] of Object.entries(object)) {
    if (value === null) continue;
    if (!safePathSegment(id)) {
      throw new FirebaseServiceError("unavailable", "Firebase route data is invalid");
    }
    const route = routeFromValue(value, id);
    if (!route) {
      throw new FirebaseServiceError("unavailable", "Firebase route data is invalid");
    }
    routes.push(route);
  }
  return routes;
}

function parseEmptyBody(body: unknown): boolean {
  const object = bodyObject(body);
  return !!object && Object.keys(object).length === 0;
}

const memberOnly = [firebaseIdentity, requireVerifiedEmail, requireActiveMember];
const adminOnly = [...memberOnly, requireAdmin];
// SEC-01: route writes are admin-only and each one is a database write plus an audit entry.
const routeWrite = [firebaseIdentity, rateLimit("routes", 30, 60), requireVerifiedEmail, requireActiveMember, requireAdmin];

async function appendRequestAudit(
  req: Request,
  action: "membership.update" | "route.save" | "route.delete" | "route.archive" | "notice.save" | "notice.delete" | "calendar.save" | "calendar.delete",
  target: string,
  summary: string,
): Promise<string> {
  return appendAudit(req.firebaseToken ?? "", {
    actorUid: req.firebaseIdentity?.uid ?? "",
    actorEmail: req.firebaseIdentity?.email ?? "",
    action,
    target,
    summary,
  });
}

function auditFailure(req: Request, res: Response, error: unknown): void {
  req.log.error({ err: error }, "Change applied but audit append failed");
  errorResponse(
    res,
    502,
    "Change applied but the audit record could not be written",
    "AUDIT_FAILED",
  );
}

async function routeIsLocked(req: Request, route: TransitRoute): Promise<boolean> {
  return (await liveTrip(req.firebaseToken ?? "", route.busNumber)) !== null;
}

/**
 * Every bus reference must be a registered canonical key (FLT-01); an
 * unregistered or non-canonical value names the fix. Returns the key to store.
 */
async function registeredBus(
  req: Request,
  res: Response,
  raw: string,
  requireActive: boolean,
): Promise<string | null> {
  const key = busKey(raw);
  if (!key) {
    badRequest(res, `Bus "${raw}" must contain 2 to 20 letters or digits`);
    return null;
  }
  const bus = await readBus(req.firebaseToken ?? "", key);
  if (!bus) {
    errorResponse(res, 409, `Bus ${key} is not in the registry; add it under Fleet first.`, "BUS_NOT_REGISTERED");
    return null;
  }
  if (requireActive && bus.status !== "active") {
    errorResponse(res, 409, `Bus ${key} is out of service; reactivate it first.`, "BUS_OUT_OF_SERVICE");
    return null;
  }
  return key;
}

router.get("/routes", ...memberOnly, async (req, res): Promise<void> => {
  try {
    const routes = await readRoutes(req);
    if (req.membership?.role === "admin") {
      const drafts = await readDrafts(req);
      res.json(routes.map((route) => withDraft(route, drafts.get(route.id))));
      return;
    }
    // Deactivated buses leave student search; their routes stay stored (FLT-02). Drafts are admin-only (RTE-01).
    const outOfService = new Set(
      (await readBuses(req.firebaseToken ?? ""))
        .filter((bus) => bus.status === "out_of_service")
        .map((bus) => bus.busId),
    );
    res.json(routes.filter((route) => route.status === "published" && !outOfService.has(route.busNumber)));
  } catch (error) {
    providerFailure(req, res, error, "Firebase routes are unavailable");
  }
});

router.get("/routes/:id/versions/:n", ...memberOnly, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const n = Number(Array.isArray(req.params.n) ? req.params.n[0] : req.params.n);
  if (!safePathSegment(id) || !Number.isSafeInteger(n) || n < 1) {
    badRequest(res, "Invalid route version");
    return;
  }
  try {
    const result = await readFirebase<unknown>(`routeVersions/${id}/${n}`, req.firebaseToken ?? "");
    if (result.value === null) {
      notFound(res, "Route version not found");
      return;
    }
    const version = routeVersionFromValue(result.value, id, n);
    if (!version) throw new FirebaseServiceError("unavailable", "Firebase route data is invalid");
    res.json(version);
  } catch (error) {
    providerFailure(req, res, error, "Firebase routes are unavailable");
  }
});

async function saveRoute(
  req: Request,
  res: Response,
  forcedId?: string,
  upsert = false,
): Promise<void> {
  const object = bodyObject(req.body);
  if (!object) {
    badRequest(res, "Route payload must be an object");
    return;
  }
  if (forcedId !== undefined && object.id !== undefined && object.id !== forcedId) {
    badRequest(res, "Route ID does not match the path");
    return;
  }
  // POST without an id creates; POST with an id (the web's edit path) must name an existing route.
  const creating = forcedId === undefined && object.id === undefined;
  if (creating) object.id = randomUUID();

  const route = parseRouteInput(
    forcedId === undefined
      ? object
      : { ...object, id: forcedId },
    forcedId !== undefined,
  );
  if (!route) {
    badRequest(res, "Invalid route payload");
    return;
  }
  const refusal = pathRefusal(route);
  if (refusal) {
    errorResponse(res, 409, refusal, "ROUTE_PATH_UNVERIFIED");
    return;
  }

  const token = req.firebaseToken;
  if (!token) {
    errorResponse(res, 401, "Authentication required", "AUTH_REQUIRED");
    return;
  }

  try {
    const existing = await readRoute(req, route.id);
    if (forcedId !== undefined && !existing && !upsert) {
      notFound(res, "Route not found");
      return;
    }
    if (forcedId === undefined && !creating && !existing) {
      notFound(res, "Route not found");
      return;
    }
    const busNumber = await registeredBus(req, res, route.busNumber, false);
    if (!busNumber) return;
    route.busNumber = busNumber;
    // RTE-04: a replayed PUT whose content the node already holds is answered from the node — no
    // extra version. It is still audited (marked as a replay): the first attempt may have failed
    // exactly at its audit line, and a retry must not turn that into an unaudited change.
    if (
      upsert &&
      existing &&
      JSON.stringify(routeForStorage({ ...route, publishedVersion: existing.publishedVersion })) ===
        JSON.stringify(routeForStorage(existing))
    ) {
      const state = existing.status === "published" ? `published v${existing.publishedVersion ?? "?"}` : existing.status;
      try {
        await appendRequestAudit(req, "route.save", route.id, `${route.origin} to ${route.destination}; bus ${route.busNumber}; ${state} (replayed, unchanged)`);
      } catch (error) {
        auditFailure(req, res, error);
        return;
      }
      res.status(200).json(existing);
      return;
    }
    const publishing = route.status === "published";
    // A route riders already see keeps its node until the next publish; the edit
    // waits in routeDrafts. Never-published drafts are simply overwritten.
    const published = existing && existing.status !== "draft" ? existing : null;
    // RTE-02 retired the edit lock: live trips pin the version they started
    // with. Two publishes still wait for the trip to end: a legacy published
    // route (no version yet) has nothing pinned, and moving a route to another
    // bus would send riders to the new bus's feed while the old trip still runs.
    const legacy = published?.publishedVersion === undefined;
    const movingBus = !!published && published.busNumber !== route.busNumber;
    const lockedBuses = publishing && published && (legacy || movingBus)
      ? [published.busNumber, route.busNumber].filter((bus, index, all) => all.indexOf(bus) === index)
      : [];
    for (const busNumber of lockedBuses) {
      if (!(await routeIsLocked(req, { ...route, busNumber }))) continue;
      errorResponse(
        res,
        409,
        legacy
          ? `Bus ${busNumber} has a live trip; end it from Fleet first, then publish once to start versioning.`
          : `Bus ${busNumber} has a live trip; moving this route to another bus waits until it ends.`,
        "ROUTE_LOCKED_ACTIVE_TRIP",
      );
      return;
    }

    let saved: TransitRoute;
    let summary: string;
    if (!publishing && published) {
      const draft = routeForStorage({ ...route, status: "draft", publishedVersion: undefined });
      await writeFirebase(`routeDrafts/${route.id}`, token, "PUT", draft);
      saved = withDraft(published, draft);
      summary = `draft saved; riders keep ${published.publishedVersion === undefined ? "the current route" : `v${published.publishedVersion}`}`;
    } else {
      const n = publishing ? (existing?.publishedVersion ?? 0) + 1 : undefined;
      const node = routeForStorage({ ...route, publishedVersion: n });
      if (publishing) {
        // One atomic write: the snapshot riders will be pinned to, the node they read, and the cleared draft.
        await writeFirebase("", token, "PATCH", {
          [`routes/${route.id}`]: node,
          [`routeVersions/${route.id}/${n}`]: versionForStorage(route, n as number, req.firebaseIdentity?.uid ?? ""),
          [`routeDrafts/${route.id}`]: null,
        });
      } else {
        await writeFirebase(`routes/${route.id}`, token, "PUT", node);
      }
      const stored = await readRoute(req, route.id);
      if (!stored) {
        providerFailure(req, res, new Error("missing saved route"), "Firebase route is unavailable");
        return;
      }
      saved = stored;
      summary = publishing ? `published v${n}` : "draft";
    }
    try {
      await appendRequestAudit(req, "route.save", route.id, `${route.origin} to ${route.destination}; bus ${route.busNumber}; ${summary}`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(existing ? 200 : 201).json(saved);
  } catch (error) {
    providerFailure(req, res, error, "Firebase routes are unavailable");
  }
}

router.post("/routes", ...routeWrite, async (req, res): Promise<void> => {
  await saveRoute(req, res);
});

// RTE-04: the web creates with a client-chosen id, so a save whose response was lost can be
// retried without making a second route — the replay lands on the same node (a replayed publish
// is one more identical version). POST with an id stays the edit path and still 404s when gone.
router.put("/routes/:id", ...routeWrite, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  // Rules key every route node by UUID; refusing other ids here keeps that a 400, not a 503 from the write.
  if (!safePathSegment(id) || !UUID.test(id)) {
    badRequest(res, "Route ID must be a UUID");
    return;
  }
  await saveRoute(req, res, id, true);
});

router.patch("/routes/:id", ...routeWrite, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!safePathSegment(id)) {
    badRequest(res, "Invalid route ID");
    return;
  }
  await saveRoute(req, res, id);
});

router.delete("/routes/:id", ...routeWrite, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!safePathSegment(id)) {
    badRequest(res, "Invalid route ID");
    return;
  }
  try {
    const route = await readRoute(req, id);
    if (!route) {
      notFound(res, "Route not found");
      return;
    }
    // RTE-03: only a draft nobody has ever seen can go for good. A published route
    // is what riders' trips and the audit trail refer to, so it is archived instead.
    if (route.status !== "draft") {
      errorResponse(
        res,
        409,
        "This route has been published, so its history stays; archive it instead of deleting.",
        "ROUTE_PUBLISHED",
      );
      return;
    }
    await writeFirebase("", req.firebaseToken ?? "", "PATCH", { [`routes/${id}`]: null, [`routeDrafts/${id}`]: null });
    try {
      await appendRequestAudit(req, "route.delete", id, `${route.origin} to ${route.destination}; bus ${route.busNumber}`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(204).end();
  } catch (error) {
    providerFailure(req, res, error, "Firebase routes are unavailable");
  }
});

router.post("/routes/:id/archive", ...routeWrite, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!safePathSegment(id)) {
    badRequest(res, "Invalid route ID");
    return;
  }
  try {
    const route = await readRoute(req, id);
    if (!route) {
      notFound(res, "Route not found");
      return;
    }
    if (route.status === "draft") {
      errorResponse(res, 409, "This draft was never published; delete it instead.", "ROUTE_NOT_PUBLISHED");
      return;
    }
    if (route.status === "archived") {
      res.json(route);
      return;
    }
    // Riders on a live trip follow this route (pinned or, before versioning, live); archiving
    // would take it out of their search mid-trip.
    if (await routeIsLocked(req, route)) {
      errorResponse(
        res,
        409,
        `Bus ${route.busNumber} has a live trip and riders on it are following this route; archive it once the trip ends.`,
        "ROUTE_LOCKED_ACTIVE_TRIP",
      );
      return;
    }
    // Content, versions and any pending draft stay; publishing again restores the route.
    const archived = routeForStorage({ ...route, status: "archived" });
    await writeFirebase(`routes/${id}`, req.firebaseToken ?? "", "PUT", archived);
    try {
      await appendRequestAudit(req, "route.archive", id, `${route.origin} to ${route.destination}; bus ${route.busNumber}; archived, hidden from riders`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.json(archived);
  } catch (error) {
    providerFailure(req, res, error, "Firebase routes are unavailable");
  }
});

router.get("/auth/me", firebaseIdentity, async (req, res): Promise<void> => {
  const identity = req.firebaseIdentity;
  if (!identity || !identity.email) {
    errorResponse(res, 403, "A Firebase email is required", "EMAIL_REQUIRED");
    return;
  }

  const universityEmail = isUniversityEmail(identity.email);
  try {
    if (!identity.emailVerified) {
      res.json({
        uid: identity.uid,
        email: identity.email,
        emailVerified: false,
        universityEmail,
        graceEndsAt: null,
        membership: null,
        bus: null,
        assignments: [],
      });
      return;
    }
    let membership = await readMember(req);
    if (membership && membership.email !== identity.email && universityEmail) {
      // The user verified a new university email (verifyBeforeUpdateEmail); the
      // record follows the token so Rules keep matching. Rules allow only this
      // exact change, so a partial failure cannot corrupt the record.
      await writeFirebase(`memberships/${identity.uid}`, req.firebaseToken ?? "", "PUT", {
        ...membershipForStorage(membership),
        email: identity.email,
        updatedAt: serverTimestamp(),
      });
      membership = await readMember(req);
    }
    // FLT-03: a driver's preflight shows the bus record (even parked, with its reason).
    // Only approved, active members may read the registry (Rules), and only they can start.
    // AC-32: a token whose email no longer matches the record may read the record and nothing else —
    // Rules deny the bus and assignment reads — so the client gets the bare record to explain the stop.
    const driver = membership && memberCanDrive(membership) && membership.email === identity.email && memberIsCurrent(membership) ? membership : null;
    const token = req.firebaseToken ?? "";
    const bus = driver?.assignedBusId ? await readBus(token, driver.assignedBusId) : null;
    // ASG-01: today's dated assignments (IST) with their bus records; the same Rules gate applies.
    const now = Date.now();
    const assignments = driver
      ? await Promise.all(
          (await readDriverAssignments(token, driver.uid))
            .filter((assignment) => coversNow(assignment, now))
            .map(async (assignment) => ({ assignment, bus: await readBus(token, assignment.busId) })),
        )
      : [];
    res.json({
      uid: identity.uid,
      email: identity.email,
      emailVerified: true,
      universityEmail,
      graceEndsAt: membership ? graceEndsAt(membership) : null,
      membership: membership ? memberResponse(membership) : null,
      bus,
      assignments,
    });
  } catch (error) {
    providerFailure(req, res, error, "Firebase membership is unavailable");
  }
});

/** The record as Rules expect it: no derived fields, requestedRole only when set. */
function membershipForStorage(member: Member): Record<string, unknown> {
  return {
    uid: member.uid,
    email: member.email,
    role: member.role,
    status: member.status,
    active: member.active,
    assignedBusId: member.assignedBusId,
    ...(member.requestedRole ? { requestedRole: member.requestedRole } : {}),
    ...(member.expiresAt ? { expiresAt: member.expiresAt } : {}),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

router.post(
  "/auth/membership",
  firebaseIdentity,
  // SEC-01: one membership per account; a cohort signing up from campus Wi-Fi shares an IP.
  rateLimit("membership", 5, 60),
  requireVerifiedEmail,
  async (req, res): Promise<void> => {
    const object = bodyObject(req.body);
    const chosen = object?.role;
    if (
      !object ||
      !hasOnlyKeys(object, ["role"]) ||
      typeof chosen !== "string" ||
      !MEMBER_ROLES.includes(chosen as MemberRole)
    ) {
      badRequest(res, "Membership creation needs a role of student, staff, driver, or admin");
      return;
    }
    const identity = req.firebaseIdentity;
    const token = req.firebaseToken;
    if (!identity || !token) {
      errorResponse(res, 401, "Authentication required", "AUTH_REQUIRED");
      return;
    }
    // Personal-email sign-ups are students only; a driver or admin choice from a
    // university email becomes a request the office confirms from the Users tab.
    const universityEmail = isUniversityEmail(identity.email);
    if (!universityEmail && chosen !== "student") {
      errorResponse(
        res,
        403,
        "Staff, driver, and admin access needs a university email",
        "UNIVERSITY_EMAIL_REQUIRED",
      );
      return;
    }
    const requestedRole: RequestedRole | null =
      chosen === "driver" || chosen === "admin" ? chosen : null;

    try {
      const record: Record<string, unknown> = {
        uid: identity.uid,
        email: identity.email,
        role: requestedRole ? "student" : chosen,
        status: "approved",
        active: true,
        assignedBusId: "",
        ...(requestedRole ? { requestedRole } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const result = await conditionalCreateFirebase<unknown>(
        `memberships/${identity.uid}`,
        token,
        record,
      );
      const membership = await readMember(req);
      if (!membership) {
        if (!result.created && result.value !== null) {
          providerFailure(
            req,
            res,
            new Error("invalid membership"),
            "Firebase membership is unavailable",
          );
          return;
        }
        providerFailure(
          req,
          res,
          new Error("missing membership"),
          "Firebase membership is unavailable",
        );
        return;
      }
      res.status(result.created ? 201 : 200).json(memberResponse(membership));
    } catch (error) {
      providerFailure(req, res, error, "Firebase membership is unavailable");
    }
  },
);

router.get(
  "/memberships",
  ...adminOnly,
  async (req, res): Promise<void> => {
    try {
      const result = await readFirebase<unknown>("memberships", req.firebaseToken ?? "");
      const object = bodyObject(result.value);
      const memberships: ReturnType<typeof memberResponse>[] = [];
      if (object) {
        for (const [uid, value] of Object.entries(object)) {
          const member = value === null ? null : memberFromValue(value, uid);
          if (value !== null && !member) {
            throw new FirebaseServiceError(
              "unavailable",
              "Firebase membership data is invalid",
            );
          }
          if (member) memberships.push(memberResponse(member));
        }
      }
      res.json(memberships);
    } catch (error) {
      providerFailure(req, res, error, "Firebase memberships are unavailable");
    }
  },
);

router.patch(
  "/memberships/:uid",
  ...adminOnly,
  async (req, res): Promise<void> => {
    const uid = Array.isArray(req.params.uid) ? req.params.uid[0] : req.params.uid;
    if (!safePathSegment(uid)) {
      badRequest(res, "Invalid membership UID");
      return;
    }
    const object = bodyObject(req.body);
    if (
      !object ||
      !hasOnlyKeys(object, ["role", "status", "active", "assignedBusId", "requestedRole", "expiresAt"]) ||
      Object.keys(object).length === 0
    ) {
      badRequest(res, "Invalid membership update");
      return;
    }
    if (
      (object.role !== undefined && !MEMBER_ROLES.includes(object.role as MemberRole)) ||
      (object.requestedRole !== undefined && object.requestedRole !== null) ||
      (object.status !== undefined &&
        !["pending", "approved", "rejected", "suspended"].includes(String(object.status))) ||
      (object.active !== undefined && typeof object.active !== "boolean") ||
      (object.expiresAt !== undefined && object.expiresAt !== null && !isValidExpiresAt(object.expiresAt)) ||
      (object.assignedBusId !== undefined &&
        (typeof object.assignedBusId !== "string" ||
          object.assignedBusId.length > MAX_BUS_ID_LENGTH ||
          (object.assignedBusId !== "" && !safePathSegment(object.assignedBusId))))
    ) {
      badRequest(res, "Invalid membership update");
      return;
    }

    try {
      const current = await readMember(req, uid);
      if (!current) {
        notFound(res, "Membership not found");
        return;
      }

      if (uid === ROOT_ADMIN_UID && req.firebaseIdentity?.uid !== ROOT_ADMIN_UID) {
        errorResponse(
          res,
          403,
          "Only the root administrator can change the root administrator",
          "ROOT_ADMIN_PROTECTED",
        );
        return;
      }
      const role = (object.role as Member["role"] | undefined) ?? current.role;
      const status = (object.status as Member["status"] | undefined) ?? current.status;
      let active = (object.active as boolean | undefined) ?? current.active;
      let assignedBusId =
        (object.assignedBusId as string | undefined) ?? current.assignedBusId;
      if (status !== "approved") active = false;
      if (!memberCanDrive({ uid, role })) assignedBusId = "";
      // A granted or changed role settles the request; an explicit null dismisses it.
      const requestedRole =
        object.requestedRole === null || role !== current.role ? null : current.requestedRole;
      // IDN-01: null clears the expiry; an omitted key keeps it.
      const expiresAt = object.expiresAt === undefined ? current.expiresAt : (object.expiresAt as number | null);
      if (uid === ROOT_ADMIN_UID && expiresAt !== null) {
        errorResponse(
          res,
          403,
          "The root administrator cannot have an expiration",
          "SELF_DEMOTION_FORBIDDEN",
        );
        return;
      }
      if (!isUniversityEmail(current.email) && role !== "student") {
        errorResponse(
          res,
          403,
          "A personal-email member can only be a student until they switch to a university email",
          "UNIVERSITY_EMAIL_REQUIRED",
        );
        return;
      }
      if (role === "driver" && active && !safePathSegment(assignedBusId)) {
        errorResponse(
          res,
          403,
          "An active driver must have a safe bus assignment",
          "BUS_ASSIGNMENT_REQUIRED",
        );
        return;
      }
      if (assignedBusId !== "") {
        // A new assignment needs an in-service bus; an unchanged one only has to exist,
        // so a driver whose bus was parked can still be suspended or reactivated.
        const changed = busKey(assignedBusId) !== (busKey(current.assignedBusId) ?? current.assignedBusId);
        const key = await registeredBus(req, res, assignedBusId, changed);
        if (!key) return;
        assignedBusId = key;
      }
      if (
        uid === req.firebaseIdentity?.uid &&
        (role !== "admin" || status !== "approved" || !active || (expiresAt !== null && expiresAt <= Date.now()))
      ) {
        errorResponse(
          res,
          403,
          "An administrator cannot demote, suspend or expire themself",
          "SELF_DEMOTION_FORBIDDEN",
        );
        return;
      }

      await writeFirebase(`memberships/${uid}`, req.firebaseToken ?? "", "PUT", {
        uid: current.uid,
        email: current.email,
        role,
        status,
        active,
        assignedBusId,
        ...(requestedRole ? { requestedRole } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        createdAt: current.createdAt,
        updatedAt: serverTimestamp(),
      });
      const saved = await readMember(req, uid);
      if (!saved) {
        providerFailure(
          req,
          res,
          new Error("missing saved membership"),
          "Firebase memberships are unavailable",
        );
        return;
      }
      try {
        await appendRequestAudit(
          req,
          "membership.update",
          uid,
          membershipChangeSummary(current, saved),
        );
      } catch (error) {
        auditFailure(req, res, error);
        return;
      }
      res.json(memberResponse(saved));
    } catch (error) {
      providerFailure(req, res, error, "Firebase memberships are unavailable");
    }
  },
);

function noticeFromValue(value: unknown, id: string): Notice | null {
  const object = bodyObject(value);
  if (
    !object ||
    object.id !== id ||
    typeof object.text !== "string" ||
    typeof object.routeId !== "string" ||
    typeof object.until !== "number" ||
    typeof object.createdBy !== "string" ||
    typeof object.createdAt !== "number"
  ) {
    return null;
  }
  return {
    id,
    text: object.text,
    routeId: object.routeId,
    until: object.until,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
  };
}

// ponytail: expired notices are filtered on read, never purged; the office posts a
// handful a week, so the node stays small for years.
async function readNotices(req: Request): Promise<Notice[]> {
  const result = await readFirebase<unknown>("notices", req.firebaseToken ?? "");
  const object = bodyObject(result.value);
  if (!object) return [];
  const now = Date.now();
  const notices: Notice[] = [];
  for (const [id, value] of Object.entries(object)) {
    if (value === null) continue;
    const notice = noticeFromValue(value, id);
    if (!notice) {
      throw new FirebaseServiceError("unavailable", "Firebase notice data is invalid");
    }
    if (notice.until > now) notices.push(notice);
  }
  return notices.sort((a, b) => b.createdAt - a.createdAt);
}

router.get("/notices", ...memberOnly, async (req, res): Promise<void> => {
  try {
    res.json(await readNotices(req));
  } catch (error) {
    providerFailure(req, res, error, "Firebase notices are unavailable");
  }
});

router.post("/notices", ...adminOnly, async (req, res): Promise<void> => {
  const object = bodyObject(req.body);
  const text = typeof object?.text === "string" ? object.text.trim() : "";
  if (
    !object ||
    !hasOnlyKeys(object, ["text", "routeId", "until"]) ||
    text.length === 0 ||
    text.length > NOTICE_TEXT_MAX ||
    typeof object.routeId !== "string" ||
    (object.routeId !== "" && !UUID.test(object.routeId)) ||
    typeof object.until !== "number" ||
    !Number.isSafeInteger(object.until)
  ) {
    badRequest(res, "A notice needs text (1-280 characters), a route ID or empty string, and an until time");
    return;
  }
  const now = Date.now();
  if (object.until <= now || object.until > now + NOTICE_MAX_MS) {
    badRequest(res, "A notice must end in the future and within 30 days");
    return;
  }
  const id = randomUUID();
  const routeId = object.routeId;
  try {
    if (routeId !== "" && !(await readRoute(req, routeId))) {
      notFound(res, "Route not found");
      return;
    }
    await writeFirebase(`notices/${id}`, req.firebaseToken ?? "", "PUT", {
      id,
      text,
      routeId,
      until: object.until,
      createdBy: req.firebaseIdentity?.uid ?? "",
      createdAt: serverTimestamp(),
    });
    const result = await readFirebase<unknown>(`notices/${id}`, req.firebaseToken ?? "");
    const saved = noticeFromValue(result.value, id);
    if (!saved) {
      providerFailure(req, res, new Error("missing saved notice"), "Firebase notices are unavailable");
      return;
    }
    try {
      await appendRequestAudit(req, "notice.save", id, `${routeId === "" ? "all routes" : `route ${routeId}`}: ${text}`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(201).json(saved);
  } catch (error) {
    providerFailure(req, res, error, "Firebase notices are unavailable");
  }
});

router.delete("/notices/:id", ...adminOnly, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!UUID.test(id ?? "")) {
    badRequest(res, "Invalid notice ID");
    return;
  }
  try {
    const result = await readFirebase<unknown>(`notices/${id}`, req.firebaseToken ?? "");
    const notice = result.value === null ? null : noticeFromValue(result.value, id);
    if (!notice) {
      notFound(res, "Notice not found");
      return;
    }
    await writeFirebase(`notices/${id}`, req.firebaseToken ?? "", "DELETE");
    try {
      await appendRequestAudit(req, "notice.delete", id, notice.text);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(204).end();
  } catch (error) {
    providerFailure(req, res, error, "Firebase notices are unavailable");
  }
});

function rejectLegacyMigrationInDemo(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isFirebaseDemoMode()) {
    errorResponse(
      res,
      503,
      "Legacy migration is disabled in the local demo",
      "MIGRATION_DISABLED",
    );
    return;
  }
  next();
}

router.get(
  "/migration/preview",
  rejectLegacyMigrationInDemo,
  ...adminOnly,
  async (req, res): Promise<void> => {
    try {
      const { db, routesTable } = await import("@workspace/db");
      const routes = await db.select().from(routesTable);
      res.json({ routes: routes.length });
    } catch {
      req.log.warn({ code: "postgres_unavailable" }, "Legacy migration preview failed");
      errorResponse(
        res,
        503,
        "Legacy migration source is unavailable",
        "MIGRATION_UNAVAILABLE",
      );
    }
  },
);

// STU-04b: a day is "no service" only when an admin said so; nothing here infers holidays.
function serviceDayFromValue(value: unknown, date: string): ServiceDay | null {
  const object = bodyObject(value);
  if (
    !object ||
    object.date !== date ||
    object.noService !== true ||
    (object.note !== undefined && typeof object.note !== "string") ||
    typeof object.updatedBy !== "string" ||
    typeof object.updatedAt !== "number"
  ) {
    return null;
  }
  return { date, noService: true, ...(typeof object.note === "string" ? { note: object.note } : {}), updatedBy: object.updatedBy, updatedAt: object.updatedAt };
}

// Rules and DELETE accept the regex domain; PUT is narrower (real calendar dates only), so nothing Rules can hold is stuck.
const realServiceDate = (date: string): boolean =>
  SERVICE_DATE.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

router.get("/service-calendar", ...memberOnly, async (req, res): Promise<void> => {
  try {
    const result = await readFirebase<unknown>("serviceCalendar", req.firebaseToken ?? "");
    const days: ServiceDay[] = [];
    for (const [date, value] of Object.entries(bodyObject(result.value) ?? {})) {
      if (value === null) continue;
      const day = serviceDayFromValue(value, date);
      if (!day) throw new FirebaseServiceError("unavailable", "Firebase service calendar data is invalid");
      days.push(day);
    }
    res.json(days.sort((a, b) => a.date.localeCompare(b.date)));
  } catch (error) {
    providerFailure(req, res, error, "Firebase service calendar is unavailable");
  }
});

router.put("/service-calendar/:date", ...adminOnly, async (req, res): Promise<void> => {
  const date = Array.isArray(req.params.date) ? req.params.date[0] : req.params.date;
  if (!date || !realServiceDate(date)) {
    badRequest(res, "The date must be a real calendar date, yyyy-mm-dd");
    return;
  }
  const object = bodyObject(req.body);
  const note = typeof object?.note === "string" ? object.note.trim() : undefined;
  if (
    !object ||
    !hasOnlyKeys(object, ["noService", "note"]) ||
    object.noService !== true ||
    (object.note !== undefined && (typeof object.note !== "string" || (note ?? "").length > SERVICE_NOTE_MAX))
  ) {
    badRequest(res, `A no-service day needs noService: true and at most a ${SERVICE_NOTE_MAX}-character note`);
    return;
  }
  try {
    const path = `serviceCalendar/${date}`;
    await writeFirebase(path, req.firebaseToken ?? "", "PUT", {
      date,
      noService: true,
      ...(note ? { note } : {}),
      updatedBy: req.firebaseIdentity?.uid ?? "",
      updatedAt: serverTimestamp(),
    });
    const saved = serviceDayFromValue((await readFirebase<unknown>(path, req.firebaseToken ?? "")).value, date);
    if (!saved) {
      providerFailure(req, res, new Error("missing saved service day"), "Firebase service calendar is unavailable");
      return;
    }
    try {
      await appendRequestAudit(req, "calendar.save", date, `no service on ${date}${note ? `: ${note}` : ""}`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.json(saved);
  } catch (error) {
    providerFailure(req, res, error, "Firebase service calendar is unavailable");
  }
});

router.delete("/service-calendar/:date", ...adminOnly, async (req, res): Promise<void> => {
  const date = Array.isArray(req.params.date) ? req.params.date[0] : req.params.date;
  if (!date || !SERVICE_DATE.test(date)) {
    badRequest(res, "The date must be yyyy-mm-dd");
    return;
  }
  try {
    const path = `serviceCalendar/${date}`;
    const result = await readFirebase<unknown>(path, req.firebaseToken ?? "");
    const day = result.value === null ? null : serviceDayFromValue(result.value, date);
    if (!day) {
      notFound(res, "No-service day not found");
      return;
    }
    await writeFirebase(path, req.firebaseToken ?? "", "DELETE");
    try {
      await appendRequestAudit(req, "calendar.delete", date, `service restored on ${date}${day.note ? ` (was: ${day.note})` : ""}`);
    } catch (error) {
      auditFailure(req, res, error);
      return;
    }
    res.status(204).end();
  } catch (error) {
    providerFailure(req, res, error, "Firebase service calendar is unavailable");
  }
});

router.get("/audit", ...adminOnly, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = raw === undefined ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    badRequest(res, "Audit limit must be an integer from 1 to 200");
    return;
  }
  try {
    res.json({ entries: await listAudit(req.firebaseToken ?? "", limit) });
  } catch (error) {
    providerFailure(req, res, error, "Firebase audit is unavailable");
  }
});

router.post(
  "/migration/import",
  rejectLegacyMigrationInDemo,
  ...adminOnly,
  async (req, res): Promise<void> => {
    if (req.body !== undefined && !parseEmptyBody(req.body)) {
      badRequest(res, "Migration import accepts an empty object only");
      return;
    }
    try {
      const { db, routesTable } = await import("@workspace/db");
      const legacyRoutes = await db.select().from(routesTable);
      let importedRoutes = 0;
      let skippedRoutes = 0;
      for (const legacy of legacyRoutes) {
        const raw = legacy as unknown as Record<string, unknown>;
        // Legacy rows carry no verified path, so they arrive as drafts: an admin
        // plots or acknowledges each one before riders see it (RTE-01).
        const route = parseRouteInput({
          id: raw.id,
          shift: raw.shift,
          busNumber: raw.busNumber,
          origin: raw.origin,
          destination: raw.destination,
          stops: raw.stops,
          pathData: raw.pathData ?? [],
          status: "draft",
        }, true);
        if (!route) {
          skippedRoutes += 1;
          continue;
        }
        const result = await conditionalCreateFirebase(
          `routes/${route.id}`,
          req.firebaseToken ?? "",
          routeForStorage(route),
        );
        if (result.created) {
          importedRoutes += 1;
          try {
            await appendRequestAudit(
              req,
              "route.save",
              route.id,
              `${route.origin} to ${route.destination}; bus ${route.busNumber}`,
            );
          } catch (error) {
            auditFailure(req, res, error);
            return;
          }
        } else skippedRoutes += 1;
      }
      res.json({ importedRoutes, skippedRoutes });
    } catch (error) {
      if (error instanceof FirebaseServiceError) {
        providerFailure(req, res, error, "Firebase migration is unavailable");
        return;
      }
      req.log.warn({ code: "postgres_unavailable" }, "Legacy migration import failed");
      errorResponse(
        res,
        503,
        "Legacy migration source is unavailable",
        "MIGRATION_UNAVAILABLE",
      );
    }
  },
);

router.post("/auth/login", (_req, res): void => {
  errorResponse(
    res,
    401,
    "Legacy password authentication is disabled",
    "LEGACY_AUTH_DISABLED",
  );
});

router.post("/auth/logout", (_req, res): void => {
  res.status(204).end();
});

router.get("/auth/session", (_req, res): void => {
  errorResponse(
    res,
    401,
    "Legacy sessions are disabled",
    "LEGACY_AUTH_DISABLED",
  );
});

export default router;