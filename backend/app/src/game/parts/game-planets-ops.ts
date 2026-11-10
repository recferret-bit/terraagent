import { canonicalPlanetById, newId, W11_DEFAULT_SECTOR_RADIUS, type SimCommandV1 } from '@terra/contracts';
import { globalTileToSector, hexDistance } from '@terra/sim';
import type { LoadedInfo, LoadMsg } from '../thread/protocol';

/** Main-thread facts about a load, handed to `onPlanetLoaded` with the thread's `loaded` (never sent to the thread). */
export type HostLoadInfo = Pick<LoadedInfo, 'setupPostings' | 'noSnapshots'>;

export type LoadOptions = Omit<LoadMsg, 't' | 'planetId'> & HostLoadInfo;

export function normalizeLoadOptions(
  planetId: string,
  opts: LoadOptions,
): {
  readonly normalizedMsg: Omit<LoadMsg, 't' | 'planetId'>;
  readonly hostInfo: HostLoadInfo;
} {
  const { setupPostings, noSnapshots, ...msg } = opts;
  const canonical = canonicalPlanetById(planetId);
  const normalizedMsg =
    canonical && !msg.snapshot && msg.params?.radius === undefined
      ? {
          ...msg,
          params: {
            type: msg.params?.type ?? canonical.type,
            seed: msg.params?.seed ?? canonical.seed,
            radius: W11_DEFAULT_SECTOR_RADIUS,
            capacity: msg.params?.capacity ?? 28,
          },
        }
      : msg;
  const hostInfo: HostLoadInfo = {
    ...(setupPostings ? { setupPostings } : {}),
    ...(noSnapshots ? { noSnapshots } : {}),
  };
  return { normalizedMsg, hostInfo };
}

export function normalizeCanonicalSpawnCmd(isCanonical: boolean, cmd: SimCommandV1): SimCommandV1 {
  if (!isCanonical || cmd.kind !== 'system.spawnColony' || !cmd.args || typeof cmd.args !== 'object') {
    return cmd;
  }
  const args = cmd.args as Record<string, unknown>;
  if (
    typeof args.q === 'number' &&
    typeof args.r === 'number' &&
    hexDistance(0, 0, args.q, args.r) > W11_DEFAULT_SECTOR_RADIUS
  ) {
    const local = globalTileToSector(args.q, args.r, W11_DEFAULT_SECTOR_RADIUS);
    return { ...cmd, args: { ...args, q: local.localQ, r: local.localR } };
  }
  return cmd;
}

export function buildCanonicalSpawnRetryCmd(
  isCanonical: boolean,
  cmd: SimCommandV1,
  outOk: boolean,
  outCode?: string,
): SimCommandV1 | null {
  if (
    outOk ||
    !isCanonical ||
    cmd.kind !== 'system.spawnColony' ||
    (outCode !== 'landing_site_taken' && outCode !== 'invalid_args') ||
    !cmd.args ||
    typeof cmd.args !== 'object'
  ) {
    return null;
  }
  const { q: _q, r: _r, sectorId: _s, landingSlotId: _l, ...restArgs } = cmd.args as Record<string, unknown>;
  return { ...cmd, commandId: newId('cm'), args: restArgs };
}

export function collectThreadPlanetIds(
  loaded: ReadonlySet<string>,
  loadingKeys: Iterable<string>,
  cmdWaiterKeys: Iterable<string>,
  threadOf: (planetId: string) => number,
  thread: number,
): string[] {
  const ids = new Set<string>([
    ...loaded,
    ...loadingKeys,
    ...[...cmdWaiterKeys].map((k) => k.split('\0')[0] ?? ''),
  ]);
  return [...ids].filter((id) => Boolean(id) && threadOf(id) === thread);
}
