// FLT-01 migration planner: pure function from a snapshot of the API's data to
// a plan + Markdown report. No I/O here; buses-migrate.ts feeds it and applies it.
import type { Bus, LiveTrackingFeed, Member, Route } from '@workspace/api-client-react';

export const BUS_KEY = /^[A-Z0-9]{2,20}$/; // same rule as the API busKey, web normalizeBusNumber, Rules
export const busKey = (raw: string): string | null => {
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return BUS_KEY.test(key) ? key : null;
};

export type Snapshot = {
  routes: Route[];
  members: Pick<Member, 'uid' | 'email' | 'role' | 'assignedBusId'>[];
  feeds: Record<string, Pick<LiveTrackingFeed, 'phase' | 'status'>>;
  buses: Bus[] | null; // null = registry unreadable (Rules not published yet)
};

export type Issue = { level: 'block' | 'note'; kind: string; detail: string };
export type Plan = {
  registry: { busId: string; label: string; raws: string[]; routes: number; drivers: number; existing: Bus | null }[];
  routeRewrites: { route: Route & { status: 'draft' | 'published' }; to: string }[];
  memberRewrites: { uid: string; email: string; from: string; to: string }[];
  issues: Issue[];
};

const isLive = (feed?: Pick<LiveTrackingFeed, 'phase' | 'status'>): boolean =>
  !!feed && feed.phase === 'active' && feed.status !== 'offline';

export function planMigration(snapshot: Snapshot): Plan {
  const issues: Issue[] = [];
  const byKey = new Map<string, { raws: Map<string, number>; routes: number; drivers: number }>();
  const refer = (raw: string, source: 'routes' | 'drivers'): string | null => {
    const key = busKey(raw);
    if (!key) return null;
    const entry = byKey.get(key) ?? { raws: new Map(), routes: 0, drivers: 0 };
    entry.raws.set(raw.trim(), (entry.raws.get(raw.trim()) ?? 0) + 1);
    entry[source] += 1;
    byKey.set(key, entry);
    return key;
  };

  if (snapshot.buses === null) {
    issues.push({
      level: 'block',
      kind: 'registry_unreadable',
      detail: 'GET /api/buses failed: publish the bus-registry Rules first, then run the report again.',
    });
  }
  const existing = new Map((snapshot.buses ?? []).map((bus) => [bus.busId, bus]));

  const routeRewrites: Plan['routeRewrites'] = [];
  for (const route of snapshot.routes) {
    const key = refer(route.busNumber, 'routes');
    if (!key) {
      issues.push({
        level: 'block',
        kind: 'invalid',
        detail: `route ${route.id} (${route.origin} → ${route.destination}) has bus "${route.busNumber}", which does not normalize to 2–20 letters/digits; fix it in Routes first.`,
      });
      continue;
    }
    if (key === route.busNumber) continue;
    if (route.status === 'archived') {
      // Hidden from riders and not accepted by POST /routes; publishing it again checks the bus anyway.
      issues.push({ level: 'note', kind: 'archived', detail: `route ${route.id} is archived and keeps bus "${route.busNumber}"; fix the number if it is ever published again.` });
      continue;
    }
    routeRewrites.push({ route: { ...route, status: route.status }, to: key });
    if (route.hasDraft) {
      // The admin list merges the pending draft over the node; rewriting through POST /routes would publish it.
      issues.push({
        level: 'block',
        kind: 'draft',
        detail: `route ${route.id} has an unpublished draft; publish or discard it in Routes first, or the rewrite would publish the draft.`,
      });
    }
    for (const id of [route.busNumber, key]) {
      if (isLive(snapshot.feeds[id])) {
        issues.push({
          level: 'block',
          kind: 'active_trip',
          detail: `bus ${id} has a live trip; route ${route.id} cannot be rewritten until it ends.`,
        });
      }
    }
  }

  const memberRewrites: Plan['memberRewrites'] = [];
  const routeKeys = new Set(snapshot.routes.map((route) => busKey(route.busNumber)).filter(Boolean));
  for (const member of snapshot.members) {
    if (!member.assignedBusId) continue;
    const key = refer(member.assignedBusId, 'drivers');
    if (!key) {
      issues.push({
        level: 'block',
        kind: 'invalid',
        detail: `${member.email} is assigned bus "${member.assignedBusId}", which does not normalize to 2–20 letters/digits; reassign under Users first.`,
      });
      continue;
    }
    if (!routeKeys.has(key)) {
      issues.push({ level: 'note', kind: 'orphan_assignment', detail: `${member.email} is assigned ${key}, which no route serves.` });
    }
    if (key === member.assignedBusId) continue;
    memberRewrites.push({ uid: member.uid, email: member.email, from: member.assignedBusId, to: key });
    for (const id of [member.assignedBusId, key]) {
      if (isLive(snapshot.feeds[id])) {
        issues.push({
          level: 'block',
          kind: 'active_trip',
          detail: `bus ${id} has a live trip; ${member.email}'s assignment cannot move from "${member.assignedBusId}" to ${key} until it ends.`,
        });
      }
    }
  }

  const registry: Plan['registry'] = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([busId, entry]) => {
      const raws = [...entry.raws.entries()].sort((a, b) => b[1] - a[1]).map(([raw]) => raw);
      const current = existing.get(busId) ?? null;
      if (raws.length > 1) {
        issues.push({ level: 'note', kind: 'merge', detail: `${busId} merges ${raws.map((raw) => `"${raw}"`).join(', ')}; label "${current?.label ?? raws[0].slice(0, 64)}".` });
      }
      if (current) {
        issues.push({ level: 'note', kind: 'existing', detail: `${busId} is already registered as "${current.label}" (${current.status}); kept as is.` });
      }
      return { busId, label: current?.label ?? raws[0].slice(0, 64), raws, routes: entry.routes, drivers: entry.drivers, existing: current };
    });

  for (const [id, feed] of Object.entries(snapshot.feeds)) {
    if (busKey(id) !== id && feed.phase !== 'not_started') {
      issues.push({ level: 'note', kind: 'tracking_history', detail: `tracking history stays under the old id ${id} (last phase ${feed.phase}); admins cannot move tracking nodes.` });
    }
  }

  return { registry, routeRewrites, memberRewrites, issues };
}

