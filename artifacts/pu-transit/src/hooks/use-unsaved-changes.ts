import { useEffect, useRef } from 'react';
import { navigate, useBrowserLocation } from 'wouter/use-browser-location';

// RTE-04: one form at a time can hold unsaved edits. Everything that would unmount it — an admin
// tab switch, an in-app link, back/forward, a reload or tab close — asks first, and only while
// the form is dirty.
let unsaved: string | null = null;
const SPARE = 'puUnsavedSpare';

export function markUnsaved(message: string | null) {
  unsaved = message;
}

/** True when leaving is fine: nothing is dirty, or the person confirmed losing the edits. */
export function confirmLeave(): boolean {
  return unsaved === null || window.confirm(unsaved);
}

const onSpare = () => window.history.state?.[SPARE] === true;

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (unsaved === null) return;
  event.preventDefault();
  event.returnValue = ''; // legacy browsers need a string for the native prompt
}

export function useUnsavedChanges(dirty: boolean, message: string) {
  const disarm = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    markUnsaved(message);
    return () => markUnsaved(null);
  }, [dirty, message]);

  useEffect(() => {
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  // Back/forward: from the first edit until the form unmounts, a spare history entry on the same
  // URL absorbs "back", so the page stays put while we ask. Declining puts the spare back;
  // accepting (or a clean form) goes back for real. Armed once per mount, so dirty → clean → dirty
  // never queues a traversal that could land on a stale spare and prompt for nothing.
  useEffect(() => {
    if (!dirty || disarm.current) return;
    const here = window.location.href;
    const spare = () => window.history.pushState({ ...window.history.state, [SPARE]: true }, '', here);
    const onPop = () => {
      if (window.location.href !== here) return; // already elsewhere; nothing left to protect
      if (!confirmLeave()) {
        spare();
        return;
      }
      markUnsaved(null); // the leave is agreed: no second (native) prompt if the previous page is another document
      disarm.current?.();
      window.history.back();
    };
    spare();
    window.addEventListener('popstate', onPop);
    disarm.current = () => {
      window.removeEventListener('popstate', onPop);
      disarm.current = null;
    };
  }, [dirty]);

  useEffect(
    () => () => {
      if (!disarm.current) return;
      disarm.current();
      if (onSpare()) window.history.back(); // unmounting while still parked on the spare: drop it
    },
    [],
  );
}

const guardedNavigate: typeof navigate = (to, options) => {
  if (!confirmLeave()) return;
  // Leaving from the spare entry: take its place, so one "back" from the next page returns here once.
  navigate(to, onSpare() ? { ...options, replace: true } : options);
};

/** wouter location hook whose navigate runs the unsaved-changes check first (links, redirects, programmatic moves). */
export const useGuardedLocation: typeof useBrowserLocation = (options) => {
  const [location] = useBrowserLocation(options);
  return [location, guardedNavigate];
};
