import { useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { TileButton } from '@/components/metro/tile';
import { Field } from '@/components/metro/field';
import { useToast } from '@/hooks/use-toast';
import { serviceDateLabel, serviceDateToday } from '@/lib/service-date';
import { storage, type ServiceDay } from '@/lib/storage';
import { cn } from '@/lib/utils';

// STU-04b: the only source of "no service today" for riders. Days not listed here are not claimed either way.
export function CalendarTab() {
  const { toast } = useToast();
  const [days, setDays] = useState<ServiceDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const today = serviceDateToday();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDays(await storage.listServiceCalendar());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not load the service calendar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    setSaving(true);
    try {
      const trimmed = note.trim();
      await storage.setServiceDay(date, { noService: true, ...(trimmed ? { note: trimmed } : {}) });
      toast({ title: `no service on ${serviceDateLabel(date)}` });
      setDate('');
      setNote('');
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'could not save the day', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (day: string) => {
    setDeleting(day);
    try {
      await storage.deleteServiceDay(day);
      toast({ title: `service restored on ${serviceDateLabel(day)}` });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'delete failed', variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted-foreground">
          days with no bus service. riders see the reason on the date itself; days not listed are left alone.
        </p>
        <TileButton tone="outline" onClick={() => void load()} disabled={loading} className="min-h-12 px-4 py-2 text-base">
          <RefreshCw className={cn('h-5 w-5', loading && 'animate-spin')} strokeWidth={1.5} aria-hidden />
          <span>refresh</span>
        </TileButton>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-4 border-2 border-border/50 bg-card p-5">
        <h3 className="text-xl font-light">mark a no-service day</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="date (IST)" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required disabled={saving} />
          <Field
            label="reason (optional, max 140 chars)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={140}
            disabled={saving}
            placeholder="e.g. Diwali holiday"
          />
        </div>
        <TileButton type="submit" tone="blue" disabled={saving || !date}>
          {saving ? 'saving...' : 'mark no service'}
        </TileButton>
      </form>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {!loading && !error && days.length === 0 && <p className="pt-4 text-muted-foreground">no no-service days marked.</p>}

      <ul className="flex flex-col pt-4">
        {days.map((day) => (
          <li key={day.date} className="flex flex-wrap items-baseline justify-between gap-4 border-t-2 border-border/50 py-5 first:border-t-0">
            <div>
              <p className="text-xl font-light text-foreground">
                <time dateTime={day.date}>{serviceDateLabel(day.date)}</time>
                {day.date === today && <span className="ml-3 text-sm uppercase tracking-wide text-destructive">today</span>}
                {day.date < today && <span className="ml-3 text-sm uppercase tracking-wide text-muted-foreground">past</span>}
              </p>
              <p className="text-sm text-muted-foreground">{day.note ?? 'no reason given'}</p>
            </div>
            <TileButton
              tone="red"
              disabled={deleting === day.date}
              onClick={() => void handleDelete(day.date)}
              className="min-h-12 self-start px-4 py-2 text-base"
              aria-label={`restore service on ${day.date}`}
            >
              <Trash2 className="h-5 w-5" />
              <span className="sr-only">restore service</span>
            </TileButton>
          </li>
        ))}
      </ul>
    </>
  );
}
