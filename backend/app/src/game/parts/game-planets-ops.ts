import { canonicalPlanetById, newId, W11_DEFAULT_SECTOR_RADIUS, type AgentDecisionFeedItemV1, type SimCommandV1, type SimInputFeedItemV1 } from '@terra/contracts';
import { globalTileToSector, hexDistance } from '@terra/sim';
import type { SectorSyncPayload } from '../persistence/sector-extract';
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

const MAX_PLANET_RECENT_FEED = 150;

export class PlanetFeedBuffers {
  private readonly inputs = new Map<string, SimInputFeedItemV1[]>();
  private readonly decisions = new Map<string, AgentDecisionFeedItemV1[]>();
  private readonly sectorSync = new Map<string, SectorSyncPayload>();
  private readonly modes = new Map<string, 'active' | 'coarse'>();

  pushFeeds(
    planetId: string,
    items: readonly SimInputFeedItemV1[],
    decs: readonly AgentDecisionFeedItemV1[],
  ): void {
    if (items.length) {
      const list = this.inputs.get(planetId) ?? [];
      list.push(...items);
      if (list.length > MAX_PLANET_RECENT_FEED) list.splice(0, list.length - MAX_PLANET_RECENT_FEED);
      this.inputs.set(planetId, list);
    }
    if (decs.length) {
      const list = this.decisions.get(planetId) ?? [];
      list.push(...decs);
      if (list.length > MAX_PLANET_RECENT_FEED) list.splice(0, list.length - MAX_PLANET_RECENT_FEED);
      this.decisions.set(planetId, list);
    }
  }

  recentInputs(planetId: string, limit = MAX_PLANET_RECENT_FEED): SimInputFeedItemV1[] {
    const list = this.inputs.get(planetId) ?? [];
    return limit >= list.length ? [...list] : list.slice(list.length - limit);
  }

  recentDecisions(planetId: string, limit = MAX_PLANET_RECENT_FEED): AgentDecisionFeedItemV1[] {
    const list = this.decisions.get(planetId) ?? [];
    return limit >= list.length ? [...list] : list.slice(list.length - limit);
  }

  setSectorSync(planetId: string, payload: SectorSyncPayload): void {
    this.sectorSync.set(planetId, payload);
  }

  latestSectorSync(planetId: string): SectorSyncPayload | undefined {
    return this.sectorSync.get(planetId);
  }

  setMode(planetId: string, mode: 'active' | 'coarse'): void {
    this.modes.set(planetId, mode);
  }

  modeOf(planetId: string): 'active' | 'coarse' {
    return this.modes.get(planetId) ?? 'active';
  }

  clearPlanet(planetId: string): void {
    this.inputs.delete(planetId);
    this.decisions.delete(planetId);
    this.sectorSync.delete(planetId);
    this.modes.delete(planetId);
  }
}

export class PlanetUnloadWaiters {
  private readonly waiters = new Map<string, Array<() => void>>();

  wait(planetId: string, sendUnload: () => boolean, fallback: () => void): Promise<void> {
    return new Promise<void>((resolve) => {
      const list = this.waiters.get(planetId) ?? [];
      list.push(resolve);
      this.waiters.set(planetId, list);
      if (!sendUnload()) {
        fallback();
        this.resolve(planetId);
      }
    });
  }

  resolve(planetId: string): void {
    const list = this.waiters.get(planetId);
    if (!list) return;
    this.waiters.delete(planetId);
    for (const fn of list) fn();
  }
}
