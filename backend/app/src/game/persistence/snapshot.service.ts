import { Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import type { Logger } from 'pino';
import { Counter, Gauge, Histogram } from 'prom-client';
import { MetricsRegistry } from '../../core/metrics.registry';
import { layerLogger } from '../../core/logging/logger';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { GamePlanets } from '../game-planets.service';
import { SnapshotScheduler } from './snapshot-scheduler';
import { SnapshotStore } from './snapshot-store';

/** SIM-H-06 budget for the SIGTERM snapshot of every loaded planet. */
export const SHUTDOWN_BUDGET_MS = 30_000;

/** Wires the store, the scheduler and `GamePlanets`: periodic + shutdown snapshots, restore on boot, metrics. */
@Injectable()
export class SnapshotService implements BeforeApplicationShutdown {
  private readonly log: Logger;
  private readonly scheduler: SnapshotScheduler;
  private readonly bytes: Gauge;
  private readonly seconds: Histogram;
  private readonly total: Counter<'kind'>;
  /** `SNAPSHOTS=on|off`; unset → on, except under NODE_ENV=test so unit tests never touch the dev database. */
  readonly enabled: boolean;

  constructor(
    private readonly planets: GamePlanets,
    private readonly store: SnapshotStore,
    metrics: MetricsRegistry,
    @Inject(APP_ENV) env: AppEnv,
    @Inject(LOGGER) root: Logger,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    this.enabled = env.SNAPSHOTS === 'on' || (env.SNAPSHOTS !== 'off' && env.NODE_ENV !== 'test');
    const registers = [metrics.registry];
    this.bytes = new Gauge({ name: 'ta_game_snapshot_bytes', help: 'Compressed size of the last saved snapshot', registers });
    this.seconds = new Histogram({ name: 'ta_game_snapshot_save_seconds', help: 'Snapshot compress + write time', buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers });
    this.total = new Counter({ name: 'ta_game_snapshots_total', help: 'Snapshots saved', labelNames: ['kind'], registers });
    const periodMs = Number(env.SNAPSHOT_EVERY_S) * 1000;
    this.scheduler = new SnapshotScheduler(planets, (id, s) => this.write(id, s), periodMs, (id, e) => {
      this.log.error({ planetId: id, err: e instanceof Error ? e.message : String(e) }, 'snapshot save failed');
    });
    if (!this.enabled) return;
    planets.onPlanetLoaded((id) => this.scheduler.track(id));
    planets.onPlanetUnloaded((id) => this.scheduler.untrack(id));
    planets.onPlanetSnapshot((id, s) => this.scheduler.onSnapshot(id, s));
  }

  /** Loads every live planet from its latest snapshot; returns the restored ids. Without a database it logs and restores nothing. */
  async restoreAll(): Promise<string[]> {
    const restored: string[] = [];
    if (!this.enabled) return restored;
    let ids: string[];
    try { ids = await this.store.livePlanetIds(); } catch (e) {
      this.log.error({ err: e instanceof Error ? e.message : String(e) }, 'snapshot restore skipped: database unavailable');
      return restored;
    }
    for (const id of ids) {
      try {
        const snap = await this.store.latest(id, (tick) => this.log.warn({ planetId: id, tick: Number(tick) }, 'corrupt snapshot skipped'));
        if (!snap) continue;
        const tick = await this.planets.load(id, { snapshot: snap.raw });
        this.log.info({ planetId: id, tick, savedAt: snap.savedAt }, `restored ${id} at tick ${tick}`);
        restored.push(id);
      } catch (e) {
        this.log.error({ planetId: id, err: e instanceof Error ? e.message : String(e) }, 'snapshot restore failed');
      }
    }
    return restored;
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (!this.enabled) return;
    const t0 = Date.now();
    const r = await this.scheduler.flushAll('SHUTDOWN', SHUTDOWN_BUDGET_MS);
    this.log.info({ planets: r.planets, ms: Date.now() - t0, timedOut: r.timedOut }, 'shutdown snapshots written');
  }

  private async write(planetId: string, s: { tick: number; bytes: Uint8Array; kind: Parameters<SnapshotStore['save']>[2]; savedAt: Date }): Promise<void> {
    const end = this.seconds.startTimer();
    const saved = await this.store.save(planetId, s.tick, s.kind, s.bytes, s.savedAt);
    end();
    this.bytes.set(saved.sizeBytes);
    this.total.inc({ kind: s.kind });
    this.log.debug({ planetId, tick: s.tick, kind: s.kind, sizeBytes: saved.sizeBytes }, 'snapshot saved');
    void this.store.prune(planetId).catch((e: unknown) => this.log.warn({ planetId, err: String(e) }, 'snapshot prune failed'));
  }
}
