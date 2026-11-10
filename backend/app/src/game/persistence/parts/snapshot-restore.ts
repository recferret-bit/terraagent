import { parseWaves } from '@terra/contracts';
import {
  devPlanetTypeOf,
  GEN_VERSION,
  restore,
  validateAtlasSaveCompatibility,
  type AtlasSaveCompatibilityOptions,
  type WaveFlagsInput,
} from '@terra/sim';
import type { Logger } from 'pino';
import type { HomeRepository } from '../../../core/home/home.repository';
import type { AppEnv } from '../../../core/tokens';
import type { FlagsService } from '../../../flags/flags.service';
import type { GamePlanets } from '../../game-planets.service';
import { hasLiveColony, liveColonyIndices } from '../../live-colony';
import { missedRestartTicks } from '../../restart/missed-ticks';
import { devSnapshotVerdict } from '../dev-planet-verdict';
import type { SnapshotScheduler } from '../snapshot-scheduler';
import type { SnapshotStore } from '../snapshot-store';

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function resolveActiveSnapshotFlags(
  env: AppEnv,
  flags: Pick<FlagsService, 'list' | 'has'> | undefined,
  override?: WaveFlagsInput,
): WaveFlagsInput | undefined {
  if (override !== undefined) return override;
  if (flags) return flags.list;
  if (typeof env.TA_WAVES === 'string') return parseWaves(env.TA_WAVES).list;
  return undefined;
}

export interface RestoreOneDeps {
  readonly store: SnapshotStore;
  readonly planets: GamePlanets;
  readonly scheduler: SnapshotScheduler;
  readonly homes: HomeRepository | undefined;
  readonly log: Logger;
  readonly env: AppEnv;
  readonly flags: Pick<FlagsService, 'list' | 'has'> | undefined;
  readonly nowMs: () => number;
}

/** One live planet: restored, held (snapshots kept, not loaded) or wiped (an old dev planet: generated fresh later). */
export async function restoreOnePlanet(
  deps: RestoreOneDeps,
  id: string,
  options?: AtlasSaveCompatibilityOptions,
): Promise<'restored' | 'held' | 'wiped'> {
  try {
    const snap = await deps.store.latest(id, (tick) =>
      deps.log.warn({ planetId: id, tick: Number(tick) }, 'corrupt snapshot skipped'),
    );
    if (!snap) {
      deps.log.error({ planetId: id }, `held ${id}: every snapshot is corrupt`);
      return 'held';
    }
    const verdict = devSnapshotVerdict(id, snap.raw);
    if (verdict.kind === 'newer') {
      // Written by a newer build: never delete it; leave it unloaded until that build runs again.
      deps.log.warn({ planetId: id, reason: verdict.reason }, `skipped ${id}: snapshot from a newer build`);
      return 'held';
    }
    if (verdict.kind === 'wipe') {
      // Old ground (pre-D-38), an older sim, or not the type its family names: wipe, boot recreates it fresh.
      await deps.store.wipePlanet(id); // the verdict only ever wipes dev planets
      deps.log.warn({ planetId: id, reason: verdict.reason, now: GEN_VERSION }, `wiped ${id}: ${verdict.reason}`);
      return 'wiped';
    }
    const state = verdict.state ?? restore(snap.raw);
    const compat = validateAtlasSaveCompatibility(state, {
      ...options,
      planetId: id,
      flags: resolveActiveSnapshotFlags(deps.env, deps.flags, options?.flags),
    });
    if (!compat.ok) {
      deps.log.error(
        { planetId: id, code: compat.code, reason: compat.reason },
        `held ${id}: incompatible atlas save (${compat.code})`,
      );
      return 'held';
    }
    // A scenario planet (no colony rows: its colonies are the scenario's) stays playable as colony 0 by dev sessions.
    // A planet with colony rows is never marked: its colonies belong to their players (BE-07).
    const isDev = devPlanetTypeOf(id) !== null;
    if (!isDev && hasLiveColony(state) && !(await deps.homes?.listColoniesByPlanetId(id))?.length) {
      deps.planets.markScenarioColonyPlanet(id, liveColonyIndices(state));
    }
    const catchUpTicks = missedRestartTicks(deps.nowMs(), snap.savedAt.getTime()).ticks;
    const tick = await deps.planets.load(id, {
      snapshot: snap.raw,
      ...(catchUpTicks > 0 ? { catchUpTicks } : {}),
    });
    // Fresh savedAt so a second boot does not run this gap again. Skipped when the gap was already under one coarse step.
    if (catchUpTicks > 0) deps.scheduler.request(id, 'PERIODIC');
    deps.log.info({ planetId: id, tick, savedAt: snap.savedAt, catchUpTicks }, `restored ${id} at tick ${tick}`);
    return 'restored';
  } catch (e) {
    deps.log.error({ planetId: id, err: errText(e) }, 'snapshot restore failed');
    return 'held';
  }
}

export function capturePlanetSnapshot(
  scheduler: SnapshotScheduler,
  planetId: string,
  kind: 'SEAL' | 'END',
  budgetMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      scheduler.cancelUnanswered(planetId, finish);
      finish();
    }, budgetMs);
    scheduler.request(planetId, kind, finish);
  });
}
