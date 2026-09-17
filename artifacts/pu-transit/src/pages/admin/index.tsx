import { useEffect, useState } from 'react';
import { Headline } from '@/components/metro/tile';
import { Pivot } from '@/components/metro/pivot';
import { confirmLeave } from '@/hooks/use-unsaved-changes';
import { useFleetStatus, useRoutes } from '@/hooks/use-transit';
import { useAuth } from '@/contexts/auth-context';
import { storage, type Bus, type Member } from '@/lib/storage';
import { FleetTab } from './fleet-tab';
import { RoutesTab } from './routes-tab';
import { UsersTab } from './users-tab';
import { AssignmentsTab } from './assignments-tab';
import { NoticesTab } from './notices-tab';
import { CalendarTab } from './calendar-tab';
import { SystemTab } from './system-tab';

const TABS = [
  { value: 'fleet', label: 'fleet' },
  { value: 'routes', label: 'routes' },
  { value: 'users', label: 'users' },
  { value: 'assignments', label: 'assignments' },
  { value: 'notices', label: 'notices' },
  { value: 'calendar', label: 'calendar' },
  { value: 'system', label: 'system' },
] as const;
type TabId = (typeof TABS)[number]['value'];

export default function Admin() {
  const [tab, setTab] = useState<TabId>('fleet');
  const { membership: actingMember } = useAuth();
  const { routes, refresh: refreshRoutes, error: routesError } = useRoutes();
  const fleet = useFleetStatus();
  const [members, setMembers] = useState<Member[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(true);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [busesError, setBusesError] = useState<string | null>(null);
  const [busesLoading, setBusesLoading] = useState(true);

  const loadMembers = async () => {
    setMembersLoading(true);
    setMembersError(null);
    try {
      setMembers((await storage.getMemberships()) ?? []);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'memberships could not load');
    } finally {
      setMembersLoading(false);
    }
  };

  const loadBuses = async () => {
    setBusesLoading(true);
    setBusesError(null);
    try {
      setBuses((await storage.getBuses()) ?? []);
    } catch (err) {
      setBusesError(err instanceof Error ? err.message : 'buses could not load');
    } finally {
      setBusesLoading(false);
    }
  };

  useEffect(() => {
    void loadMembers();
    void loadBuses();
  }, []);

  const liveCount = Object.values(fleet.feeds).filter((f) => f.feed?.phase === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;
  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-8 px-5 py-6 md:px-8 md:py-12 lg:px-12">
      <Headline>transport office</Headline>
      <Pivot
        label="admin sections"
        items={TABS.map((t) => ({
          ...t,
          count:
            t.value === 'fleet' ? liveCount : t.value === 'users' ? pendingCount : t.value === 'routes' ? routes.length : undefined,
        }))}
        value={tab}
        onChange={(value) => (value === tab || confirmLeave()) && setTab(value as TabId)} // RTE-04: a dirty route form asks before another tab unmounts it
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`pivot-${tab}`} className="flex flex-col gap-6">
        {tab === 'fleet' && (
          <FleetTab fleet={fleet} routes={routes} buses={buses} members={members} actingMember={actingMember} busesLoading={busesLoading} busesError={busesError} reloadBuses={loadBuses} />
        )}
        {tab === 'routes' && (
          <RoutesTab
            routes={routes}
            routesError={routesError}
            refreshRoutes={refreshRoutes}
            fleetFeeds={fleet.feeds}
            buses={buses}
            busesLoading={busesLoading}
            busesError={busesError}
          />
        )}
        {tab === 'users' && (
          <UsersTab
            members={members}
            loading={membersLoading}
            error={membersError}
            reload={loadMembers}
            buses={buses}
            actingMember={actingMember}
          />
        )}
        {tab === 'assignments' && <AssignmentsTab members={members} buses={buses} routes={routes} actingMember={actingMember} />}
        {tab === 'notices' && <NoticesTab routes={routes} />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'system' && <SystemTab refreshRoutes={refreshRoutes} />}
      </div>
    </div>
  );
}
