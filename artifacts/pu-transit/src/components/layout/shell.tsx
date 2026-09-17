import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Bus, CircleUserRound, Home, Info, Search, Settings2, Wrench, type LucideIcon } from 'lucide-react';
import { canDrive } from '@workspace/driver-tracking';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';

const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;
const TAGLINE = 'Find your bus. Every day.';

/**
 * Metro app bar on the PU blue field: circled outline icons, bottom on phones, left rail on desktop.
 * The blue band carries the university badge, the name and the tagline; pages never repeat them.
 */
export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, membership } = useAuth();
  const role = membership?.status === 'approved' ? membership.role : null;
  const path = location.replace(/\.html$/, '');

  const items: { href: string; label: string; icon: LucideIcon; show: boolean }[] = [
    { href: '/', label: 'home', icon: Home, show: true },
    { href: '/student', label: 'find', icon: Search, show: !!role },
    { href: '/driver', label: 'drive', icon: Bus, show: role !== null && canDrive(membership) },
    { href: '/admin', label: 'admin', icon: Settings2, show: role === 'admin' },
    { href: '/about', label: 'about', icon: Info, show: true },
    { href: '/account', label: user ? 'account' : 'sign in', icon: CircleUserRound, show: true },
    { href: '/setup', label: 'setup', icon: Wrench, show: role === 'admin' || !user },
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        skip to content
      </a>

      <nav
        aria-label="app bar"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex h-20 items-center justify-around bg-primary px-1 pb-[env(safe-area-inset-bottom)] text-primary-foreground',
          'md:static md:h-auto md:w-28 md:shrink-0 md:flex-col md:justify-start md:gap-2 md:px-0 md:pb-0 md:pt-8',
        )}
      >
        <Link
          href="/"
          className="hidden md:mb-8 md:flex md:w-full md:flex-col md:items-center md:gap-2 md:px-2 md:text-center"
          aria-label="PU Transit home"
        >
          <img src={LOGO_SRC} alt="" width={56} height={56} className="h-14 w-14 rounded-full bg-white" />
          <span className="text-sm font-medium leading-tight">PU Transit</span>
          <span className="text-xs leading-snug">{TAGLINE}</span>
        </Link>

        {items
          .filter((item) => item.show)
          .map(({ href, label, icon: Icon }) => {
            const active = path === href || (href !== '/' && path.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="metro-tile flex min-w-[44px] flex-col items-center gap-1 py-2 md:w-full md:py-3"
              >
                {/* px on purpose: at 200 % text zoom four rem-sized circles no longer fit a 360 px bar */}
                <span
                  className={cn(
                    'flex h-[44px] w-[44px] items-center justify-center rounded-full border-2 border-white',
                    active ? 'bg-white text-primary' : 'text-white',
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className={cn('text-[0.6875rem] lowercase', active && 'font-medium')}>{label}</span>
              </Link>
            );
          })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 bg-primary px-4 text-primary-foreground md:hidden">
          <img src={LOGO_SRC} alt="" width={36} height={36} className="h-9 w-9 rounded-full bg-white" />
          <p className="flex flex-col leading-tight">
            <span className="text-base font-medium">PU Transit</span>
            <span className="text-xs">{TAGLINE}</span>
          </p>
        </header>
        <main id="main" className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
