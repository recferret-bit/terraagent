import type { Logger } from 'pino';
import type { GamePlanets } from './game-planets.service';
import type { SnapshotService } from './persistence/snapshot.service';
import type { SimThreadPool } from './sim-thread-pool';

/** A dead sim thread is restarted at most this many times per {@link THREAD_RESTART_WINDOW_MS}, then left down (readiness fails). */
export const THREAD_RESTART_LIMIT = 3;
export const THREAD_RESTART_WINDOW_MS = 10 * 60_000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Brings planets back after they went down (BE-11/BE-12): a dead thread is spawned again and its planets restored from
 * their latest snapshots; a planet whose step threw is restored on its (live) thread. `SnapshotService.recover` caps
 * restores per planet; threads are capped here. Returns an unsubscribe.
 */
export function wirePlanetRecovery(
  planets: Pick<GamePlanets, 'onPlanetDown' | 'onThreadDown'>,
  pool: Pick<SimThreadPool, 'restart'>,
  snapshots: Pick<SnapshotService, 'recover'>,
  log: Pick<Logger, 'error' | 'warn' | 'info'>,
  now: () => number = Date.now,
): () => void {
  const restarts = new Map<number, number[]>();
  const offDown = planets.onPlanetDown((planetId, reason, detail) => {
    log.error({ planetId, reason, detail }, `planet ${planetId} went down (${reason}): ${detail}`);
    if (reason === 'step_failed') void recover([planetId]);
  });
  const offThread = planets.onThreadDown((thread, planetIds) => void restartThread(thread, planetIds));

  async function recover(planetIds: readonly string[]): Promise<void> {
    try {
      const back = await snapshots.recover(planetIds);
      if (back.length) log.warn({ planets: back }, `restored ${back.join(', ')} from their latest snapshots`);
    } catch (e) {
      log.error({ planets: planetIds, err: errText(e) }, 'planet recovery failed');
    }
  }

  async function restartThread(thread: number, planetIds: readonly string[]): Promise<void> {
    const t = now();
    const recent = (restarts.get(thread) ?? []).filter((x) => t - x < THREAD_RESTART_WINDOW_MS);
    if (recent.length >= THREAD_RESTART_LIMIT) {
      log.error({ thread, restarts: recent.length }, `sim thread ${thread} died again: left down (readiness fails)`);
      return;
    }
    restarts.set(thread, [...recent, t]);
    try {
      await pool.restart(thread);
      log.warn({ thread, planets: planetIds }, `sim thread ${thread} died and was restarted`);
    } catch (e) {
      log.error({ thread, err: errText(e) }, `sim thread ${thread} could not be restarted`);
      return;
    }
    await recover(planetIds);
  }

  return () => { offDown(); offThread(); };
}
