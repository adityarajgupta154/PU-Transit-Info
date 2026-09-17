import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { accessThroughLabel, canDrive, membershipExpired } from '@workspace/driver-tracking';
import { useAuth } from '@/contexts/auth-context';
import { Headline, Tile, TileButton, type TileTone } from '@/components/metro/tile';

interface AuthGateProps {
  children: ReactNode;
  allowedRoles?: ('student' | 'staff' | 'driver' | 'admin')[];
  requireActive?: boolean;
}

function roleLabel(member: { role: string; root?: boolean }): string {
  return member.role === 'admin' && member.root === true ? 'owner admin' : member.role;
}

function Stop({
  headline,
  body,
  action,
  href,
  tone = 'blue',
  detail,
}: {
  headline: string;
  body: string;
  action: string;
  href: string;
  tone?: TileTone;
  detail?: string | null;
}) {
  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-6 px-5 py-6 md:px-8 md:py-12 lg:px-12">
      <Headline>{headline}</Headline>
      <p className="max-w-xl text-xl">{body}</p>
      {detail && <p className="max-w-xl text-destructive">{detail}</p>}
      <TileButton tone={tone} href={href} className="min-h-20 w-full max-w-xl text-2xl">
        <span>{action}</span>
        <ArrowRight className="h-7 w-7" strokeWidth={1.5} aria-hidden />
      </TileButton>
    </div>
  );
}

export function AuthGate({ children, allowedRoles, requireActive = true }: AuthGateProps) {
  const { user, membership, isLoading, error, isEmailVerified, universityEmail, graceEndsAt, emailMismatch } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  // Re-render at the next deadline (personal-email grace or IDN-01 expiry), in daily steps for the "days left" copy.
  const deadline = [graceEndsAt, membership?.expiresAt ?? null].reduce<number | null>(
    (soonest, at) => (at !== null && at > now && (soonest === null || at < soonest) ? at : soonest),
    null,
  );
  useEffect(() => {
    if (deadline === null) return;
    const remaining = deadline - Date.now(); // the clock, not the rendered `now`: a late effect must not push the tick a day out
    const nextDay = remaining % (24 * 60 * 60 * 1000);
    const delay = Math.min(remaining, nextDay || 24 * 60 * 60 * 1000);
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(1, delay));
    return () => window.clearTimeout(timer);
  }, [deadline, now]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center px-5 py-6 md:px-8 lg:px-12">
        <Headline className="text-foreground/55">checking your access</Headline>
      </div>
    );
  }

  if (!user) {
    return <Stop headline="sign in first" body="this page is for university accounts." action="go to sign in" href="/account" />;
  }

  if (!isEmailVerified) {
    return (
      <Stop
        headline="verify your email"
        body={`open the link we emailed to ${user.email ?? 'your address'}, then refresh from the account page. nothing is approved before that.`}
        action="account"
        href="/account"
        tone="outline"
      />
    );
  }

  if (!membership) {
    return (
      <Stop
        headline="request access"
        body={error ? 'your access could not be checked right now.' : 'you have not asked the transport office for access yet.'}
        detail={error}
        action="account"
        href="/account"
      />
    );
  }

  if (requireActive && membership.status !== 'approved') {
    const body =
      membership.status === 'pending'
        ? 'the transport office has not approved your request yet.'
        : membership.status === 'rejected'
          ? 'the transport office turned down your request.'
          : 'the transport office suspended your account.';
    return <Stop headline={membership.status === 'pending' ? 'waiting for approval' : `access ${membership.status}`} body={body} action="check status" href="/account" tone="outline" />;
  }

  if (requireActive && !membership.active) {
    return <Stop headline="account inactive" body="your account is switched off. ask the transport office." action="check status" href="/account" tone="outline" />;
  }

  // IDN-01: approved and active, but the end date the office set has passed — same way back as suspended.
  if (requireActive && membershipExpired(membership, now)) {
    return (
      <Stop
        headline="access expired"
        body={`your access ran until ${accessThroughLabel(membership.expiresAt as number)}. ask the transport office to extend it.`}
        action="check status"
        href="/account"
        tone="outline"
      />
    );
  }

  // AC-32: the account email changed on an otherwise current approval (status, activity and expiry are
  // judged first, as the API does). A verified university address is re-bound by the server on the next
  // check, so reaching here means the new address is one the approval cannot follow.
  if (requireActive && emailMismatch) {
    return (
      <Stop
        headline="email changed"
        body={`your access was approved for ${membership.email}, and you are now signed in as ${user.email ?? 'another address'}. only a verified university email can carry that approval — switch back from the account page, or ask the transport office.`}
        action="account"
        href="/account"
        tone="red"
      />
    );
  }

  if (requireActive && membership.role === 'student' && graceEndsAt !== null && now >= graceEndsAt) {
    return (
      <Stop
        headline="access period ended"
        body="personal student access lasts 30 days. switch to a verified university email from your account page to continue."
        action="switch email"
        href="/account"
        tone="red"
      />
    );
  }

  const roleAllowed =
    !allowedRoles ||
    allowedRoles.some((role) =>
      role === 'driver'
        ? canDrive(membership)
        : membership.role === role || (role === 'student' && membership.role === 'staff'),
    );
  if (!roleAllowed) {
    return (
      <Stop
        headline="not your page"
        body={`this page is for ${allowedRoles.join(' or ')} accounts. you are signed in as ${roleLabel(membership)}.`}
        action="home"
        href="/"
        tone="outline"
      />
    );
  }

  const graceBannerVisible =
    requireActive &&
    !universityEmail &&
    membership.status === 'approved' &&
    membership.active &&
    membership.role === 'student' &&
    graceEndsAt !== null &&
    now < graceEndsAt;
  const daysLeft = graceEndsAt === null ? 0 : Math.max(1, Math.ceil((graceEndsAt - now) / (24 * 60 * 60 * 1000)));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {graceBannerVisible && (
        <Tile
          tone="outline"
          role="status"
          aria-live="polite"
          data-testid="banner-personal-email-grace"
          className="mx-5 mt-5 flex items-start justify-between gap-4 p-4 md:mx-8 lg:mx-12"
        >
          <div>
            <p className="text-xl font-light">personal-email access</p>
            <p className="text-base text-muted-foreground">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left. switch to your university email from your account page to keep access.
            </p>
          </div>
          <Link href="/account" data-testid="link-grace-account" className="shrink-0 text-base underline underline-offset-4">
            account
          </Link>
        </Tile>
      )}
      {children}
    </div>
  );
}
