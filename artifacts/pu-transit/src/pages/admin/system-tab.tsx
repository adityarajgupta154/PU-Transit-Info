import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Headline, TileButton } from '@/components/metro/tile';
import { useToast } from '@/hooks/use-toast';
import { storage } from '@/lib/storage';
import type { AuditEntry, MigrationPreview } from '@workspace/api-client-react';

const ACTION_WORD: Record<AuditEntry['action'], string> = {
  'tracking.force_end': 'ended a trip',
  'tracking.handover': 'handed a bus to another driver',
  'membership.update': 'changed an account',
  'route.save': 'saved a route',
  'route.delete': 'deleted a route',
  'route.archive': 'archived a route',
  'notice.save': 'posted a notice',
  'notice.delete': 'deleted a notice',
  'bus.save': 'saved a bus',
  'bus.deactivate': 'took a bus out of service',
  'bus.reactivate': 'put a bus back in service',
  'assignment.save': 'assigned a driver to a bus for a day',
  'assignment.delete': 'removed a dated assignment',
  'calendar.save': 'marked a no-service day',
  'calendar.delete': 'removed a no-service day',
};

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function SystemTab({ refreshRoutes }: { refreshRoutes: () => void }) {
  const { toast } = useToast();
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; error: string | null; loading: boolean }>({ entries: [], error: null, loading: true });
  const [preview, setPreview] = useState<{ data: MigrationPreview | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [confirmImport, setConfirmImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const loadAudit = async () => {
    setAudit((a) => ({ ...a, loading: true, error: null }));
    try {
      const result = await storage.getAudit(50);
      setAudit({ entries: result.entries, error: null, loading: false });
    } catch (err) {
      setAudit((a) => ({ ...a, loading: false, error: err instanceof Error ? err.message : 'audit could not load' }));
    }
  };

  const loadPreview = async () => {
    setPreview((p) => ({ ...p, loading: true, error: null }));
    try {
      setPreview({ data: await storage.getMigrationPreview(), error: null, loading: false });
    } catch (err) {
      setPreview({ data: null, error: err instanceof Error ? err.message : 'preview failed', loading: false });
    }
  };

  useEffect(() => {
    void loadAudit();
    void loadPreview();
  }, []);

  const runImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const result = await storage.runMigration();
      toast({
        title: `imported ${result.importedRoutes} routes as drafts`,
        description: [
          result.importedRoutes ? 'plot or acknowledge each path in routes, then publish.' : null,
          result.skippedRoutes ? `${result.skippedRoutes} already existed or were invalid and were skipped.` : null,
        ].filter(Boolean).join(' ') || undefined,
      });
      setConfirmImport(false);
      refreshRoutes();
      void loadPreview();
      void loadAudit();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="flex flex-col gap-4" aria-labelledby="audit-heading">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Headline as="h2" size="section">
            <span id="audit-heading">audit log</span>
          </Headline>
          <TileButton tone="outline" onClick={() => void loadAudit()} disabled={audit.loading} className="min-h-12 px-4 py-2 text-base">
            <RefreshCw className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            <span>refresh</span>
          </TileButton>
        </div>
        <p className="text-muted-foreground">every office change, newest first. entries cannot be edited or removed.</p>
        {audit.error && (
          <p role="alert" className="text-destructive">
            {audit.error}
          </p>
        )}
        {!audit.loading && !audit.error && audit.entries.length === 0 && <p className="text-muted-foreground">no changes recorded yet.</p>}
        <ol className="flex flex-col">
          {audit.entries.map((entry) => (
            <li key={entry.id} className="grid gap-x-6 gap-y-1 border-t-2 border-border/50 py-3 first:border-t-0 sm:grid-cols-[9rem_1fr]">
              <time dateTime={new Date(entry.at).toISOString()} className="tabular-nums text-muted-foreground">
                {when(entry.at)}
              </time>
              <div className="min-w-0">
                <p className="text-xl font-light">
                  {entry.actorEmail.split('@')[0]} {ACTION_WORD[entry.action] ?? entry.action} · {entry.target}
                </p>
                <p className="break-words text-muted-foreground">{entry.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-4" aria-labelledby="rules-heading">
          <Headline as="h2" size="section">
            <span id="rules-heading">database rules</span>
          </Headline>
          <p className="text-muted-foreground">
            ending a trip from the office and the audit log need the current rules published in the firebase console. the project owner
            does that from setup; until then those two actions fail closed and everything else keeps working.
          </p>
          <TileButton tone="outline" href="/setup" className="self-start">
            open setup
          </TileButton>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="import-heading">
          <Headline as="h2" size="section">
            <span id="import-heading">legacy import</span>
          </Headline>
          {preview.error ? (
            <>
              <p className="text-destructive">{preview.error}</p>
              <TileButton tone="outline" onClick={() => void loadPreview()} className="self-start">
                retry
              </TileButton>
            </>
          ) : preview.loading ? (
            <p className="text-muted-foreground">counting routes in the old database.</p>
          ) : (
            <p className="text-muted-foreground">
              {preview.data?.routes ?? 0} routes in the old postgres database. importing copies them into firebase; existing bus numbers are
              skipped.
            </p>
          )}
          {!confirmImport ? (
            <TileButton tone="outline" onClick={() => setConfirmImport(true)} disabled={!preview.data || preview.data.routes === 0} className="self-start">
              import {preview.data?.routes ?? 0} routes
            </TileButton>
          ) : (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="confirm import">
              <TileButton tone="blue" onClick={() => void runImport()} disabled={importing} className="min-h-14 text-base">
                {importing ? 'importing' : 'yes, import'}
              </TileButton>
              <TileButton tone="outline" onClick={() => setConfirmImport(false)} disabled={importing} className="min-h-14 text-base">
                cancel
              </TileButton>
            </div>
          )}
          {importError && (
            <p role="alert" className="text-destructive">
              {importError}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
