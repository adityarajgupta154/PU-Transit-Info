import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { accessThroughLabel, canDrive, membershipExpired } from '@workspace/driver-tracking';
import { Field, SelectField } from '@/components/metro/field';
import { TileButton } from '@/components/metro/tile';
import { useToast } from '@/hooks/use-toast';
import { storage, type Bus, type Member } from '@/lib/storage';
import { cn } from '@/lib/utils';

type Update = Partial<Pick<Member, 'role' | 'status' | 'active' | 'assignedBusId' | 'expiresAt'>> & { requestedRole?: null };

const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;
/** IST calendar date of an instant, as the date input wants it. */
export const istDate = (ms: number): string => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
/** "Access until <date>" means through the end of that IST day: the expiry is the following IST midnight. */
export const endOfIstDay = (date: string): number => Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS + DAY_MS;

/** IDN-01: set, extend or clear the access end. Nothing is written until the admin presses set. */
export function ExpiryField({
  member,
  busy,
  onSave,
  readOnly = false,
}: {
  member: Member;
  busy: boolean;
  onSave: (expiresAt: number | null, done: string) => void;
  readOnly?: boolean;
}) {
  const through = member.expiresAt === null ? '' : istDate(member.expiresAt - 1);
  const [value, setValue] = useState(through);
  useEffect(() => setValue(through), [through]);
  const hint =
    member.expiresAt === null ? 'no end date' : membershipExpired(member) ? `expired — was valid through ${accessThroughLabel(member.expiresAt)}` : `valid through ${accessThroughLabel(member.expiresAt)}`;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field type="date" label="access until" value={value} min={istDate(Date.now())} disabled={busy || readOnly} onChange={(e) => setValue(e.target.value)} hint={hint} className="w-56 flex-none" />
      <TileButton tone="blue" disabled={busy || readOnly || !value || value === through} onClick={() => onSave(endOfIstDay(value), `access until ${value}`)} className="min-h-12 px-4 py-2 text-base">
        set
      </TileButton>
      {member.expiresAt !== null && (
        <TileButton tone="outline" disabled={busy || readOnly} onClick={() => onSave(null, 'no end date')} className="min-h-12 px-4 py-2 text-base">
          clear
        </TileButton>
      )}
    </div>
  );
}

const STATUS_WORD: Record<Member['status'], string> = {
  pending: 'waiting for approval',
  approved: 'approved',
  rejected: 'rejected',
  suspended: 'suspended',
};

