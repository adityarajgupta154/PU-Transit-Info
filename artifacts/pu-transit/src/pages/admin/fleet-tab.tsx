import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Pencil, RefreshCw, Square } from 'lucide-react';
import { canDrive } from '@workspace/driver-tracking';
import { Field, SelectField } from '@/components/metro/field';
import { Headline, Tile, TileButton } from '@/components/metro/tile';
import { StateTile } from '@/components/metro/state-tile';
import { useToast } from '@/hooks/use-toast';
import type { useFleetStatus } from '@/hooks/use-transit';
import { ApiError } from '@/lib/api';
import { storage, type Bus, type Member, type Route } from '@/lib/storage';
import { shiftLabel } from '@/lib/shifts';
import { stampFor } from '@/lib/tracking-state';

type Fleet = ReturnType<typeof useFleetStatus>;

export function FleetTab({
  fleet,
  routes,
  buses,
  members,
  actingMember = null,
  busesLoading,
  busesError,
  reloadBuses,
}: {
  fleet: Fleet;
  routes: Route[];
  buses: Bus[];
  members: Member[];
  actingMember?: Member | null;
  busesLoading: boolean;
  busesError: string | null;
  reloadBuses: () => Promise<void>;
}) {
  const entries = Object.entries(fleet.feeds)
    .filter(([, f]) => f.feed)
    .sort(([a], [b]) => a.localeCompare(b));
  // One live region for the whole fleet: it only changes when a bus changes state, never with the ages.
  const stateCounts = (['live', 'delayed', 'offline'] as const)
    .map((state) => [entries.filter(([, f]) => f.status === state).length, state] as const)
    .filter(([n]) => n > 0)
    .map(([n, state]) => `${n} ${state}`)
    .join(', ');

  return (
    <>
      <BusRegistry buses={buses} loading={busesLoading} error={busesError} reload={reloadBuses} />

      <Headline as="h2" size="section">
        live feed
      </Headline>
      <p className="sr-only" role="status">
        {stateCounts && `fleet: ${stateCounts}`}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted-foreground">
          {entries.length === 0 ? 'no bus has reported today.' : `${entries.length} ${entries.length === 1 ? 'bus has' : 'buses have'} reported today.`}
        </p>
        <TileButton tone="outline" onClick={fleet.refresh} className="min-h-12 px-4 py-2 text-base">
          <RefreshCw className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          <span>refresh</span>
        </TileButton>
      </div>
      {fleet.error && <p className="text-destructive">fleet feed unreachable — showing the last state. {fleet.error}</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {entries.map(([busId, aged]) => (
            <BusTile
            key={busId}
            busId={busId}
            aged={aged}
            route={routes.find((r) => r.busNumber === busId)}
            routes={routes}
            members={members}
              actingMember={actingMember}
            onChanged={fleet.refresh}
          />
        ))}
      </div>
    </>
  );
}

function BusRegistry({
  buses,
  loading,
  error,
  reload,
}: {
  buses: Bus[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [registration, setRegistration] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const addBus = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const bus = await storage.createBus({ registration, ...(label.trim() ? { label: label.trim() } : {}) });
      toast({ title: `bus ${bus.busId} added` });
      setRegistration('');
      setLabel('');
      await reload();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'BUS_EXISTS'
          ? err.message
          : err instanceof Error
            ? err.message
            : 'bus could not be added',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-5" aria-labelledby="bus-registry-heading">
      <Headline as="h2" size="section">
        <span id="bus-registry-heading">bus registry</span>
      </Headline>
      <form onSubmit={addBus} className="grid gap-4 border-2 border-border/50 p-5 sm:grid-cols-2">
        <Field
          label="registration"
          value={registration}
          onChange={(event) => setRegistration(event.target.value)}
          minLength={2}
          maxLength={64}
          required
          disabled={saving}
          placeholder="GJ 06 BX 1414"
        />
        <Field
          label="label (optional)"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={64}
          disabled={saving}
          placeholder="campus express"
        />
        {formError && (
          <p role="alert" className="text-destructive sm:col-span-2">
            {formError}
          </p>
        )}
        <TileButton tone="blue" type="submit" disabled={saving} className="min-h-12 text-base sm:col-span-2">
          {saving ? 'adding bus' : 'add bus'}
        </TileButton>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          bus registry could not load. {error}
        </p>
      )}
      {!loading && !error && buses.length === 0 && <p className="text-muted-foreground">no buses registered yet.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {buses.map((bus) => (
          <RegistryBus key={bus.busId} bus={bus} reload={reload} />
        ))}
      </div>
    </section>
  );
}

function RegistryBus({ bus, reload }: { bus: Bus; reload: () => Promise<void> }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const [focusEdit, setFocusEdit] = useState(false);

  useEffect(() => {
    if (focusEdit && !busy) {
      editButton.current?.focus();
      setFocusEdit(false);
    }
  }, [focusEdit, busy]);

  const closeLabelEditor = () => {
    setLabelDraft(null);
    setError(null);
    setFocusEdit(true);
  };

  const saveLabel = async (event: React.FormEvent) => {
    event.preventDefault();
    const label = labelDraft?.trim() ?? '';
    if (busy || !label || label.length > 64 || label === bus.label) return;
    setBusy(true);
    setError(null);
    try {
      await storage.updateBus(bus.busId, { label });
      await reload();
      toast({ title: `label for ${bus.busId} updated` });
      closeLabelEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bus label could not be changed');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (status: Bus['status']) => {
    setBusy(true);
    setError(null);
    try {
      await storage.updateBus(bus.busId, {
        status,
        ...(status === 'out_of_service' ? { reason: reason.trim() } : {}),
      });
      toast({ title: status === 'active' ? `${bus.busId} is back in service` : `${bus.busId} is out of service` });
      setConfirming(false);
      setReason('');
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'BUS_ACTIVE_TRIP'
          ? err.message
          : err instanceof Error
            ? err.message
            : 'bus status could not be changed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tile tone="outline" className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Headline as="h3" size="row" clip className="normal-case">
            {bus.busId}
          </Headline>
          <p className="break-words text-muted-foreground">{bus.label}</p>
        </div>
        <span className={bus.status === 'active' ? 'bg-primary px-2 py-1 text-sm text-primary-foreground' : 'bg-destructive px-2 py-1 text-sm text-white'}>
          {bus.status === 'active' ? 'active' : 'out of service'}
        </span>
      </div>
      {bus.status === 'out_of_service' && bus.reason && <p>{bus.reason}</p>}
      {labelDraft === null && !confirming && (
        <TileButton
          ref={editButton}
          tone="outline"
          aria-label={`edit label for ${bus.busId}`}
          onClick={() => {
            setLabelDraft(bus.label);
            setError(null);
          }}
          disabled={busy}
          className="min-h-12 text-base"
        >
          <span>edit label</span>
          <Pencil className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </TileButton>
      )}
      {labelDraft !== null && (
        <form
          onSubmit={saveLabel}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault();
              closeLabelEditor();
            }
          }}
          aria-label={`edit label for ${bus.busId}`}
          className="flex flex-col gap-3"
        >
          <Field
            label="bus label"
            hint="1–64 characters. the bus ID stays the same."
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            minLength={1}
            maxLength={64}
            required
            autoFocus
            disabled={busy}
          />
          <div className="grid grid-cols-2 gap-2">
            <TileButton
              tone="blue"
              type="submit"
              disabled={busy || !labelDraft.trim() || labelDraft.trim() === bus.label}
              className="min-h-12 text-base"
            >
              {busy ? 'saving label' : 'save label'}
            </TileButton>
            <TileButton tone="outline" onClick={closeLabelEditor} disabled={busy} className="min-h-12 text-base">
              cancel
            </TileButton>
          </div>
        </form>
      )}
      {bus.status === 'active' && !confirming && labelDraft === null && (
        <TileButton tone="outline" onClick={() => setConfirming(true)} disabled={busy} className="min-h-12 text-base">
          mark out of service
        </TileButton>
      )}
      {bus.status === 'active' && confirming && (
        <div className="flex flex-col gap-3">
          <Field
            label="reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 200))}
            maxLength={200}
            disabled={busy}
            placeholder="scheduled maintenance"
          />
          <div className="grid grid-cols-2 gap-2">
            <TileButton tone="red" onClick={() => void updateStatus('out_of_service')} disabled={busy} className="min-h-12 text-base">
              {busy ? 'saving' : 'confirm'}
            </TileButton>
            <TileButton tone="outline" onClick={() => setConfirming(false)} disabled={busy} className="min-h-12 text-base">
              cancel
            </TileButton>
          </div>
        </div>
      )}
      {bus.status === 'out_of_service' && labelDraft === null && (
        <TileButton tone="blue" onClick={() => void updateStatus('active')} disabled={busy} className="min-h-12 text-base">
          {busy ? 'saving' : 'back in service'}
        </TileButton>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </Tile>
  );
}

function BusTile({
  busId,
  aged,
  route,
  routes,
  members,
  actingMember,
  onChanged,
}: {
  busId: string;
  aged: Fleet['feeds'][string];
  route: Route | undefined;
  routes: Route[];
  members: Member[];
  actingMember?: Member | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<'end' | 'handover' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feed = aged.feed;
  if (!feed) return null;
  const active = feed.phase === 'active';

  const forceEnd = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await storage.forceEndTracking(busId, reason.trim() || undefined);
      toast({
        title: result.outcome === 'ended' ? `bus ${busId} ended` : `bus ${busId} had already ended`,
        description: result.auditId ? 'the change is in the audit log.' : 'nothing changed, so no audit entry was written.',
      });
      setConfirming(null);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'force end failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tile tone="outline" className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Headline as="h3" size="row" clip className="normal-case">
            {busId}
          </Headline>
          <p className="text-muted-foreground">
            {route ? `${shiftLabel(route.shift)} · ${route.origin} → ${route.destination}` : 'no route saved for this bus'}
          </p>
        </div>
      </div>
      <StateTile status={aged.status} feed={feed} receivedAt={aged.receivedAt} compact />
      <p className="text-muted-foreground">
        {stampFor(aged.status).hint}
        <span className="tabular-nums"> · gps {feed.gpsQuality.replace('_', ' ')}</span>
      </p>

      {active && !confirming && (
        <div className="grid grid-cols-2 gap-2">
          <TileButton tone="outline" onClick={() => setConfirming('end')} className="min-h-12 px-4 py-2 text-base">
            <Square className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            <span>end trip from office</span>
          </TileButton>
          <TileButton tone="outline" onClick={() => setConfirming('handover')} className="min-h-12 px-4 py-2 text-base">
            <ArrowRightLeft className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            <span>hand over</span>
          </TileButton>
        </div>
      )}
      {active && confirming === 'handover' && (
        <HandoverForm
          busId={busId}
          routes={routes}
          members={members}
          actingMember={actingMember}
          onDone={() => {
            setConfirming(null);
            onChanged();
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {active && confirming === 'end' && (
        <div className="flex flex-col gap-3" role="group" aria-label={`confirm ending bus ${busId}`}>
          <p>
            the driver's phone will stop publishing and riders see “ended”. the driver can start a new trip afterwards. this is
            written to the audit log with your name.
          </p>
          <Field
            label="reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            placeholder="driver forgot to end the trip"
          />
          <div className="grid grid-cols-2 gap-2">
            <TileButton tone="red" onClick={() => void forceEnd()} disabled={busy} className="min-h-14 text-base">
              {busy ? 'ending' : `yes, end ${busId}`}
            </TileButton>
            <TileButton tone="outline" onClick={() => setConfirming(null)} disabled={busy} className="min-h-14 text-base">
              cancel
            </TileButton>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </Tile>
  );
}

// ADM-10: one confirmed action ends the current trip and lets the named driver start at once.
// A driver whose usual bus is another one gets a dated assignment for today, so a route of this
// bus (its shift) must be chosen for them; the API refuses conflicts by name before anything changes.
export function HandoverForm({
  busId,
  routes,
  members,
  actingMember = null,
  onDone,
  onCancel,
}: {
  busId: string;
  routes: Route[];
  members: Member[];
  actingMember?: Member | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [driverUid, setDriverUid] = useState('');
  const [routeId, setRouteId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drivers = members
    .filter((m) => canDrive(m) && (!m.root || actingMember?.root === true) && m.status === 'approved' && m.active)
    .sort((a, b) => a.email.localeCompare(b.email));
  const busRoutes = routes.filter((r) => r.busNumber === busId && r.status !== 'draft' && r.status !== 'archived');
  const driver = drivers.find((m) => m.uid === driverUid) ?? null;
  const needsRoute = !!driver && driver.assignedBusId !== busId;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driver) return;
    setBusy(true);
    setError(null);
    try {
      const result = await storage.handoverTracking(busId, {
        nextDriverUid: driver.uid,
        ...(needsRoute ? { routeId } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      const driverLabel = driver.root ? `owner admin · ${driver.email}` : driver.email;
      toast({
        title: `bus ${busId} handed to ${driverLabel}`,
        description: `${result.outcome === 'ended' ? 'the previous phone stops on its next upload' : 'the trip had already ended'}; ${driverLabel} can start now${result.assignment ? ` (assigned for today, ${result.assignment.shift.toLowerCase()})` : ''}.`,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'handover failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={`hand over bus ${busId}`}>
      <p>
        the current trip ends, the driver's phone stops publishing, and the driver you pick can start {busId} right away. one audit
        entry names both drivers and you.
      </p>
      <SelectField label="next driver" value={driverUid} onChange={(e) => setDriverUid(e.target.value)} disabled={busy} required>
        <option value="">choose a driver</option>
        {drivers.map((m) => (
          <option key={m.uid} value={m.uid}>
            {m.root ? `owner admin · ${m.email}` : m.email}
            {m.assignedBusId ? ` (usual bus ${m.assignedBusId})` : ''}
          </option>
        ))}
      </SelectField>
      {needsRoute && (
        <SelectField label={`route of ${busId} for today (sets the shift)`} value={routeId} onChange={(e) => setRouteId(e.target.value)} disabled={busy} required>
          <option value="">choose a route</option>
          {busRoutes.map((r) => (
            <option key={r.id} value={r.id}>
              {shiftLabel(r.shift)} · {r.origin} → {r.destination}
            </option>
          ))}
        </SelectField>
      )}
      {needsRoute && busRoutes.length === 0 && (
        <p className="text-destructive">{busId} has no published route, so {driver?.email} cannot be assigned to it today.</p>
      )}
      <Field label="reason (optional)" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} placeholder="driver taken ill" />
      <div className="grid grid-cols-2 gap-2">
        <TileButton type="submit" tone="red" disabled={busy || !driver || (needsRoute && !routeId)} className="min-h-14 text-base">
          {busy ? 'handing over' : driver ? `yes, hand ${busId} to ${driver.email.split('@')[0]}` : 'hand over'}
        </TileButton>
        <TileButton tone="outline" onClick={onCancel} disabled={busy} className="min-h-14 text-base">
          cancel
        </TileButton>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
