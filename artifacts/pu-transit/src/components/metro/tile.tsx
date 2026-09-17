import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';

/**
 * Metro tiles: solid colour fields, no radius, no shadow, no chrome.
 *  blue    — live state / primary action / selection flood (PU blue, white ink)
 *  outline — waiting state or secondary action (white, 2px ink outline)
 *  red     — fault or destructive action (white ink)
 *  ended   — 10% ink wash
 *  white   — white field, ink text, slate outline (form inputs live here)
 *  ground  — plain ground block, for grouping without a border
 */
export type TileTone = 'blue' | 'outline' | 'red' | 'ended' | 'white' | 'ground';

export const TILE_TONES: Record<TileTone, string> = {
  blue: 'bg-primary text-primary-foreground',
  outline: 'bg-white text-foreground border-2 border-foreground',
  red: 'bg-destructive text-destructive-foreground',
  ended: 'bg-foreground/10 text-foreground',
  white: 'bg-white text-foreground border-2 border-border',
  ground: 'bg-background text-foreground',
};

type TileProps = HTMLAttributes<HTMLDivElement> & { tone?: TileTone };

export const Tile = forwardRef<HTMLDivElement, TileProps>(function Tile(
  { tone = 'outline', className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('relative', TILE_TONES[tone], className)} {...props} />;
});

type TileButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: TileTone;
  /** Renders the tile as a link; keeps the same look and press tilt. */
  href?: string;
};

/**
 * A pressable tile. Minimum 56px tall so it is a real touch target;
 * disabled tiles keep their colour but drop to 40% — the state is still readable.
 */
export const TileButton = forwardRef<HTMLButtonElement, TileButtonProps>(function TileButton(
  { tone = 'outline', className, href, children, ...props },
  ref,
) {
  const classes = cn(
    'metro-tile inline-flex min-h-14 items-center justify-between gap-4 px-5 py-4 text-left text-lg font-normal',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    TILE_TONES[tone],
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button ref={ref} type="button" className={classes} {...props}>
      {children}
    </button>
  );
});

/**
 * Big lowercase light headline. Wraps by default; `clip` keeps it on one line and lets it
 * run off the right edge on purpose (the panorama device for bus numbers).
 * size: 'page' (4rem→6rem), 'section' (2.5rem→3.5rem), 'row' (1.75rem)
 */
export function Headline({
  as: Tag = 'h1',
  size = 'page',
  clip = false,
  className,
  children,
  ...rest
}: {
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  size?: 'page' | 'section' | 'row';
  clip?: boolean;
  className?: string;
  children: ReactNode;
} & Pick<HTMLAttributes<HTMLElement>, 'id' | 'tabIndex'>) {
  const sizes = {
    page: 'text-[4rem] md:text-[6rem]',
    section: 'text-[2.5rem] md:text-[3.5rem]',
    row: 'text-[1.75rem]',
  } as const;
  return (
    <Tag {...rest} className={cn('metro-headline', clip && 'metro-headline-clip', sizes[size], className)}>
      {children}
    </Tag>
  );
}

/** Solid block section: big word on top, content below, deep gutter after. */
export function Block({
  title,
  aside,
  className,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn('flex flex-col gap-5', className)}>
      <div className="flex items-end justify-between gap-6">
        <Headline as="h2" size="section">
          {title}
        </Headline>
        {aside}
      </div>
      {children}
    </section>
  );
}
