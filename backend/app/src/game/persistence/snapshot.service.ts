import { CheckpointProgression } from '../../progression/checkpoint-progression.js';
import { Inject, Injectable, Optional, type BeforeApplicationShutdown } from '@nestjs/common';
import { devPlanetTypeOf, GEN_VERSION, restore } from '@terra/sim';
import type { Logger } from 'pino';
import { Counter, Gauge, Histogram } from 'prom-client';
import { MetricsRegistry } from '../../core/metrics.registry';
import { layerLogger } from '../../core/logging/logger';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { HomeRepository } from '../../core/home/home.repository';
import { GamePlanets, type LoadOptions } from '../game-planets.service';
import { hasLiveColony, liveColonyIndices } from '../live-colony';
import { PlanetLedgerService } from '../ledger/planet-ledger.service';
import { persistenceEnabled } from '../../core/persistence';
import { SnapshotScheduler } from './snapshot-scheduler';
import { SnapshotStore } from './snapshot-store';
import { devSnapshotVerdict } from './dev-planet-verdict';

/** A planet that went down is restored from its snapshot at most this many times per {@link RECOVER_WINDOW_MS}, then held. */
export const RECOVER_LIMIT = 3;
export const RECOVER_WINDOW_MS = 10 * 60_000;

/** SIM-H-06 budget for the SIGTERM snapshot of every loaded planet. */
export const SHUTDOWN_BUDGET_MS = 30_000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the boot restore did (see {@link SnapshotService.restoreAll}). */
export interface RestoreReport {
  readonly restored: readonly string[];
  /** Planets with snapshots left unloaded: never generate them fresh. */
  readonly held: readonly string[];
  /** `livePlanetIds` failed: which planets have snapshots is unknown, so none may be generated fresh. */
  readonly dbUnavailable: boolean;
}

/** A planet that must not be generated fresh: it has snapshots (or that cannot be checked) but is not loaded. */
export class PlanetHeldError extends Error {
  constructor(readonly planetId: string, why: string) {
    super(`planet ${planetId} cannot be loaded as a new planet: ${why}`);
    this.name = 'PlanetHeldError';
  }
}

/** Wires the store, the scheduler and `GamePlanets`: periodic + shutdown snapshots, restore on boot, metrics. */
@Injectable()
export class SnapshotService implements BeforeApplicationShutdown {
  private readonly log: Logger;
  private readonly scheduler: SnapshotScheduler;
  private readonly bytes: Gauge;
  private readonly seconds: Histogram;
  private readonly total: Counter<'kind'>;
  /** Recent recovery times per planet (BE-11/BE-12), to stop restoring a planet that keeps failing. */
  private readonly recoveries = new Map<string, number[]>();
  /** `SNAPSHOTS=on|off`; unset → on, except under NODE_ENV=test so unit tests never touch the dev database. */
  readonly enabled: boolean;

  constructor(
    private readonly planets: GamePlanets,
    private readonly store: SnapshotStore,
    metrics: MetricsRegistry,
    @Inject(APP_ENV) env: AppEnv,
    @Inject(LOGGER) root: Logger,
    /** Each snapshot write waits for the planet's queued journal writes, so a saved snapshot at T has its rows ≤ T. */
    @Optional() private readonly ledger?: PlanetLedgerService,
    /** Colony rows: a restored planet with rows is never marked as a scenario planet (BE-07). */
    @Optional() private readonly homes?: HomeRepository,
    @Optional() private readonly progression?: CheckpointProgression,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    this.enabled = persistenceEnabled(env);
    const registers = [metrics.registry];
    this.bytes = new Gauge({ name: 'ta_game_snapshot_bytes', help: 'Compressed size of the last saved snapshot', registers });
    this.seconds = new Histogram({ name: 'ta_game_snapshot_save_seconds', help: 'Snapshot compress + write time', buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers });
    this.total = new Counter({ name: 'ta_game_snapshots_total', help: 'Snapshots saved', labelNames: ['kind'], registers });
    const periodMs = Number(env.SNAPSHOT_EVERY_S) * 1000;
    this.scheduler = new SnapshotScheduler(planets, (id, s) => this.write(id, s), periodMs, (id, e) => {
      this.log.error({ planetId: id, err: errText(e) }, 'snapshot save failed');
    });
    if (!this.enabled) return;
    planets.onPlanetLoaded((id) => { this.progression?.discardUncommitted(id); this.scheduler.track(id); });
    planets.onPlanetUnloaded((id) => this.scheduler.untrack(id));
    planets.onPlanetSnapshot((id, s) => this.scheduler.onSnapshot(id, s));
  }

