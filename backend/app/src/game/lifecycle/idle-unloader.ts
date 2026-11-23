import type { PrismaClient } from '@terra/db';
import type { Logger } from 'pino';
import { isIdle } from './idle-policy';
import type { PlanetActivityStore } from './planet-activity.store';

/** Budget of the SEAL snapshot taken before an idle unload. */
export const SEAL_BUDGET_MS = 15_000;

export type IdleUnloadOutcome = 'unloaded' | 'not_loaded' | 'persistence_off' | 'human_returned';

export interface IdleUnloadDeps {
  readonly snapshots: { readonly enabled: boolean; capture(planetId: string, kind: 'SEAL', budgetMs?: number): Promise<void> };
  readonly planets: { isLoaded(planetId: string): boolean; unload(planetId: string): Promise<void> };
  readonly sectorState?: { flushPlanet(planetId: string): Promise<unknown> };
  readonly store: PlanetActivityStore;
  /** `saved_at` of the newest snapshot row of the planet. */
  latestSnapshotAt(planetId: string): Promise<Date | null>;
  /** Zeroes the planet's lease counts so no replica reclaims (restores) a dormant planet. */
  quietLease(planetId: string): Promise<void>;
  readonly idleMs: number;
  readonly now: () => number;
  readonly log?: Pick<Logger, 'info' | 'warn'>;
}

/**
 * Snapshots (`SEAL`) and unloads an idle planet (3.5). Never without persistence, and never unless the SEAL row is
 * stored (`capture` also resolves on its timeout): the job throws and is retried instead. A human who came back
 * while the snapshot was written keeps the planet loaded. The dormant mark is written before the unload, so boot
 * restore and lease reclaim skip the planet from then on; the sim stops, and with it the planet's AI and bots.
 */
export async function unloadIdlePlanet(deps: IdleUnloadDeps, planetId: string): Promise<IdleUnloadOutcome> {
  if (!deps.snapshots.enabled) return 'persistence_off';
  if (!deps.planets.isLoaded(planetId)) return 'not_loaded';
  const started = Date.now();
  await deps.snapshots.capture(planetId, 'SEAL', SEAL_BUDGET_MS);
  const savedAt = await deps.latestSnapshotAt(planetId);
  if (!savedAt || savedAt.getTime() < started) throw new Error(`idle unload of ${planetId}: no SEAL snapshot was stored`);
  const row = await deps.store.get(planetId);
  if (row && !isIdle(row, deps.now(), deps.idleMs)) return 'human_returned';
  await deps.store.markDormant(planetId, new Date(deps.now()));
  await deps.sectorState?.flushPlanet(planetId).catch(() => undefined);
  // Last look before the planet goes down: a player who joined while the snapshot and the flush were written (their
  // socket stamped the clock) keeps the planet, instead of being dropped and rolled back to the snapshot.
  const latest = await deps.store.get(planetId);
  if (latest && row && latest.lastHumanSeenAt.getTime() > row.lastHumanSeenAt.getTime()) {
    await deps.store.wake(planetId, latest.lastHumanSeenAt);
    return 'human_returned';
  }
  await deps.planets.unload(planetId);
  await deps.quietLease(planetId);
  deps.log?.info({ planetId, lastHumanSeenAt: row?.lastHumanSeenAt }, `idle-unloaded ${planetId}`);
  return 'unloaded';
}

/** The Postgres side of {@link IdleUnloadDeps}. */
export function prismaUnloadDeps(prisma: PrismaClient): Pick<IdleUnloadDeps, 'latestSnapshotAt' | 'quietLease'> {
  return {
    async latestSnapshotAt(planetId) {
      const row = await prisma.planetSnapshot.findFirst({ where: { planetId }, orderBy: { tick: 'desc' }, select: { savedAt: true } });
      return row?.savedAt ?? null;
    },
    async quietLease(planetId) {
      await prisma.simWorkerLease.updateMany({ where: { planetId }, data: { alivePlayers: 0, aliveBots: 0, expiresAt: new Date() } });
    },
  };
}
