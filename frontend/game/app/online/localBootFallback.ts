import {
  createPlanet,
  DEV_PLANET_CAPACITY,
  DEV_PLANET_RADIUS,
  DEV_PLANET_SEED,
  DEV_PLANET_TYPE,
  devPlanetIdFor,
  getSpawnSlots,
  type DevPlanetType,
  type PlanetState,
} from '@terra/sim';
import { LocalHost } from '../../store/local/LocalHost';
import { builtPlanetSource } from '../../store/local/planetSource';
import type { BootAuthResult } from './bootOnline';

/**
 * Graceful local fallback when no backend server is running (dev builds, FA-06): an in-process `LocalHost` (the
 * `LocalHostCore` of `?host=local`, run on the page) on `pl_dev` (`DEV_PLANET_TYPE` = desert, `DEV_PLANET_SEED`,
 * `DEV_PLANET_RADIUS`) with colony 0 seated at the first spawn slot by `system.spawnColony`.
 */
export function createLocalBootFallback(
  deviceSecret: string,
  onStatus?: (status: string) => void,
  spawnOverride?: { q: number; r: number },
  planetType: DevPlanetType = DEV_PLANET_TYPE,
  flagsOverride?: readonly string[],
): BootAuthResult {
  const planetId = devPlanetIdFor(planetType, 1);
  onStatus?.(`Entering orbit: ${planetId}…`);
  const make = () =>
    createPlanet({
      id: planetId,
      planetId,
      type: planetType,
      planetType,
      seed: DEV_PLANET_SEED,
      radius: DEV_PLANET_RADIUS,
      capacity: DEV_PLANET_CAPACITY,
    });
  let first: PlanetState | null = make();
  const slot = spawnOverride ?? getSpawnSlots(first)[0] ?? { q: 0, r: 0 };
  const flags = flagsOverride ? [...flagsOverride] : ['W00', 'W01'];
  const fresh = (): PlanetState => {
    const p = first ?? make();
    first = null;
    return p;
  };
  const source = builtPlanetSource(planetId, flags, fresh, (host) => {
    host.submit({
      colonyIndex: 0,
      source: 'system',
      commandId: 'cm_boot_spawn',
      kind: 'system.spawnColony',
      args: { colonyId: 'col_0', colonyIndex: 0, name: "Colonist's Colony", q: slot.q, r: slot.r },
    });
    if (flags.includes('W18')) {
      host.submit({
        colonyIndex: 0,
        source: 'system',
        commandId: 'cm_boot_seed_rivals',
        kind: 'system.seedRivalAi',
        args: { count: 2 },
      });
    }
    host.step(1);
  });
  const localHost = new LocalHost({ flags, source });

  return {
    mode: 'local',
    accessToken: `local:${deviceSecret.slice(0, 16)}`,
    deviceSecret,
    playerId: 'pr_local',
    handle: 'Colonist',
    isGuest: true,
    state: 'ACTIVE',
    planet: {
      id: planetId,
      name: 'Dev Planet',
      type: planetType,
      seed: DEV_PLANET_SEED,
      radius: DEV_PLANET_RADIUS,
      state: 'ACTIVE',
    },
    colony: {
      id: 'col_0',
      colonyIndex: 0,
      name: "Colonist's Colony",
      color: 0,
      state: 'ACTIVE',
      spawnQ: slot.q,
      spawnR: slot.r,
      spawn: { q: slot.q, r: slot.r },
    },
    localHost,
  };
}
