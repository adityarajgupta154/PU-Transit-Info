import { ArrowRight } from 'lucide-react';
import { canDrive } from '@workspace/driver-tracking';
import { useAuth } from '@/contexts/auth-context';
import { Headline, TileButton, type TileTone } from '@/components/metro/tile';

/**
 * Home is three giant role tiles. The one the signed-in person can use is blue;
 * the rest are outlined. Nothing else competes with them.
 */
export default function Home() {
  const { user, membership, isLoading } = useAuth();
  const role = membership?.status === 'approved' ? membership.role : null;
  const owner = membership?.status === 'approved' && membership.role === 'admin' && membership.root === true;

  const tiles: { href: string; word: string; line: string; tone: TileTone }[] = [
    {
      href: '/student',
      word: 'find my bus',
      line: 'search a bus number, see where it is right now',
      tone: role ? 'blue' : 'outline',
    },
    {
      href: '/driver',
      word: 'drive',
      line: 'start the trip on your phone, riders follow it',
      tone: membership?.status === 'approved' && canDrive(membership) ? 'blue' : 'outline',
    },
    {
      href: '/admin',
      word: 'transport office',
      line: 'routes, buses, drivers, who may sign in',
      tone: role === 'admin' ? 'blue' : 'outline',
    },
  ];

  const accountLine = isLoading
    ? 'checking your account'
    : !user
      ? 'sign in with your paruluniversity.ac.in email to use the tiles'
      : !membership
        ? 'signed in — request university access from your account'
        : membership.status !== 'approved'
          ? `signed in — access ${membership.status}`
          : `signed in as ${owner ? 'owner admin' : membership.role}`;

  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-10 px-5 py-8 md:px-8 md:py-14 lg:px-12">
      <div className="flex flex-col gap-4">
        <Headline>where is the bus</Headline>
        <p className="max-w-xl text-lg text-muted-foreground">
          live campus bus tracking for vadodara. {accountLine}.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3 md:gap-4">
        {tiles.map((tile) => (
          <TileButton
            key={tile.href}
            href={tile.href}
            tone={tile.tone}
            className="min-h-48 flex-col items-start justify-between p-6 md:min-h-72"
          >
            <span className="metro-headline text-[2.5rem] md:text-[3rem]">{tile.word}</span>
            <span className="flex w-full items-end justify-between gap-4">
              <span className="text-base font-normal">{tile.line}</span>
              <ArrowRight className="h-7 w-7 shrink-0" strokeWidth={1.5} aria-hidden />
            </span>
          </TileButton>
        ))}
      </div>

      {!user && !isLoading && (
        <TileButton href="/account" tone="blue" className="self-start px-8">
          <span className="text-xl">sign in</span>
          <ArrowRight className="h-6 w-6" strokeWidth={1.5} aria-hidden />
        </TileButton>
      )}
    </div>
  );
}
