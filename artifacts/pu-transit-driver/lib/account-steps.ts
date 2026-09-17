import type { User } from 'firebase/auth';
import type { AuthMe } from '@workspace/api-client-react';
import { accessThroughLabel, canDrive, driverBusOptions, membershipExpired, type DriverBusOption } from '@workspace/driver-tracking';
import type { Step } from '@/lib/permissions';

// The account half of the native preflight, kept free of React Native imports so
// the negative auth cases (NAT-06) run under node against the same rules the web
// AuthGate applies: unverified email, missing/pending/rejected/suspended/inactive
// membership, a passed access end (IDN-01) and wrong role all block; only an approved, active
// driver or the protected owner admin passes.

export const none = (ok: boolean, value: string, fix: string | null = null): Step => ({ ok, value, fix, action: 'none' });
export const waiting = (fix: string): Step => none(false, 'waiting', fix);

export type MeLike = { isLoading: boolean; error: { message: string; status?: number } | null; data: AuthMe | undefined };

/** ASG-01: the bus the driver is about to start — a chosen option, else the first (today's assignment before the standing bus). */
export function selectedBusOption(me: MeLike, chosenBusId: string | null): DriverBusOption | null {
  const options = driverBusOptions(me.data);
  return options.find(option => option.busId === chosenBusId) ?? options[0] ?? null;
}

export function accountSteps(user: User | null, me: MeLike, network: Step | null, chosenBusId: string | null = null): { identity: Step; assignment: Step; bus: Step } {
  const m = me.data?.membership;
  const selected = selectedBusOption(me, chosenBusId);
  const identity: Step = !user
    ? none(false, 'signed out', 'Sign in with your driver account above.')
    : me.isLoading
      ? none(false, 'checking')
      : me.error
        ? network && !network.ok
          ? waiting('Fix the Network row first, then tap Re-check.')
          : (me.error.status ?? 0) >= 500
            ? none(false, 'server error', `The server could not answer for this account (${me.error.message}). This is not a sign-in problem — tap Re-check once the server side is fixed.`)
            : none(false, 'not verified', `The server rejected this account (${me.error.message}) — sign out and in again; if it repeats, ask the transport admin.`)
        : me.data && me.data.uid !== user.uid
          ? none(false, 'account mismatch', 'The server answered for a different account — sign out and sign in again.')
          : me.data && !me.data.emailVerified
            ? none(false, 'email not verified', 'Open the verification link we emailed you, then tap Re-check. The web Account page can re-send it.')
            : !m
              ? none(false, 'not registered', 'This account is not registered with PU Transit — ask the transport admin to add you as a driver.')
               : !canDrive(m)
                ? none(false, `role: ${m.role}`, 'This account is not a driver account — ask the transport admin to set your role to driver.')
                : m.status !== 'approved'
                  ? none(false, m.status, m.status === 'pending'
                      ? 'Your driver account is waiting for approval — ask the transport admin to approve it.'
                      : `Your driver account is ${m.status} — ask the transport admin to restore it.`)
                  : !m.active
                    ? none(false, 'deactivated', 'Your driver account is deactivated — ask the transport admin to reactivate it.')
                    : membershipExpired(m)
                      ? none(false, 'expired', `Your driver access ran until ${accessThroughLabel(m.expiresAt as number)} — ask the transport admin to extend it.`)
                       : none(true, m.root && m.role === 'admin' ? 'owner admin' : user.email ?? 'driver');

  const assignment: Step = !identity.ok
    ? waiting('Finish the Driver account row first.')
    : selected
      ? none(true, selected.assignment ? `${selected.busId} · ${selected.assignment.shift} today` : selected.busId)
      : none(false, 'no bus', 'No bus is assigned to you — ask the transport admin to assign your bus, then tap Re-check.');

  // FLT-03: the API and Rules refuse Start unless the registry says the bus is active.
  const registered = selected?.bus ?? null;
  const bus: Step = !assignment.ok
    ? waiting('Finish the Bus assignment row first.')
    : !registered
      ? none(false, 'not registered', `Bus ${selected?.busId} is not in the fleet registry — ask the transport admin to add it under Fleet, then tap Re-check.`)
      : registered.status !== 'active'
        ? none(false, 'out of service', `Bus ${registered.busId} is out of service${registered.reason ? ` (${registered.reason})` : ''} — the trip cannot start; ask the transport admin.`)
        : none(true, registered.label);

  return { identity, assignment, bus };
}