  /**
   * Loads every live planet from its latest snapshot. The report separates the planets restored from those `held`
   * (they have snapshots but stay unloaded: written by a newer build, every snapshot corrupt, or the restore failed)
   * and says when the database was unavailable (nothing is known then). Neither held planets nor any planet while the
   * database is down may be generated fresh: that would replace their world and wipe their journal.
   */
  async restoreAll(): Promise<RestoreReport> {
    const report = { restored: [] as string[], held: [] as string[], dbUnavailable: false };
    if (!this.enabled) return report;
    let ids: string[];
    try { ids = await this.store.livePlanetIds(); } catch (e) {
      this.log.error({ err: errText(e) }, 'snapshot restore skipped: database unavailable (no planet is generated fresh)');
      return { ...report, dbUnavailable: true };
    }
    for (const id of ids) {
      const outcome = await this.restore(id);
      if (outcome === 'restored') report.restored.push(id);
      else if (outcome === 'held') report.held.push(id);
    }
    return report;
  }

  /**
   * Loads a planet that has no snapshots as a new (generated) planet, telling the ledger so (`noSnapshots`: rows under
   * its id are an older planet's). Already loaded: nothing to do. Throws {@link PlanetHeldError} when the planet has
   * snapshots, or when that cannot be checked (database down), since generating it fresh would replace its world.
   */
  async loadNew(planetId: string, opts: LoadOptions = {}): Promise<void> {
    if (this.planets.isLoaded(planetId)) return;
    let has: boolean;
    try { has = this.enabled && (await this.store.hasSnapshots(planetId)); } catch (e) {
      this.log.error({ planetId, err: errText(e) }, `not generating ${planetId}: cannot check its snapshots`);
      throw new PlanetHeldError(planetId, 'its snapshots cannot be checked (database unavailable)');
    }
    if (has) {
      this.log.warn({ planetId }, `not generating ${planetId}: it has snapshots but is not loaded`);
      throw new PlanetHeldError(planetId, 'it has snapshots but is not loaded (newer build, corrupt or failed restore)');
    }
    await this.planets.ensureLoaded(planetId, { ...opts, noSnapshots: true });
  }

  /**
   * Loads a planet that is not loaded: restored from its latest snapshot when it has one, else generated fresh (BE-14:
   * an existing home whose planet was not restored at boot). Throws {@link PlanetHeldError} when it has snapshots that
   * cannot be restored.
   */
  async loadHome(planetId: string, opts: LoadOptions): Promise<'loaded' | 'restored' | 'generated'> {
    if (this.planets.isLoaded(planetId)) return 'loaded';
    if (this.enabled && (await this.store.hasSnapshots(planetId))) {
      const outcome = await this.restore(planetId);
      if (outcome !== 'restored') throw new PlanetHeldError(planetId, outcome === 'held' ? 'its snapshots cannot be restored' : 'it was wiped as an old dev planet');
      return 'restored';
    }
    await this.loadNew(planetId, opts);
    return 'generated';
  }

  /**
   * Planets that went down (their thread died, or a step threw: BE-11/BE-12) are restored from their latest snapshot,
   * at most {@link RECOVER_LIMIT} times per planet per {@link RECOVER_WINDOW_MS} (a planet that keeps failing is held).
   * Without persistence, or without snapshots, they stay unloaded. Returns the planets restored.
   */
  async recover(planetIds: readonly string[], now = Date.now()): Promise<string[]> {
    const restored: string[] = [];
    for (const id of planetIds) {
      const recent = (this.recoveries.get(id) ?? []).filter((t) => now - t < RECOVER_WINDOW_MS);
      if (recent.length >= RECOVER_LIMIT) {
        this.log.error({ planetId: id, recoveries: recent.length }, `held ${id}: it went down ${recent.length} times in ${RECOVER_WINDOW_MS / 60_000} min`);
        continue;
      }
      this.recoveries.set(id, [...recent, now]);
      if (!this.enabled || this.planets.isLoaded(id)) continue;
      const has = await this.store.hasSnapshots(id).catch(() => false);
      if (has && (await this.restore(id)) === 'restored') restored.push(id);
      else this.log.error({ planetId: id }, `${id} stays unloaded after going down: no snapshot restored`);
    }
    return restored;
  }

