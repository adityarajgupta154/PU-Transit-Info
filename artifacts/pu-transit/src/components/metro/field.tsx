import { forwardRef, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * White box, black ink, label above in white. One field, one label — nothing labelled twice.
 * Errors are set in vermilion text under the box, never inside it.
 */
type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  /** Overrides the visible label with a visually hidden one when the surrounding tile already says it. */
  hideLabel?: boolean;
  /** A tile-button set beside the box on the same row (the search pair). */
  trailing?: ReactNode;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, hideLabel, trailing, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className={cn('text-lg lowercase', hideLabel && 'sr-only')}>
        {label}
      </label>
      {/* The trailing tile wraps under the box when both no longer fit on one line (200 % text on a 360 px phone). */}
      <div className="flex flex-wrap gap-2">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            'h-14 w-full min-w-[7rem] flex-1 border-2 border-border bg-white px-4 text-xl text-foreground placeholder:text-muted-foreground',
            'aria-invalid:border-destructive disabled:opacity-40',
            className,
          )}
          {...props}
        />
        {trailing}
      </div>
      {error ? (
        <p id={errorId} className="text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hideLabel?: boolean;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
};

/** Native select in a white box — the platform picker is the Metro one. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hideLabel, error, hint, className, id, children, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const errorId = `${selectId}-error`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={selectId} className={cn('text-lg lowercase', hideLabel && 'sr-only')}>
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn('h-14 w-full border-2 border-border bg-white px-3 text-xl text-foreground aria-invalid:border-destructive disabled:opacity-40', className)}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={errorId} className="text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
});
