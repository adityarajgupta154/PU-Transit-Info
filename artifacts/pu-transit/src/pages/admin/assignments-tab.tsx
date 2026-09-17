import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { canDrive } from '@workspace/driver-tracking';
import { Tile, TileButton } from '@/components/metro/tile';
import { Field, SelectField } from '@/components/metro/field';
import { useToast } from '@/hooks/use-toast';
import { storage, type Assignment, type Bus, type Member, type Route } from '@/lib/storage';
import { shiftLabel, SHIFTS } from '@/lib/shifts';
import { serviceDateToday } from '@/lib/service-date';
import { cn } from '@/lib/utils';

export { serviceDateToday };

const shiftOrder = (shift: string): number => {
  const index = SHIFTS.findIndex((s) => s.value === shift);
  return index === -1 ? SHIFTS.length : index;
};
const byDayShiftBus = (a: Assignment, b: Assignment): number =>
  a.serviceDate.localeCompare(b.serviceDate) || shiftOrder(a.shift) - shiftOrder(b.shift) || a.busId.localeCompare(b.busId);

/**
 * The same check the API makes before persisting, so the form can say who is in the way
 * before the save is attempted. Same driver, bus, day and shift is an overwrite, not a conflict.
 */
export function conflictMessage(
  existing: Assignment[],
  draft: { driverUid: string; driverEmail: string; busId: string; serviceDate: string; shift: string },
): string | null {
  const when = `on ${draft.serviceDate} (${shiftLabel(draft.shift)})`;
  for (const other of existing) {
    if (other.serviceDate !== draft.serviceDate || other.shift !== draft.shift) continue;
    if (other.busId === draft.busId && other.driverUid === draft.driverUid) continue;
    if (other.busId === draft.busId) return `bus ${draft.busId} is already assigned to ${other.driverEmail} ${when}.`;
    if (other.driverUid === draft.driverUid) return `${draft.driverEmail} already drives bus ${other.busId} ${when}.`;
  }
  return null;
}

