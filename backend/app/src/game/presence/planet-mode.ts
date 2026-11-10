import type { StepMode } from '@terra/sim';

/** Socket counts the step mode follows. The 60s away timer is not this switch. */
export interface PlanetSocketQuery {
  socketsOn(planetId: string): number;
  planetOf(socketId: string): string | undefined;
}

export interface PlanetModePort {
  setMode(planetId: string, mode: StepMode): void;
}

/** Sends `active` or `coarse` only when the planet crosses zero sockets. A repeat join does not call `setMode`. */
export function syncPlanetMode(presence: PlanetSocketQuery, modes: PlanetModePort, planetId: string, before: number): void {
  const after = presence.socketsOn(planetId);
  if (before <= 0 && after >= 1) modes.setMode(planetId, 'active');
  else if (before >= 1 && after <= 0) modes.setMode(planetId, 'coarse');
}

/** Wraps `join`. A socket that changes planet can leave the old one with no sockets. */
export function presenceJoined(
  presence: PlanetSocketQuery,
  modes: PlanetModePort,
  socketId: string,
  planetId: string,
  join: () => void,
): void {
  const prevPlanet = presence.planetOf(socketId);
  const prevBefore = prevPlanet ? presence.socketsOn(prevPlanet) : 0;
  const nextBefore = presence.socketsOn(planetId);
  join();
  if (prevPlanet && prevPlanet !== planetId) syncPlanetMode(presence, modes, prevPlanet, prevBefore);
  syncPlanetMode(presence, modes, planetId, nextBefore);
}

/** Wraps `close`. The planet is read first: the socket row is gone afterwards, and the gateway has cleared its own copy. */
export function presenceClosed(presence: PlanetSocketQuery, modes: PlanetModePort, socketId: string, close: () => void): void {
  const planetId = presence.planetOf(socketId);
  const before = planetId ? presence.socketsOn(planetId) : 0;
  close();
  if (planetId) syncPlanetMode(presence, modes, planetId, before);
}
