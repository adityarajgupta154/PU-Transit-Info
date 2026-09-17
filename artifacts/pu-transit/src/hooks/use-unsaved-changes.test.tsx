import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Link, Router, useLocation } from 'wouter';
import { markUnsaved, useGuardedLocation, useUnsavedChanges } from './use-unsaved-changes';

function Probe() {
  const [location] = useLocation();
  return <output>{location}</output>;
}

afterEach(() => {
  markUnsaved(null);
  vi.restoreAllMocks();
});

it('in-app navigation asks first while something is unsaved and goes straight through otherwise (RTE-04)', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  window.history.replaceState(null, '', '/');
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  act(() => {
    root.render(
      <Router hook={useGuardedLocation}>
        <Link href="/admin">admin</Link>
        <Link href="/">home</Link>
        <Probe />
      </Router>,
    );
  });
  const link = (text: string) => Array.from(container.querySelectorAll('a')).find((a) => a.textContent === text) as HTMLAnchorElement;
  const shown = () => container.querySelector('output')?.textContent;

  markUnsaved('lose the edits?');
  act(() => link('admin').click());
  expect(confirm).toHaveBeenCalledWith('lose the edits?');
  expect(window.location.pathname).toBe('/');
  expect(shown()).toBe('/');

  // Agreed while parked on the spare entry: the destination takes the spare's place, so one back returns here once.
  window.history.pushState({ puUnsavedSpare: true }, '', '/');
  const replace = vi.spyOn(window.history, 'replaceState');
  confirm.mockReturnValue(true);
  act(() => link('admin').click());
  expect(window.location.pathname).toBe('/admin');
  expect(shown()).toBe('/admin');
  expect(replace).toHaveBeenCalledTimes(1);
  expect(window.history.state?.puUnsavedSpare).toBeUndefined();

  markUnsaved(null);
  confirm.mockClear();
  act(() => link('home').click());
  expect(confirm).not.toHaveBeenCalled();
  expect(shown()).toBe('/');
  expect(replace).toHaveBeenCalledTimes(1); // not on a spare: a normal push

  act(() => root.unmount());
  container.remove();
});

function Form({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty, 'lose the edits?');
  return null;
}

it('back/forward: a dirty form absorbs the first back and asks; declining stays, accepting or a clean form goes back for real (RTE-04)', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const push = vi.spyOn(window.history, 'pushState');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  window.history.replaceState(null, '', '/admin');
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const render = (dirty: boolean) => act(() => root.render(<Form dirty={dirty} />));
  // The browser consumed the spare entry: same URL, the entry underneath has no spare flag.
  const popSpare = () =>
    act(() => {
      window.history.replaceState(null, '', '/admin');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

  render(false);
  expect(push).not.toHaveBeenCalled();

  render(true);
  expect(push).toHaveBeenCalledTimes(1);
  expect(window.history.state).toMatchObject({ puUnsavedSpare: true });
  expect(window.location.pathname).toBe('/admin');

  popSpare();
  expect(confirm).toHaveBeenCalledWith('lose the edits?');
  expect(back).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledTimes(2); // declined: the spare is back in place

  render(false);
  render(true);
  expect(push).toHaveBeenCalledTimes(2); // dirty → clean → dirty does not stack spares

  confirm.mockReturnValue(true);
  popSpare();
  expect(back).toHaveBeenCalledTimes(1); // accepted: one more back leaves for real
  popSpare();
  expect(back).toHaveBeenCalledTimes(1); // and the guard is disarmed after that
  expect(confirm).toHaveBeenCalledTimes(2);

  // A form that was dirty once but is clean now: back passes straight through, no question.
  confirm.mockClear();
  render(false);
  render(true);
  expect(push).toHaveBeenCalledTimes(3);
  render(false);
  popSpare();
  expect(confirm).not.toHaveBeenCalled();
  expect(back).toHaveBeenCalledTimes(2);

  // Unmounting while still parked on the spare drops it; after a pass-through there is nothing to drop.
  act(() => root.unmount());
  expect(back).toHaveBeenCalledTimes(2);
  const again = createRoot(container);
  act(() => again.render(<Form dirty />));
  expect(window.history.state).toMatchObject({ puUnsavedSpare: true });
  act(() => again.unmount());
  expect(back).toHaveBeenCalledTimes(3);
  container.remove();
});
