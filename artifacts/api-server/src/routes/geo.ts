import { Router, type IRouter, type Request, type Response } from "express";
import { rateLimit } from "../middleware/rate-limit";
import {
  GeocodePlaceBody,
  GeocodePlaceResponse,
  GetGeoDirectionsBody,
  GetGeoDirectionsResponse,
} from "@workspace/api-zod";
import {
  errorResponse,
  firebaseIdentity,
  requireActiveMember,
  requireAdmin,
  requireVerifiedEmail,
} from "../middleware/firebase-auth";
import {
  OrsError,
  VADODARA_BOUNDS,
  getGeoDirections,
  searchPlaces,
  type GeoPoint,
} from "../lib/ors";

const router: IRouter = Router();
// SEC-01: the limiter sits before the membership read; the ORS key is shared by every admin, so keep the per-uid
// limit under the provider's own per-minute quota.
const adminOnly = [
  firebaseIdentity,
  rateLimit("geo", 30, 30),
  requireVerifiedEmail,
  requireActiveMember,
  requireAdmin,
];

function bodyObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function validPoint(value: unknown): value is GeoPoint {
  if (!bodyObject(value) || !exactKeys(value, ["lat", "lng"])) return false;
  return (
    typeof value.lat === "number" &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= VADODARA_BOUNDS.south &&
    value.lat <= VADODARA_BOUNDS.north &&
    value.lng >= VADODARA_BOUNDS.west &&
    value.lng <= VADODARA_BOUNDS.east
  );
}

function providerFailure(req: Request, res: Response, error: unknown): void {
  if (error instanceof OrsError) {
    req.log.warn(
      {
        provider: "OpenRouteService",
        category: error.category,
        ...(error.status === undefined ? {} : { status: error.status }),
      },
      "OpenRouteService request failed",
    );
    if (error.category === "not_configured") {
      errorResponse(
        res,
        503,
        "OpenRouteService is not configured",
        "ORS_NOT_CONFIGURED",
      );
      return;
    }
    if (error.category === "provider_http") {
      errorResponse(
        res,
        502,
        `OpenRouteService provider failure (HTTP ${error.status ?? "unknown"})`,
        "ORS_PROVIDER_ERROR",
      );
      return;
    }
    if (error.category === "timeout") {
      errorResponse(res, 502, "OpenRouteService request timed out", "ORS_TIMEOUT");
      return;
    }
    if (error.category === "network") {
      errorResponse(res, 502, "OpenRouteService network failure", "ORS_NETWORK_ERROR");
      return;
    }
    if (error.category === "response_too_large") {
      errorResponse(
        res,
        502,
        "OpenRouteService response exceeded the route limit",
        "ORS_RESPONSE_TOO_LARGE",
      );
      return;
    }
    errorResponse(
      res,
      502,
      "OpenRouteService returned an invalid response",
      "ORS_INVALID_RESPONSE",
    );
    return;
  }

  req.log.warn({ provider: "OpenRouteService", category: "unknown" }, "Geo provider failure");
  errorResponse(res, 502, "OpenRouteService request failed", "ORS_PROVIDER_ERROR");
}

router.use(...adminOnly);

router.post("/geocode", async (req, res): Promise<void> => {
  if (!bodyObject(req.body) || !exactKeys(req.body, ["query"])) {
    errorResponse(res, 400, "Invalid geocode request", "INVALID_REQUEST");
    return;
  }
  const query = typeof req.body.query === "string" ? req.body.query.trim() : "";
  if (!query || query.length > 200 || !GeocodePlaceBody.safeParse({ query }).success) {
    errorResponse(res, 400, "Invalid geocode request", "INVALID_REQUEST");
    return;
  }

  try {
    const places = await searchPlaces(query);
    res.json(GeocodePlaceResponse.parse({ places }));
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.post("/directions", async (req, res): Promise<void> => {
  // RTE-01: optional `via` stops in travel order, so the returned geometry covers every leg.
  const via: unknown = bodyObject(req.body) && req.body.via !== undefined ? req.body.via : [];
  if (
    !bodyObject(req.body) ||
    !(exactKeys(req.body, ["start", "end"]) || exactKeys(req.body, ["start", "end", "via"])) ||
    !validPoint(req.body.start) ||
    !validPoint(req.body.end) ||
    !Array.isArray(via) ||
    via.length > 48 ||
    !via.every(validPoint) ||
    !GetGeoDirectionsBody.safeParse(req.body).success
  ) {
    errorResponse(res, 400, "Invalid directions request", "INVALID_REQUEST");
    return;
  }

  try {
    const path = await getGeoDirections(req.body.start, req.body.end, via);
    res.json(GetGeoDirectionsResponse.parse({ path }));
  } catch (error) {
    providerFailure(req, res, error);
  }
});

export default router;