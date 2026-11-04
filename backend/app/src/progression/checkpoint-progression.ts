import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ProgressEventV1Schema, type ProgressEventV1 } from '@terra/contracts';
import type { PrismaClient, TransactionClient } from '@terra/db';
import { persistenceEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { PRISMA } from '../db/db.module.js';
import { ProgressionEngine } from './progression-engine.js';

/** Only checkpointed inputs can grant lifetime rewards. Uncheckpointed world progress rolls back together. */
@Injectable()
export class CheckpointProgression implements OnModuleInit, OnModuleDestroy {
  readonly enabled: boolean;
  private readonly paused: boolean;
  private readonly pending = new Map<string, ProgressEventV1[]>();
  private readonly log = new Logger('CheckpointProgression');
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(@Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ProgressionEngine) private readonly engine: ProgressionEngine,
    @Inject(APP_ENV) env: AppEnv) { this.enabled = persistenceEnabled(env); this.paused = env.PROGRESSION_WORKERS === 'off'; }

  stage(event: ProgressEventV1): void {
    const parsed = ProgressEventV1Schema.parse(event);
    const list = this.pending.get(parsed.planetId) ?? [];
    list.push(parsed);
    this.pending.set(parsed.planetId, list);
  }

  discardUncommitted(planetId: string): void { this.pending.delete(planetId); }

  batch(planetId: string, tick: number): readonly ProgressEventV1[] {
    return (this.pending.get(planetId) ?? []).filter(e => e.atTick <= tick);
  }

  async persist(tx: TransactionClient, planetId: string, batch: readonly ProgressEventV1[]): Promise<void> {
    if (!batch.length) return;
    const incarnation = await tx.progressionEpoch.upsert({ where: { planetId },
      create: { planetId, epoch: randomUUID() }, update: {} });
    await tx.progressionInbox.createMany({ data: batch.map((event, index) => {
      const id = `${incarnation.epoch}:${event.eventId ?? `${event.atTick}:${index}`}`;
      return { id, planetId, tick: event.atTick, payload: { ...event, eventId: id } };
    }), skipDuplicates: true });
  }

  committed(planetId: string, batch: readonly ProgressEventV1[]): void {
    const saved = new Set(batch);
    const remaining = (this.pending.get(planetId) ?? []).filter(e => !saved.has(e));
    if (remaining.length) this.pending.set(planetId, remaining);
    else this.pending.delete(planetId);
  }

  async replay(): Promise<void> {
    const rows = await this.db.progressionInbox.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 });
    for (const row of rows) {
      try {
        await this.engine.apply(ProgressEventV1Schema.parse(row.payload));
        await this.db.progressionInbox.deleteMany({ where: { id: row.id } });
      } catch (error) { this.log.error(`Retaining input ${row.id} for retry: ${String(error)}`); }
    }
  }

  onModuleInit(): void {
    if (!this.enabled || this.paused) return;
    const poll = () => {
      if (this.running) return;
      this.running = this.replay().catch(error => this.log.error(String(error))).finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(poll, 1000);
    this.timer.unref();
    poll();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
