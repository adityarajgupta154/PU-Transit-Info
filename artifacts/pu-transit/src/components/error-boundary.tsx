import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  // Same world as the rest of the app: black ground, white ink, a fault tile in vermilion, square controls.
  return (
    <div className="flex min-h-screen w-full flex-col justify-center gap-6 bg-background p-6 text-foreground">
      <h1 className="metro-headline text-[4rem] md:text-[6rem]">something broke</h1>
      <p className="max-w-lg text-lg text-muted-foreground">this screen hit an error. the rest of the app is still running.</p>
      {/* Dev only: messages can carry API responses and other internals. */}
      {import.meta.env.DEV ? (
        <pre className="max-w-lg overflow-x-auto bg-destructive p-4 text-left text-sm text-white">{error.message || String(error)}</pre>
      ) : null}
      <button
        type="button"
        onClick={resetError}
        className="metro-tile min-h-14 self-start bg-primary px-6 text-xl text-primary-foreground"
      >
        try again
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