  /**
   * Dev `planet.wipe` (LED-06): deletes a planet that is not loaded (a held one) with its snapshots, journal and colony
   * rows, so it can start fresh. Refuses a loaded planet.
   */
  async wipe(planetId: string): Promise<void> {
    if (this.planets.isLoaded(planetId)) throw new Error(`planet ${planetId} is loaded: only an unloaded (held) planet can be wiped`);
    if (this.enabled) await this.store.wipePlanet(planetId);
    await this.homes?.deleteColoniesOfPlanet(planetId); // drops the colony cache (the rows are already gone)
    this.recoveries.delete(planetId);
    this.log.warn({ planetId }, `wiped ${planetId} (dev planet.wipe)`);
  }

  /** One live planet: restored, held (snapshots kept, not loaded) or wiped (an old dev planet: generated fresh later). */
  async restore(id: string): Promise<'restored' | 'held' | 'wiped'> {
    try {
      const snap = await this.store.latest(id, (tick) => this.log.warn({ planetId: id, tick: Number(tick) }, 'corrupt snapshot skipped'));
      if (!snap) {
        this.log.error({ planetId: id }, `held ${id}: every snapshot is corrupt`);
        return 'held';
      }
      const verdict = devSnapshotVerdict(id, snap.raw);
      if (verdict.kind === 'newer') {
        // Written by a newer build: never delete it; leave it unloaded until that build runs again.
        this.log.warn({ planetId: id, reason: verdict.reason }, `skipped ${id}: snapshot from a newer build`);
        return 'held';
      }
      if (verdict.kind === 'wipe') {
        // Old ground (pre-D-38), an older sim, or not the type its family names: wipe, boot recreates it fresh.
        await this.store.wipePlanet(id); // the verdict only ever wipes dev planets
        this.log.warn({ planetId: id, reason: verdict.reason, now: GEN_VERSION }, `wiped ${id}: ${verdict.reason}`);
        return 'wiped';
      }
      // A scenario planet (no colony rows: its colonies are the scenario's) stays playable as colony 0 by dev sessions.
      // A planet with colony rows is never marked: its colonies belong to their players (BE-07).
      const isDev = devPlanetTypeOf(id) !== null;
      const restored = verdict.state ?? restore(snap.raw);
      if (!isDev && hasLiveColony(restored) && !(await this.homes?.listColoniesByPlanetId(id))?.length) {
        this.planets.markScenarioColonyPlanet(id, liveColonyIndices(restored));
      }
      const tick = await this.planets.load(id, { snapshot: snap.raw });
      this.log.info({ planetId: id, tick, savedAt: snap.savedAt }, `restored ${id} at tick ${tick}`);
      return 'restored';
    } catch (e) {
      this.log.error({ planetId: id, err: errText(e) }, 'snapshot restore failed');
      return 'held';
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (!this.enabled) return;
    const t0 = Date.now();
    const r = await this.scheduler.flushAll('SHUTDOWN', SHUTDOWN_BUDGET_MS);
    this.log.info({ planets: r.planets, ms: Date.now() - t0, timedOut: r.timedOut }, 'shutdown snapshots written');
  }

  private async write(planetId: string, s: { tick: number; bytes: Uint8Array; kind: Parameters<SnapshotStore['save']>[2]; savedAt: Date }): Promise<void> {
    await this.ledger?.settled(planetId); // the `ledger` messages of ticks ≤ s.tick arrived before this snapshot
    const unwritten = this.ledger?.isStopped() ? this.ledger.unwrittenRows(planetId) : 0;
    if (unwritten > 0) {
      // The ledger gave up at shutdown: a snapshot at s.tick would be ahead of the journal rows (a restore from it
      // would open the journal short of rows ≤ s.tick). Keep the previous snapshot, whose rows are written.
      this.log.error({ planetId, tick: s.tick, kind: s.kind, unwritten }, `snapshot of ${planetId} not saved: ${unwritten} ledger rows are unwritten`);
      return;
    }
    const end = this.seconds.startTimer();
    const saved = await this.store.save(planetId, s.tick, s.kind, s.bytes, s.savedAt);
    end();
    this.bytes.set(saved.sizeBytes);
    this.total.inc({ kind: s.kind });
    this.log.debug({ planetId, tick: s.tick, kind: s.kind, sizeBytes: saved.sizeBytes }, 'snapshot saved');
    void this.store.prune(planetId).catch((e: unknown) => this.log.warn({ planetId, err: String(e) }, 'snapshot prune failed'));
  }
}
