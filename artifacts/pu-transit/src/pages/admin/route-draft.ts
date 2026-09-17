export type Stop = { lat: number; lng: number; name?: string };

type Endpoints = { origin: string; destination: string };

/**
 * The stop list is the route: the first stop is where it starts, the last is where it ends. The
 * start/end labels riders search by follow those two stops while the admin has not written their
 * own — empty, or still equal to the stop name they were copied from. Once edited by hand they stay.
 */
export function followEndpoints(previous: Endpoints & { stops: Stop[] }, stops: Stop[]): Endpoints {
  const name = (stop: Stop | undefined) => stop?.name?.trim() ?? '';
  const follows = (label: string, previousStop: Stop | undefined) => label.trim() === '' || label === name(previousStop);
  return {
    origin: follows(previous.origin, previous.stops[0]) ? name(stops[0]) : previous.origin,
    destination: follows(previous.destination, previous.stops[previous.stops.length - 1]) ? name(stops[stops.length - 1]) : previous.destination,
  };
}