export function UsersTab({
  members,
  loading,
  error,
  reload,
  buses,
  actingMember = null,
}: {
  members: Member[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  buses: Bus[];
  actingMember?: Member | null;
}) {
  const { toast } = useToast();
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ uid: string; message: string } | null>(null);
  // A bus pick that collides with another active driver waits here until the admin decides.
  const [pendingBus, setPendingBus] = useState<{ uid: string; busId: string; other: Member; updates?: Update; doneMsg?: string } | null>(null);
  const [requestBusId, setRequestBusId] = useState<Record<string, string>>({});

  // A fresh members snapshot (refresh, or the reload after any change) voids an open decision.
  useEffect(() => setPendingBus(null), [members]);

  const activeDriverOn = (busId: string, exceptUid: string) =>
    busId ? members.find((m) => m.uid !== exceptUid && canDrive(m) && m.active && m.assignedBusId === busId) : undefined;

  const confirmPending = (uid: string) => {
    const p = pendingBus;
    setPendingBus(null);
    if (!p || p.uid !== uid) return;
    const current = members.find((m) => m.uid === uid);
    if (!current) return;

    if (p.updates) {
      void update(current, p.updates, p.doneMsg || 'approved');
    } else {
      if (!canDrive(current)) return;
      void update(current, { assignedBusId: p.busId }, p.busId ? `drives ${p.busId}` : 'no bus');
    }
  };

  const assignBus = (uid: string, busId: string) => {
    setPendingBus(null);
    const current = members.find((m) => m.uid === uid);
    if (!current || !canDrive(current)) return;
    void update(current, { assignedBusId: busId }, busId ? `drives ${busId}` : 'no bus');
  };

  const update = async (member: Member, changes: Update, done: string) => {
    setBusyUid(member.uid);
    setRowError(null);
    setPendingBus(null); // any other change makes an open bus decision stale
    try {
      await storage.updateMembership(member.uid, changes);
      toast({ title: `${member.email}: ${done}` });
      await reload();
    } catch (err) {
      setRowError({ uid: member.uid, message: err instanceof Error ? err.message : 'update failed' });
    } finally {
      setBusyUid(null);
    }
  };

  const ordered = [...members].sort((a, b) => {
    const rank = (m: Member) => (m.status === 'pending' ? 0 : m.status === 'approved' ? 1 : 2);
    return rank(a) - rank(b) || a.email.localeCompare(b.email);
  });
  const activeBuses = buses.filter((bus) => bus.status === 'active');
  const busLabel = (bus: Bus) => (bus.label && bus.label !== bus.busId ? `${bus.busId} — ${bus.label}` : bus.busId);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted-foreground">
          {members.length} {members.length === 1 ? 'account' : 'accounts'} · approve requests, set roles, put drivers on buses.
        </p>
        <TileButton tone="outline" onClick={() => void reload()} disabled={loading} className="min-h-12 px-4 py-2 text-base">
          <RefreshCw className={cn('h-5 w-5', loading && 'animate-spin')} strokeWidth={1.5} aria-hidden />
          <span>refresh</span>
        </TileButton>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          accounts could not load. {error}
        </p>
      )}
      {!loading && !error && members.length === 0 && <p className="text-muted-foreground">nobody has requested access yet.</p>}

      <ul className="flex flex-col">
        {ordered.map((member) => {
          const busy = busyUid === member.uid;
          const otherDriver = canDrive(member) ? activeDriverOn(member.assignedBusId, member.uid) : undefined;
          const pending = pendingBus?.uid === member.uid ? pendingBus : null;
          const currentBus = buses.find((bus) => bus.busId === member.assignedBusId);
          const currentIsActive = activeBuses.some((bus) => bus.busId === member.assignedBusId);
          const isUni = member.email.endsWith('@paruluniversity.ac.in');
          const ownerSelf = member.root && actingMember?.root === true && actingMember.uid === member.uid;
          return (
            <li key={member.uid} className="flex flex-col gap-4 border-t-2 border-border/50 py-5 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="text-2xl font-light">
                  {member.email.split('@')[0]}
                  <span className="break-all text-base text-muted-foreground">@{member.email.split('@')[1]}</span>
                  {member.root && <span className="ml-3 text-base font-medium text-primary">Root admin</span>}
                </p>
                <p
                  className={cn(
                    'px-2 py-0.5 text-sm',
                    member.status === 'approved' && member.active ? 'bg-primary text-primary-foreground' : 'border-2 border-foreground text-foreground',
                    (member.status === 'rejected' || member.status === 'suspended' || (member.status === 'approved' && !member.active) || membershipExpired(member)) &&
                      'bg-destructive border-0 text-white',
                    member.root && 'hidden'
                  )}
                >
                  {membershipExpired(member) ? 'expired' : member.status === 'approved' && !member.active ? 'inactive' : STATUS_WORD[member.status]}
                </p>
              </div>

              {member.root && (
                <div className="flex flex-col gap-3 border-2 border-primary/40 bg-primary/5 p-4">
                  <p className="text-lg">
                    owner admin · stored role <span className="font-medium">admin</span>. role, status, and access end are protected.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <SelectField label="role" value="admin" disabled onChange={() => undefined}>
                      <option value="admin">admin</option>
                    </SelectField>
                    <SelectField label="status" value={member.status} disabled onChange={() => undefined}>
                      <option value={member.status}>{STATUS_WORD[member.status]}</option>
                    </SelectField>
                    <ExpiryField member={member} busy={busy} readOnly onSave={() => undefined} />
                  </div>
                  {ownerSelf ? (
                    <SelectField
                      label="owner standing bus"
                      value={pending ? pending.busId : member.assignedBusId}
                      disabled={busy}
                      onChange={(e) => {
                        const busId = e.target.value;
                        const other = activeDriverOn(busId, member.uid);
                        if (other) setPendingBus({ uid: member.uid, busId, other });
                        else assignBus(member.uid, busId);
                      }}
                      hint="Only the owner can change this bus. The stored admin role is unchanged."
                    >
                      <option value="">no bus</option>
                      {!currentIsActive && member.assignedBusId && (
                        <option value={member.assignedBusId}>
                          {currentBus ? busLabel(currentBus) : member.assignedBusId} {currentBus ? '(out of service)' : '(not in registry)'}
                        </option>
                      )}
                      {activeBuses.map((bus) => (
                        <option key={bus.busId} value={bus.busId}>
                          {busLabel(bus)}
                        </option>
                      ))}
                    </SelectField>
                  ) : (
                    <p className="text-muted-foreground">protected owner settings can only be changed by the owner account.</p>
                  )}
                </div>
              )}

              {!member.root && (
                <>
                  {member.requestedRole && (
                    <div className="flex flex-col gap-3 border-2 border-border/50 p-4">
                      <p className="text-lg">
                        requested role: <span className="font-medium text-primary">{member.requestedRole}</span>
                        {!isUni && <span className="ml-2 text-sm font-medium text-destructive">(requires university email)</span>}
                      </p>

                      {member.requestedRole === 'driver' && isUni && (
                        <SelectField
                          label="assign bus for approval"
                          value={requestBusId[member.uid] || ''}
                          disabled={busy}
                          onChange={(e) => setRequestBusId({ ...requestBusId, [member.uid]: e.target.value })}
                        >
                          <option value="">choose a bus...</option>
                          {activeBuses.map((bus) => (
                            <option key={bus.busId} value={bus.busId}>
                              {busLabel(bus)}
                            </option>
                          ))}
                        </SelectField>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <TileButton
                          tone="blue"
                          disabled={busy || !isUni || (member.requestedRole === 'driver' && !requestBusId[member.uid])}
                          onClick={() => {
                            const updates: Update = { role: member.requestedRole!, requestedRole: null, status: 'approved', active: true };
                            if (member.requestedRole === 'driver') {
                              const busId = requestBusId[member.uid];
                              const other = activeDriverOn(busId, member.uid);
                              updates.assignedBusId = busId;
                              if (other) {
                                setPendingBus({ uid: member.uid, busId, other, updates, doneMsg: `approved as ${member.requestedRole}` });
                                return;
                              }
                            }
                            void update(member, updates, `approved as ${member.requestedRole}`);
                          }}
                          className="min-h-12 px-4 py-2 text-base"
                        >
                          approve as {member.requestedRole}
                        </TileButton>
                        <TileButton
                          tone="outline"
                          disabled={busy}
                          onClick={() => void update(member, { requestedRole: null }, 'dismissed request')}
                          className="min-h-12 px-4 py-2 text-base"
                        >
                          dismiss request
                        </TileButton>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[12rem_16rem_1fr] lg:items-end">
                    <SelectField
                      label="role"
                      value={member.role}
                      disabled={busy}
                      onChange={(e) => {
                        const role = e.target.value as Member['role'];
                        void update(member, { role, assignedBusId: role === 'driver' ? member.assignedBusId : '' }, `now a ${role}`);
                      }}
                    >
                      <option value="student">student</option>
                      <option value="staff" disabled={!isUni}>staff</option>
                      <option value="driver" disabled={!isUni}>driver</option>
                      <option value="admin" disabled={!isUni}>admin</option>
                    </SelectField>

                    {member.role === 'driver' ? (
                      <SelectField
                        label="bus"
                        value={pending ? pending.busId : member.assignedBusId}
                        disabled={busy}
                        onChange={(e) => {
                          const busId = e.target.value;
                          const other = activeDriverOn(busId, member.uid);
                          if (other) setPendingBus({ uid: member.uid, busId, other });
                          else assignBus(member.uid, busId);
                        }}
                        hint={
                          pending
                            ? undefined
                            : otherDriver
                                ? `${otherDriver.root ? 'owner admin · ' : ''}${otherDriver.email} is also on ${member.assignedBusId} — two phones will fight over one bus.`
                              : activeBuses.length === 0
                                ? 'add an active bus to the registry under Fleet.'
                                : undefined
                        }
                      >
                        <option value="">no bus</option>
                        {!currentIsActive && member.assignedBusId && (
                          <option value={member.assignedBusId}>
                            {currentBus ? busLabel(currentBus) : member.assignedBusId} {currentBus ? '(out of service)' : '(not in registry)'}
                          </option>
                        )}
                        {activeBuses.map((bus) => (
                          <option key={bus.busId} value={bus.busId}>
                            {busLabel(bus)}
                          </option>
                        ))}
                      </SelectField>
                    ) : (
                      <div className="hidden lg:block" aria-hidden />
                    )}

                    <div className="flex flex-wrap gap-2">
                      {member.status === 'pending' && (
                        <>
                          <TileButton tone="blue" disabled={busy} onClick={() => void update(member, { status: 'approved', active: true }, 'approved')} className="min-h-12 px-4 py-2 text-base">
                            approve
                          </TileButton>
                          <TileButton tone="outline" disabled={busy} onClick={() => void update(member, { status: 'rejected' }, 'rejected')} className="min-h-12 px-4 py-2 text-base">
                            reject
                          </TileButton>
                        </>
                      )}
                      {member.status === 'approved' && member.active && (
                        <TileButton tone="outline" disabled={busy} onClick={() => void update(member, { status: 'suspended', active: false }, 'suspended')} className="min-h-12 px-4 py-2 text-base">
                          suspend
                        </TileButton>
                      )}
                      {(member.status === 'suspended' || (member.status === 'approved' && !member.active)) && (
                        <TileButton tone="blue" disabled={busy} onClick={() => void update(member, { status: 'approved', active: true }, 'reactivated')} className="min-h-12 px-4 py-2 text-base">
                          reactivate
                        </TileButton>
                      )}
                      {member.status === 'rejected' && (
                        <TileButton tone="outline" disabled={busy} onClick={() => void update(member, { status: 'approved', active: true }, 'approved')} className="min-h-12 px-4 py-2 text-base">
                          approve after all
                        </TileButton>
                      )}
                    </div>
                  </div>

                  {member.status === 'approved' && (
                    <ExpiryField member={member} busy={busy} onSave={(expiresAt, done) => void update(member, { expiresAt }, done)} />
                  )}
                </>
              )}
              {pending && (
                <div role="alertdialog" aria-label="bus already has a driver" className="flex flex-col gap-3 bg-destructive px-5 py-4 text-white">
                  <p className="text-xl">
                    {pending.other.email} already drives {pending.busId}. two phones on one bus fight over it — riders see the position jump.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <TileButton tone="white" disabled={busy} onClick={() => confirmPending(member.uid)} className="min-h-12 px-4 py-2 text-base">
                      put both on {pending.busId}
                    </TileButton>
                    <TileButton tone="ground" disabled={busy} onClick={() => setPendingBus(null)} className="min-h-12 px-4 py-2 text-base">
                      keep {member.assignedBusId || 'no bus'}
                    </TileButton>
                  </div>
                </div>
              )}
              {rowError?.uid === member.uid && (
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
