import { fetchWithAuth, ApiError } from './api';
import { auth } from './firebase';
import type { TrackingTransport } from '@workspace/driver-tracking';
import type {
  Assignment,
  AssignmentInput,
  AuditList,
  AuthMe,
  Bus,
  BusInput,
  BusUpdate,
  ForceEndResult,
  HandoverRequest,
  HandoverResult,
  LiveTrackingFeed,
  ListTrackingFeeds200,
  MigrationPreview,
  Member,
  MemberRole,
  MembershipUpdate,
  Notice,
  NoticeInput,
  RouteVersion,
  ServiceDay,
  ServiceDayInput,
  TripEndResult,
  TripSession,
} from '@workspace/api-client-react';

export type Route = {
  id: string;
  shift: string;
  busNumber: string;
  origin: string;
  destination: string;
  stops: { lat: number; lng: number; name?: string }[];
  pathData?: { lat: number; lng: number }[]; 
  kind?: 'bus' | 'shuttle';
  /** Drafts are admin-only; the API never lists them to riders (RTE-01). Archived routes are hidden too (RTE-03 adds the action). */
  status: 'draft' | 'published' | 'archived';
  /** ors = road path verified through every stop; manual = admin-acknowledged unverified; absent = unverified (drafts, pre-RTE-01 routes). */
  pathSource?: 'ors' | 'manual';
  /** RTE-02: the version riders see; absent for routes published before versioning. */
  publishedVersion?: number;
  /** Admin lists only: this content is an unpublished draft; riders still see publishedVersion. */
  hasDraft?: boolean;
};
export type { RouteVersion };

const TRACKING_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The transport deliberately goes through fetchWithAuth rather than calling
 * fetch directly.  Apart from keeping Firebase token handling in one place,
 * this also means an account switch between token acquisition and response
 * processing fails closed.
 */
function accountChanged(uid: string): ApiError {
  return new ApiError('Account changed. Please retry.', 401, 'unauthenticated');
}

function assertTransportAccount(uid: string): void {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw accountChanged(uid);
  }
}

async function boundedTrackingRequest<T>(
  uid: string,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  assertTransportAccount(uid);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  let rejectCancellation: ((reason?: unknown) => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });

  if (signal) {
    if (signal.aborted) {
      const reason = signal.reason ?? new DOMException('The request was aborted.', 'AbortError');
      controller.abort(reason);
      rejectCancellation?.(reason);
    } else {
      const abort = () => {
        const reason = signal.reason ?? new DOMException('The request was aborted.', 'AbortError');
        controller.abort(reason);
        rejectCancellation?.(reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', abort);
    }
  }
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const reason = new DOMException('Tracking request timed out.', 'TimeoutError');
      controller.abort(reason);
      reject(reason);
    }, TRACKING_REQUEST_TIMEOUT_MS);
  });

  try {
    const request = fetchWithAuth(url, { ...init, signal: controller.signal }) as Promise<T>;
    const result = await Promise.race([request, cancellation, timeoutFailure]);
    assertTransportAccount(uid);
    return result;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeAbortListener?.();
  }
}

