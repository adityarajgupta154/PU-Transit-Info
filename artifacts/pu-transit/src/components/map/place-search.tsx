import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MapPin, Search } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { formatCoordinates, inVadodara, parseCoordinates } from '@/lib/coordinates';
import { mapConfig } from '@/lib/map-config';
import { searchPlaces, type Place } from '@/lib/ors';
import { cn } from '@/lib/utils';

export type PickedPlace = { lat: number; lng: number; name?: string };

/** Fewer requests to the shared geocoder quota: one search per pause in typing, never per keystroke. */
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

type Option = { kind: 'place'; place: Place } | { kind: 'pin'; lat: number; lng: number };
type Lookup = { state: 'idle' } | { state: 'searching' } | { state: 'done'; query: string; places: Place[] } | { state: 'error'; message: string };

function lookupFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'too many searches in a row — wait a moment and type again.';
    if (error.status === 401) return 'signed out — sign in again to search places.';
    return `place search failed: ${error.message}`;
  }
  return error instanceof Error ? `place search failed: ${error.message}` : 'place search failed.';
}

/**
 * One box that adds a stop three ways: a Vadodara place name with suggestions while typing, a
 * coordinate pair (or Google Maps link) for an exact point, and — via the map beside it — a tap.
 * A WAI-ARIA combobox: arrows move through the suggestions, enter adds the highlighted one, escape closes.
 */
export function PlaceSearch({ onPick, disabled, id: givenId }: { onPick: (stop: PickedPlace) => void; disabled?: boolean; id?: string }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const listId = `${id}-options`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState<string | null>(null);

  const trimmed = query.trim();
  const coordinates = parseCoordinates(trimmed);
  const outside = coordinates !== null && !inVadodara(coordinates);

  useEffect(() => {
    if (coordinates || trimmed.length < MIN_QUERY_LENGTH) {
      setLookup({ state: 'idle' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLookup({ state: 'searching' });
      searchPlaces(trimmed, controller.signal).then(
        (places) => {
          if (!controller.signal.aborted) setLookup({ state: 'done', query: trimmed, places });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setLookup({ state: 'error', message: lookupFailure(error) });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `coordinates` is derived from `trimmed`
  }, [trimmed]);

  const options: Option[] =
    coordinates && !outside
      ? [{ kind: 'pin', lat: coordinates.lat, lng: coordinates.lng }]
      : lookup.state === 'done' && lookup.query === trimmed
        ? lookup.places.map((place) => ({ kind: 'place', place }))
        : [];
  const expanded = open && options.length > 0;
  const highlighted = Math.min(active, Math.max(options.length - 1, 0));

  const pick = (option: Option) => {
    if (option.kind === 'pin') {
      onPick({ lat: option.lat, lng: option.lng });
      setAdded(`added a stop at ${formatCoordinates(option)} — give it a name in the list.`);
    } else {
      onPick({ lat: option.place.lat, lng: option.place.lng, name: option.place.name });
      setAdded(`added ${option.place.name}.`);
    }
    setQuery('');
    setLookup({ state: 'idle' });
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((highlighted + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      // The form's own submit is a no-op, but enter on a suggestion must never look like "save".
      event.preventDefault();
      if (options.length === 0) return;
      // After escape the list is hidden: enter shows it again rather than adding an unseen stop.
      if (!expanded) {
        setOpen(true);
        return;
      }
      pick(options[highlighted]);
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const status = (() => {
    if (outside && coordinates) {
      return {
        tone: 'destructive' as const,
        text: `${formatCoordinates(coordinates)} is outside the Vadodara map (${mapConfig.vadodaraBounds.south}–${mapConfig.vadodaraBounds.north} N, ${mapConfig.vadodaraBounds.west}–${mapConfig.vadodaraBounds.east} E).`,
      };
    }
    if (coordinates) return { tone: 'muted' as const, text: 'an exact point — press enter or choose it below to add the stop.' };
    if (lookup.state === 'error') return { tone: 'destructive' as const, text: lookup.message };
    if (lookup.state === 'searching') return { tone: 'muted' as const, text: 'searching vadodara' };
    if (lookup.state === 'done' && lookup.query === trimmed && lookup.places.length === 0) {
      return { tone: 'muted' as const, text: `nothing in vadodara matches “${trimmed}” — tap the map where the stop is, or paste its coordinates.` };
    }
    if (added && trimmed === '') return { tone: 'muted' as const, text: added };
    return { tone: 'muted' as const, text: 'a place name brings suggestions; coordinates like 22.2887, 73.3634 or a Google Maps link add an exact point.' };
  })();

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-lg lowercase">
        add a stop
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `${listId}-${highlighted}` : undefined}
          aria-invalid={outside || lookup.state === 'error' ? true : undefined}
          aria-describedby={`${id}-status`}
          placeholder="place name, or 22.2887, 73.3634"
          disabled={disabled}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
            setAdded(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-14 w-full border-2 border-border bg-white pl-12 pr-4 text-xl text-foreground placeholder:text-muted-foreground',
            'aria-invalid:border-destructive disabled:opacity-40',
          )}
        />
        {/* Same-width sheet under the box; blue flood marks the highlighted suggestion (a selection, so it may take the blue). */}
        <ul
          id={listId}
          role="listbox"
          aria-label="matching places"
          hidden={!expanded}
          className="absolute left-0 right-0 top-full z-20 -mt-0.5 max-h-80 overflow-y-auto border-2 border-foreground bg-white"
        >
          {options.map((option, index) => {
            const selected = index === highlighted;
            return (
              <li
                key={option.kind === 'pin' ? 'pin' : `${option.place.name}|${option.place.lat}|${option.place.lng}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => event.preventDefault()} // keep focus in the box so blur does not close the list first
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-3 border-t-2 border-border/50 px-4 py-2 first:border-t-0',
                  selected ? 'bg-primary text-primary-foreground' : 'text-foreground',
                )}
              >
                <MapPin className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden />
                {option.kind === 'pin' ? (
                  <span className="flex min-w-0 flex-col">
                    <span className="tabular-nums">pin at {formatCoordinates(option)}</span>
                    <span className="sr-only">, </span>
                    <span className={cn('text-base', selected ? 'text-primary-foreground' : 'text-muted-foreground')}>exact point</span>
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.place.name}</span>
                    {option.place.detail && (
                      <>
                        <span className="sr-only">, </span>
                        <span className={cn('truncate text-base', selected ? 'text-primary-foreground' : 'text-muted-foreground')}>{option.place.detail}</span>
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p id={`${id}-status`} role="status" className={status.tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}>
        {status.text}
      </p>
    </div>
  );
}
