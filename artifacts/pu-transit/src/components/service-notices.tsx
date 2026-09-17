import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { storage } from '@/lib/storage';

export function ServiceNotices({ routeId }: { routeId?: string }) {
  const { user } = useAuth();
  const [now, setNow] = useState(Date.now);
  const { data = [], error, isPending, refetch } = useQuery({
    queryKey: ['service-notices', user?.uid],
    queryFn: ({ signal }) => storage.listNotices(signal),
    enabled: !!user,
    refetchInterval: 15_000,
  });
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const notices = data.filter((notice) => notice.until > now && (!notice.routeId || notice.routeId === routeId));
  if (isPending) return <p className="text-muted-foreground" role="status">checking service notices…</p>;
  if (!notices.length && !error) return null;
  return (
    <section aria-label="service notices" className="border-y border-border py-4">
      <h2 className="text-xl font-medium">service notices</h2>
      {error && (
        <p className="mt-2 text-destructive" role="alert">
          notices could not update.{' '}
          <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => void refetch()}>retry</button>
        </p>
      )}
      <ul className="divide-y divide-border">
        {notices.map((notice) => (
          <li key={notice.id} className="py-3 last:pb-0">
            <p className="whitespace-pre-wrap break-words">{notice.text}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {notice.routeId ? 'this route' : 'all routes'} · until{' '}
              <time dateTime={new Date(notice.until).toISOString()}>
                {new Date(notice.until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST
              </time>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}