import { Platform } from 'react-native';
import type { User } from 'firebase/auth';
import type { TrackingState } from '@workspace/driver-tracking';
import type { Permissions, Step, StepId } from '@/lib/permissions';
import { accountSteps, none, selectedBusOption, type MeLike } from '@/lib/account-steps';
import { buildStep } from '@/lib/build-step';

export { accountSteps, buildStep, selectedBusOption, type MeLike };

// Native preflight (NAT-04 / DRV-02): the build half lives in lib/build-step.ts, the account
// half in lib/account-steps.ts, the device half in lib/permissions.ts. Every red row carries
// exactly one instruction the driver can act on; Start stays disabled and re-runs the whole
// list at tap time.

export type RowId = 'build' | 'identity' | 'assignment' | 'bus' | 'network' | StepId;
export type Row = Step & { id: RowId; label: string };

export const LABELS: Record<RowId, string> = {
  build: 'App build',
  identity: 'Driver account',
  assignment: 'Bus assignment',
  bus: 'Bus in service',
  network: 'Network',
  services: 'Location services',
  foreground: 'Location while using the app',
  background: Platform.OS === 'ios' ? 'Location: Always' : 'Location: Allow all the time',
  battery: 'Battery optimisation',
  notifications: 'Notifications (Android 13+)',
};

/** Reachability of the PU Transit server itself, not just the radio: a captive portal or a dead API is "offline" for a trip. */
export async function probeNetwork(): Promise<Step> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(`https://${process.env.EXPO_PUBLIC_DOMAIN}/api/healthz?t=${Date.now()}`, { signal: controller.signal });
    return res.ok
      ? none(true, 'online')
      : none(false, `server error ${res.status}`, 'The PU Transit server is not answering — wait a minute and tap Re-check; if it continues, tell the transport office.');
  } catch {
    return none(false, 'offline', 'Turn on mobile data or Wi-Fi (check the SIM has data balance), then tap Re-check.');
  } finally {
    clearTimeout(timer);
  }
}

/** All rows in PRD order behind the build row; device rows read "checking" until the first read completes. */
export function buildRows(user: User | null, me: MeLike, network: Step | null, permissions: Permissions | null, chosenBusId: string | null, build: Step): Row[] {
  const account = accountSteps(user, me, network, chosenBusId);
  const checking = none(false, 'checking');
  const step = (id: RowId): Step =>
    id === 'build' ? build
      : id in account ? account[id as keyof typeof account]
        : id === 'network' ? network ?? checking
          : permissions?.[id as StepId] ?? checking;
  return (Object.keys(LABELS) as RowId[]).map(id => ({ id, label: LABELS[id], ...step(id) }));
}

/** One honest sentence for the Trip card: it never says "live" while a preflight row is red. */
export function tripStatus(tracking: TrackingState, rows: Row[]): string {
  const red = rows.find(row => !row.ok);
  const fix = red ? `${red.label}: ${red.fix ?? red.value}` : '';
  switch (tracking.phase) {
    case 'idle': return red ? `Not sharing — ${fix}` : 'Ready — tap Start to share this bus.';
    case 'conflict': return 'Not sharing — another phone is publishing this bus.';
    case 'starting': return 'Starting — not visible to students yet.';
    case 'acquiring': return 'Waiting for a GPS fix — not visible to students yet.';
    case 'live': return red ? `Sharing for now, but ${fix}` : 'Live — students can see this bus.';
    case 'delayed': return 'Uploads delayed — students may see the bus as stale.';
    case 'weak_gps': return 'Weak GPS — students see an approximate position.';
    case 'gps_unavailable': return 'No GPS fix — students see the bus as stale.';
    case 'offline': return 'Offline — students see the bus as stale; tracking resumes when the connection returns.';
    case 'stopping':
    case 'pending_end': return 'Ending the trip…';
    case 'recovery': return 'A previous trip is still open — tap End before starting a new one.';
  }
}