export function createTrackingTransport(busId: string, uid: string): TrackingTransport {
  const path = `/api/tracking/${encodeURIComponent(busId)}`;
  const send = <T>(suffix: string, method: string, body?: unknown, signal?: AbortSignal) =>
    boundedTrackingRequest<T>(uid, `${path}${suffix}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, signal);

  return {
    getFeed: signal => send<LiveTrackingFeed>('', 'GET', undefined, signal),
    start: (input, signal) => send<TripSession>('/start', 'POST', input, signal),
    sample: (input, signal) => send<TripSession>('/sample', 'POST', input, signal),
    heartbeat: (input, signal) => send<TripSession>('/heartbeat', 'POST', input, signal),
    end: (input, signal) => send<TripEndResult>('/end', 'POST', input, signal),
  };
}

export type { Assignment, AssignmentInput, Bus, BusInput, BusStatus, BusUpdate, DriverAssignment, Member, MemberRole, Notice, NoticeInput, ServiceDay, ServiceDayInput } from '@workspace/api-client-react';

export const storage = {
  saveRoute: async (route: Omit<Route, 'id'>, existingId?: string) => {
    return fetchWithAuth('/api/routes', {
      method: 'POST',
      body: JSON.stringify(existingId ? { ...route, id: existingId } : route)
    });
  },

  /** RTE-04: new routes go under an id the form picked, so retrying a failed save lands on the same route instead of a second one. */
  createRoute: async (route: Omit<Route, 'id'>, id: string): Promise<Route> => {
    return fetchWithAuth(`/api/routes/${id}`, { method: 'PUT', body: JSON.stringify({ ...route, id }) });
  },

  /** RTE-03: only never-published drafts; published routes are archived instead. */
  deleteRoute: async (id: string) => {
    return fetchWithAuth(`/api/routes/${id}`, { method: 'DELETE' });
  },

  /** RTE-03: hidden from riders, versions kept; publishing again restores it. */
  archiveRoute: async (id: string): Promise<Route> => {
    return fetchWithAuth(`/api/routes/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  },

  getRoutes: async (signal?: AbortSignal): Promise<Route[]> => {
    return fetchWithAuth('/api/routes', { signal });
  },

  /** RTE-02: the immutable snapshot a trip pinned at Start. */
  getRouteVersion: async (id: string, n: number, signal?: AbortSignal): Promise<RouteVersion> => {
    return fetchWithAuth(`/api/routes/${encodeURIComponent(id)}/versions/${n}`, { signal });
  },

  getBuses: async (signal?: AbortSignal): Promise<Bus[]> => {
    return fetchWithAuth('/api/buses', { signal });
  },

  createBus: async (input: BusInput): Promise<Bus> => {
    return fetchWithAuth('/api/buses', { method: 'POST', body: JSON.stringify(input) });
  },

  updateBus: async (busId: string, data: BusUpdate): Promise<Bus> => {
    return fetchWithAuth(`/api/buses/${encodeURIComponent(busId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  getTrackingFeed: async (busId: string, signal?: AbortSignal): Promise<LiveTrackingFeed> => {
    return fetchWithAuth(`/api/tracking/${encodeURIComponent(busId)}`, { signal });
  },

  getTrackingFeeds: async (signal?: AbortSignal): Promise<ListTrackingFeeds200> => {
    return fetchWithAuth('/api/tracking', { signal });
  },

  /** Admin: end a bus's live trip from the office. The API writes an audit entry; auditId is null when nothing changed. */
  forceEndTracking: async (busId: string, reason?: string): Promise<ForceEndResult> => {
    return fetchWithAuth(`/api/tracking/${encodeURIComponent(busId)}/force-end`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    });
  },

  /** Admin (ADM-10): end the current trip and authorize the next driver's Start in one action; one audit names both. */
  handoverTracking: async (busId: string, body: HandoverRequest): Promise<HandoverResult> => {
    return fetchWithAuth(`/api/tracking/${encodeURIComponent(busId)}/handover`, { method: 'POST', body: JSON.stringify(body) });
  },

  getAudit: async (limit = 50, signal?: AbortSignal): Promise<AuditList> => {
    return fetchWithAuth(`/api/audit?limit=${limit}`, { signal });
  },

  // Auth/Member endpoints
  getMe: async (signal?: AbortSignal): Promise<AuthMe> => {
    return fetchWithAuth('/api/auth/me', { signal });
  },

  requestMembership: async (role: MemberRole): Promise<Member> => {
    return fetchWithAuth('/api/auth/membership', { method: 'POST', body: JSON.stringify({ role }) });
  },

  getMemberships: async (signal?: AbortSignal): Promise<Member[]> => {
    return fetchWithAuth('/api/memberships', { signal });
  },

  updateMembership: async (uid: string, data: MembershipUpdate): Promise<Member> => {
    return fetchWithAuth(`/api/memberships/${uid}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  listNotices: async (signal?: AbortSignal): Promise<Notice[]> => {
    return fetchWithAuth('/api/notices', { signal });
  },

  createNotice: async (input: NoticeInput): Promise<Notice> => {
    return fetchWithAuth('/api/notices', { method: 'POST', body: JSON.stringify(input) });
  },

  deleteNotice: async (id: string): Promise<void> => {
    return fetchWithAuth(`/api/notices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // STU-04b: admin-managed no-service days; an empty list means "nothing declared", not "service runs".
  listServiceCalendar: async (signal?: AbortSignal): Promise<ServiceDay[]> => {
    return fetchWithAuth('/api/service-calendar', { signal });
  },

  setServiceDay: async (date: string, input: ServiceDayInput): Promise<ServiceDay> => {
    return fetchWithAuth(`/api/service-calendar/${encodeURIComponent(date)}`, { method: 'PUT', body: JSON.stringify(input) });
  },

  deleteServiceDay: async (date: string): Promise<void> => {
    return fetchWithAuth(`/api/service-calendar/${encodeURIComponent(date)}`, { method: 'DELETE' });
  },

  // ASG-01: dated assignments (admin). Conflicts come back as 409 ASSIGNMENT_CONFLICT with the other driver/bus named.
  getAssignments: async (signal?: AbortSignal): Promise<Assignment[]> => {
    return fetchWithAuth('/api/assignments', { signal });
  },

  createAssignment: async (input: AssignmentInput): Promise<Assignment> => {
    return fetchWithAuth('/api/assignments', { method: 'POST', body: JSON.stringify(input) });
  },

  deleteAssignment: async (driverUid: string, id: string): Promise<void> => {
    return fetchWithAuth(`/api/assignments/${encodeURIComponent(driverUid)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // Migration endpoints
  getMigrationPreview: async (): Promise<MigrationPreview> => {
    return fetchWithAuth('/api/migration/preview');
  },

  runMigration: async (): Promise<{ importedRoutes: number; skippedRoutes: number }> => {
    return fetchWithAuth('/api/migration/import', { method: 'POST', body: '{}' });
  }
};
