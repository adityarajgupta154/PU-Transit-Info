import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { serviceDateLabel, serviceDateToday } from '@/lib/service-date';
import { storage } from '@/lib/storage';

// STU-04b: shown only when the transport office marked today (IST) as no service.
// No entry, still loading, or a failed fetch all render nothing — the page keeps its plain tracking states rather than guessing.
// `error` is checked too: react-query keeps the last data after a failed refetch, and that copy may predate a deletion.
export function NoServiceToday() {
  const { user } = useAuth();
  const [today, setToday] = useState(serviceDateToday);
  const { data = [], error } = useQuery({
    queryKey: ['service-calendar', user?.uid],
    queryFn: ({ signal }) => storage.listServiceCalendar(signal),
    enabled: !!user,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    const interval = setInterval(() => setToday(serviceDateToday()), 60_000); // midnight rollover
    return () => clearInterval(interval);
  }, []);
  const day = error ? undefined : data.find((entry) => entry.date === today && entry.noService);
  if (!day) return null;
  return (
    <section aria-label="service calendar" className="border-l-8 border-destructive bg-card px-5 py-4">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">
        <time dateTime={day.date}>{serviceDateLabel(day.date)}</time> · transport office
      </p>
      <h2 className="text-2xl font-light">no bus service today</h2>
      {day.note && <p className="mt-1 whitespace-pre-wrap break-words">{day.note}</p>}
    </section>
  );
}