export function AssignmentsTab({
  members,
  buses,
  routes,
  actingMember = null,
}: {
  members: Member[];
  buses: Bus[];
  routes: Route[];
  actingMember?: Member | null;
}) {
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [driverUid, setDriverUid] = useState('');
  const [busId, setBusId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [serviceDate, setServiceDate] = useState(serviceDateToday);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setAssignments((await storage.getAssignments()) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'assignments could not load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const drivers = members
    .filter((m) => canDrive(m) && (!m.root || actingMember?.root === true) && m.status === 'approved' && m.active)
    .sort((a, b) => a.email.localeCompare(b.email));
  const activeBuses = buses.filter((b) => b.status === 'active');
  // Only routes riders can see: the API refuses drafts and archived routes (ROUTE_NOT_FOR_BUS).
  const busRoutes = routes.filter((r) => r.busNumber === busId && r.status !== 'draft' && r.status !== 'archived');
  const driver = drivers.find((m) => m.uid === driverUid) ?? null;
  const route = busRoutes.find((r) => r.id === routeId) ?? null;
  const today = serviceDateToday();
  const conflict =
    driver && busId && route && serviceDate
      ? conflictMessage(assignments, {
        driverUid: driver.uid,
        driverEmail: driver.root ? `owner admin · ${driver.email}` : driver.email,
        busId,
        serviceDate,
        shift: route.shift,
      })
      : null;
  const complete = Boolean(driver && busId && route && serviceDate >= today);
  const upcoming = assignments.filter((a) => a.endsAt > Date.now()).sort(byDayShiftBus);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete || conflict || !driver || !route) return;
    setSaving(true);
    setFormError(null);
    try {
      const saved = await storage.createAssignment({ driverUid: driver.uid, busId, routeId: route.id, serviceDate });
      toast({ title: `${driver.root ? 'owner admin · ' : ''}${driver.email} → bus ${saved.busId} on ${saved.serviceDate}` });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'assignment could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (assignment: Assignment) => {
    setRowError(null);
    try {
      await storage.deleteAssignment(assignment.driverUid, assignment.id);
      setRemovingId(null);
      toast({ title: `assignment removed: ${assignment.driverEmail} off bus ${assignment.busId} on ${assignment.serviceDate}` });
      await load();
    } catch (err) {
      setRowError({ id: assignment.id, message: err instanceof Error ? err.message : 'assignment could not be removed' });
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-muted-foreground">
          put a driver on another bus for one day and shift. the standing bus on the users tab keeps working; a dated assignment adds
          to it. trips still start from the driver's phone, never from this schedule.
        </p>
        <TileButton tone="outline" onClick={() => void load()} disabled={loading} className="min-h-12 px-4 py-2 text-base">
          <RefreshCw className={cn('h-5 w-5', loading && 'animate-spin')} strokeWidth={1.5} aria-hidden />
          <span>refresh</span>
        </TileButton>
      </div>

      <form onSubmit={save} className="flex flex-col gap-4 border-2 border-border/50 bg-card p-5" aria-label="new assignment">
        <h3 className="text-xl font-light">assign for a day</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="driver" value={driverUid} onChange={(e) => setDriverUid(e.target.value)} disabled={saving} required>
            <option value="">choose a driver</option>
            {drivers.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.root ? `owner admin · ${m.email}` : m.email}
                {m.assignedBusId ? ` (usual bus ${m.assignedBusId})` : ''}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="bus"
            value={busId}
            onChange={(e) => {
              setBusId(e.target.value);
              setRouteId('');
            }}
            disabled={saving}
            required
          >
            <option value="">choose an active bus</option>
            {activeBuses.map((b) => (
              <option key={b.busId} value={b.busId}>
                {b.busId}
                {b.label !== b.busId ? ` · ${b.label}` : ''}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="route (sets the shift)"
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            disabled={saving || !busId}
            required
            hint={busId && busRoutes.length === 0 ? 'this bus has no published route; publish one on the routes tab first.' : undefined}
          >
            <option value="">{busId ? 'choose a published route' : 'choose the bus first'}</option>
            {busRoutes.map((r) => (
              <option key={r.id} value={r.id}>
                {shiftLabel(r.shift)} · {r.origin} → {r.destination}
                {r.publishedVersion ? ` · v${r.publishedVersion}` : ''}
              </option>
            ))}
          </SelectField>
          <Field
            label="service date (IST)"
            type="date"
            value={serviceDate}
            min={today}
            onChange={(e) => setServiceDate(e.target.value)}
            disabled={saving}
            required
          />
        </div>
        {conflict && (
          <p role="alert" className="text-destructive">
            {conflict}
          </p>
        )}
        {formError && !conflict && (
          <p role="alert" className="text-destructive">
            {formError}
          </p>
        )}
        <TileButton type="submit" tone="blue" disabled={saving || !complete || Boolean(conflict)}>
          {saving ? 'saving...' : 'save assignment'}
        </TileButton>
      </form>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!loading && !error && upcoming.length === 0 && <p className="pt-4 text-muted-foreground">no assignments from today on.</p>}

      <ul className="flex flex-col pt-4" aria-label="upcoming assignments">
        {upcoming.map((a) => {
          const routeOf = routes.find((r) => r.id === a.routeId);
          const sourceMember = members.find((m) => m.uid === a.driverUid);
          const confirming = removingId === a.id;
          return (
            <li key={`${a.driverUid}/${a.id}`} className="flex flex-col gap-3 border-t-2 border-border/50 py-5 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <p className="text-xl font-light">
                   <span className="tabular-nums">{a.serviceDate}</span> · {shiftLabel(a.shift)} · bus {a.busId} · {sourceMember?.root ? 'owner admin · ' : ''}{a.driverEmail}
                </p>
                {!confirming && (
                  <TileButton tone="outline" onClick={() => setRemovingId(a.id)} className="min-h-12 px-4 py-2 text-base" aria-label={`remove ${a.id}`}>
                    remove
                  </TileButton>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {routeOf ? `${routeOf.origin} → ${routeOf.destination}` : 'route no longer listed'}
                {a.routeVersion ? ` · v${a.routeVersion} when assigned` : ''}
                {a.serviceDate === today ? ' · today' : ''}
              </p>
              {confirming && (
                <Tile tone="outline" className="flex flex-col gap-3 p-4" role="group" aria-label={`confirm remove ${a.id}`}>
                  <p>
                    {a.driverEmail} will only be able to start their usual bus on {a.serviceDate}. a trip already running under this
                    assignment keeps going until it ends.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <TileButton tone="red" onClick={() => void remove(a)} className="min-h-14 text-base">
                      yes, remove
                    </TileButton>
                    <TileButton tone="outline" onClick={() => setRemovingId(null)} className="min-h-14 text-base">
                      keep it
                    </TileButton>
                  </div>
                </Tile>
              )}
              {rowError?.id === a.id && (
                <p role="alert" className="text-destructive">
                  {rowError.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
