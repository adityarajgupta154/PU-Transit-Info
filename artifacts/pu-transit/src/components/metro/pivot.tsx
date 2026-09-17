import { cn } from '@/lib/utils';

/**
 * Metro pivot header: the section names sit in a row as big lowercase words.
 * The selected one is white, the rest are dimmed. Keyboard: arrow keys move, it is a tablist.
 */
export function Pivot<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const move = (delta: number, list: HTMLElement) => {
    const index = items.findIndex((item) => item.value === value);
    const nextIndex = (index + delta + items.length) % items.length;
    onChange(items[nextIndex].value);
    list.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex gap-x-8 gap-y-2 overflow-x-auto whitespace-nowrap', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1, event.currentTarget); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1, event.currentTarget); }
      }}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`pivot-${item.value}`}
            aria-selected={selected}
            aria-controls={`panel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'metro-headline shrink-0 py-2 text-[2.25rem] md:text-[3rem] transition-colors',
              selected ? 'text-foreground' : 'text-foreground/55 hover:text-foreground/80',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span className="ml-2 align-top text-[1.25rem] font-normal">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
