import { useEffect, useState } from 'react';
import { Clock, Navigation, Square, TriangleAlert } from 'lucide-react';
import type { LiveTrackingFeed, LiveTrackingFeedStatus } from '@workspace/api-client-react';
import { fixAgeSeconds, formatAge, stampFor, type StateStamp, type StateTone } from '@/lib/tracking-state';
import { TILE_TONES } from '@/components/metro/tile';
import { cn } from '@/lib/utils';

const GLYPHS: Record<StateTone, typeof Clock> = {
  blue: Navigation,
  outline: Clock,
  red: TriangleAlert,
  ended: Square,
};

/**
 * The live tile. One state word, one age, one glyph. It flips on its X axis each time the server
 * accepts a new sample (keyed on lastValidReceivedAt), so "live" visibly ticks without a spinner.
 * Not a live region on purpose: the age ticks every second and the tile remounts every sample, so
 * a screen reader would hear it constantly. Pages announce state changes with their own sr-only status line.
 */
export function StateTile({
  status,
  stamp: stampOverride,
  feed,
  receivedAt,
  formatAgeText,
  compact = false,
  className,
}: {
  status: LiveTrackingFeedStatus | null;
  /** Use a different stamp than the rider one (the driver console has phases riders never see). */
  stamp?: StateStamp;
  feed: LiveTrackingFeed | null;
  receivedAt: number | null;
  /** Driver consoles can localize the existing freshness value without changing its clock calculation. */
  formatAgeText?: (seconds: number | null) => string;
  compact?: boolean;
  className?: string;
}) {
  const stamp = stampOverride ?? stampFor(status);
  const Glyph = GLYPHS[stamp.tone];
  const flipKey = feed?.lastValidReceivedAt ?? 0;
  const [, setTick] = useState(0);

  // The age line re-renders every second while there is a fix to age.
  useEffect(() => {
    if (!feed?.lastValidCapturedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [feed?.lastValidCapturedAt]);

  const age = feed && receivedAt !== null ? fixAgeSeconds(feed, receivedAt, performance.now()) : null;
  const showAge = stamp.tone !== 'ended' && status !== 'not_started';

  return (
    <div
      key={flipKey}
      className={cn(
        'metro-flip relative flex flex-col justify-between',
        compact ? 'min-h-16 px-3 py-2' : 'min-h-24 px-5 py-3',
        TILE_TONES[stamp.tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn('metro-headline', compact ? 'text-[1.75rem]' : 'text-[2.5rem]')}>{stamp.label}</span>
        <Glyph className={cn('shrink-0', compact ? 'h-5 w-5' : 'h-7 w-7')} strokeWidth={1.5} aria-hidden />
      </div>
      {showAge && (
        <span className={cn('tabular-nums', compact ? 'text-sm' : 'text-base')}>
          {(formatAgeText ?? formatAge)(age)}
        </span>
      )}
    </div>
  );
}