export function renderReport(plan: Plan): string {
  const blocking = plan.issues.filter((issue) => issue.level === 'block');
  const notes = plan.issues.filter((issue) => issue.level === 'note');
  const creates = plan.registry.filter((entry) => !entry.existing);
  const lines = [
    '# Bus registry migration report',
    '',
    `- buses referenced: ${plan.registry.length} (${creates.length} to register, ${plan.registry.length - creates.length} already registered)`,
    `- routes to rewrite: ${plan.routeRewrites.length}`,
    `- driver assignments to rewrite: ${plan.memberRewrites.length}`,
    `- blocking issues: ${blocking.length}`,
    '',
    blocking.length ? '**Nothing can be applied until the blocking issues are fixed.**' : '**No blocking issues; `--apply` is allowed.**',
    '',
    '## Registry',
    '',
    '| key | label | written as | routes | drivers | state |',
    '|---|---|---|---|---|---|',
    ...plan.registry.map((entry) =>
      `| ${entry.busId} | ${entry.label} | ${entry.raws.map((raw) => `"${raw}"`).join(', ')} | ${entry.routes} | ${entry.drivers} | ${entry.existing ? `exists (${entry.existing.status})` : 'new'} |`),
    '',
    '## Blocking',
    '',
    ...(blocking.length ? blocking.map((issue) => `- [${issue.kind}] ${issue.detail}`) : ['- none']),
    '',
    '## Notes',
    '',
    ...(notes.length ? notes.map((issue) => `- [${issue.kind}] ${issue.detail}`) : ['- none']),
    '',
    '## Planned rewrites',
    '',
    ...(plan.routeRewrites.length
      ? ['| route | from | to |', '|---|---|---|', ...plan.routeRewrites.map(({ route, to }) => `| ${route.origin} → ${route.destination} (${route.shift}) | "${route.busNumber}" | ${to} |`)]
      : ['- routes: none']),
    '',
    ...(plan.memberRewrites.length
      ? ['| driver | from | to |', '|---|---|---|', ...plan.memberRewrites.map((m) => `| ${m.email} | "${m.from}" | ${m.to} |`)]
      : ['- drivers: none']),
    '',
  ];
  return lines.join('\n');
}
