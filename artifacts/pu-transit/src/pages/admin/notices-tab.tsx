import { useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { TileButton } from '@/components/metro/tile';
import { Field, SelectField } from '@/components/metro/field';
import { useToast } from '@/hooks/use-toast';
import { storage, type Notice, type Route } from '@/lib/storage';
import { cn } from '@/lib/utils';

export function NoticesTab({ routes }: { routes: Route[] }) {
  const { toast } = useToast();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [routeId, setRouteId] = useState('');
  const [untilStr, setUntilStr] = useState('');

  const loadNotices = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await storage.listNotices();
      setNotices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not load notices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNotices();
    // Poll every 30s for changes by other admins
    const intId = setInterval(() => void loadNotices(), 30000);
    return () => clearInterval(intId);
  }, []);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !untilStr) return;
    
    setSaving(true);
    try {
      const untilDate = new Date(untilStr);
      if (isNaN(untilDate.getTime())) throw new Error('invalid date');
      const until = untilDate.getTime();
      
      const MAX_DAYS = 30;
      if (until - Date.now() > MAX_DAYS * 24 * 60 * 60 * 1000) {
        throw new Error('expiry must be within 30 days');
      }
      
      await storage.createNotice({ text: text.trim(), routeId, until });
      toast({ title: 'notice posted' });
      setText('');
      setRouteId('');
      setUntilStr('');
      await loadNotices();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'failed to post notice', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await storage.deleteNotice(id);
      toast({ title: 'notice deleted' });
      await loadNotices();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'delete failed', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const todayStr = new Date().toISOString().slice(0, 16); // YYYY-MM-DDThh:mm

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted-foreground">
          broadcast messages to all riders or specific routes.
        </p>
        <TileButton tone="outline" onClick={() => void loadNotices()} disabled={loading} className="min-h-12 px-4 py-2 text-base">
          <RefreshCw className={cn('h-5 w-5', loading && 'animate-spin')} strokeWidth={1.5} aria-hidden />
          <span>refresh</span>
        </TileButton>
      </div>

      <form onSubmit={handlePost} className="flex flex-col gap-4 border-2 border-border/50 p-5 bg-card">
        <h3 className="text-xl font-light">post new notice</h3>
        
        <Field
          label="message (max 280 chars)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          required
          disabled={saving}
          placeholder="e.g. general shift buses delayed by 15 mins due to rain"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="scope"
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            disabled={saving}
          >
            <option value="">all routes</option>
            {routes.map(r => (
              <option key={r.id} value={r.id}>{r.shift} {r.busNumber}</option>
            ))}
          </SelectField>

          <Field
            label="expires at"
            type="datetime-local"
            value={untilStr}
            min={todayStr}
            onChange={(e) => setUntilStr(e.target.value)}
            required
            disabled={saving}
          />
        </div>

        <TileButton type="submit" tone="blue" disabled={saving || !text.trim() || !untilStr}>
          {saving ? 'posting...' : 'post notice'}
        </TileButton>
      </form>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {!loading && !error && notices.length === 0 && (
        <p className="text-muted-foreground pt-4">no active notices.</p>
      )}

      <ul className="flex flex-col pt-4">
        {notices.map((n) => {
          const isDeleting = deletingId === n.id;
          const route = routes.find(r => r.id === n.routeId);
          return (
            <li key={n.id} className="flex flex-col gap-4 border-t-2 border-border/50 py-5 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <p className="text-xl font-light text-foreground">{n.text}</p>
                <TileButton 
                  tone="red" 
                  disabled={isDeleting} 
                  onClick={() => void handleDelete(n.id)}
                  className="min-h-12 px-4 py-2 text-base self-start"
                  aria-label="delete notice"
                >
                  <Trash2 className="h-5 w-5" />
                  <span className="sr-only">delete</span>
                </TileButton>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <p>scope: {route ? `${route.shift} ${route.busNumber}` : 'all routes'}</p>
                <p>expires: {new Date(n.until).toLocaleString()}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
