import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Headline, Tile, TileButton } from '@/components/metro/tile';
import { useToast } from '@/hooks/use-toast';

const RULES_URL = import.meta.env.BASE_URL.replace(/\/$/, '') + '/firebase-database.rules.json';
const DATABASE_URL = 'https://pu-transit-f815d-default-rtdb.firebaseio.com';

async function fetchRules(): Promise<string> {
  const response = await fetch(RULES_URL);
  if (!response.ok) throw new Error('rules file not found');
  return response.text();
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t-2 border-border/50 py-8 first:border-t-0 lg:grid lg:grid-cols-[8rem_1fr] lg:gap-8">
      <p className="metro-headline text-[4rem] leading-none text-foreground/55 tabular-nums" aria-hidden>
        {number}
      </p>
      <div className="flex flex-col gap-4">
        <Headline as="h2" size="section">
          {title}
        </Headline>
        {children}
      </div>
    </section>
  );
}

export default function Setup() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withRules = async (use: (rules: string) => Promise<void> | void, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await use(await fetchRules());
      toast({ title: done });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const download = (rules: string) => {
    const url = URL.createObjectURL(new Blob([rules], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'firebase-database.rules.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-6 px-5 py-6 md:px-8 md:py-12 lg:px-12">
      <Headline>setup</Headline>
      <p className="max-w-2xl text-xl">
        three things only the firebase project owner can do. everything here is safe to repeat.
      </p>

      <div className="flex flex-col">
        <Step number={1} title="turn on email sign-in">
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            <li>
              open the{' '}
              <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="underline underline-offset-4">
                firebase console
              </a>{' '}
              and pick the <strong className="font-medium">pu-transit-f815d</strong> project.
            </li>
            <li>build → authentication → get started.</li>
            <li>sign-in method → enable email/password → save.</li>
          </ol>
        </Step>

        <Step number={2} title="publish the database rules">
          <Tile tone="red" className="p-5">
            <p className="text-xl">the rules must match this build.</p>
            <p className="mt-2">
              the new email access policy, role requests, service notices and trip updates need the rules bundled with this build.
              publish the complete file when the database policy changes, not for ordinary visual updates.
            </p>
          </Tile>
          <div className="grid grid-cols-2 gap-2">
            <TileButton tone="blue" disabled={busy} onClick={() => void withRules((r) => navigator.clipboard.writeText(r), 'rules copied')}>
              <span>copy rules</span>
              <Copy className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            </TileButton>
            <TileButton tone="outline" disabled={busy} onClick={() => void withRules(download, 'rules downloaded')}>
              <span>download</span>
              <Download className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            </TileButton>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            <li>build → realtime database. use the existing <code className="break-all bg-foreground/10 px-1">{DATABASE_URL}</code> — never create a second one or pick test mode.</li>
            <li>rules tab → replace everything with the copied rules → publish.</li>
            <li>
              check: after publish, the rules editor lists <code className="bg-foreground/10 px-1">assignments</code>, <code className="bg-foreground/10 px-1">buses</code> and{' '}
              <code className="bg-foreground/10 px-1">serviceCalendar</code>. an app message starting “Firebase refused …” that repeats after a retry means the published rules are still older than this build.
            </li>
            <li>firestore stays deny-all; this app only uses the realtime database.</li>
          </ol>
        </Step>

        <Step number={3} title="approve drivers and admins">
          <p>the protected root administrator is already set up. manage future approvals in the app, not in the Firebase data editor.</p>
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            <li>the new member selects driver or admin at sign-up using a university email, then verifies it.</li>
            <li>the member gets student access while the transport office verifies the requested role.</li>
            <li>sign in as an approved administrator, open transport office → users, and review the request.</li>
            <li>for a driver, choose the assigned bus before approval. approve the role or dismiss the request.</li>
            <li>existing memberships stay intact. the root administrator cannot be demoted or suspended.</li>
          </ol>
          <TileButton href="/admin" tone="blue" className="self-start">open transport office</TileButton>
        </Step>
      </div>
    </div>
  );
}
