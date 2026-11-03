import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CurrentColonySummary, PastColonyOutcome, PastColonySummary } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { PRISMA } from '../db/db.module.js';

export const W12_SEED_CURRENT_COLONIES: readonly CurrentColonySummary[] = [
  {
    colonyId: 'co_w12_live_1',
    name: 'Aegis Basin',
    planetId: 'pl_w12_forest',
    planetName: 'Sylva Reach',
    planetType: 'temperate',
    stage: 4,
    status: 'active',
    foundedAt: '2026-10-25T08:00:00.000Z',
  },
];

export const W12_SEED_PAST_COLONIES: readonly PastColonySummary[] = [
  {
    colonyId: 'co_w12_past_1',
    name: 'Cinder Outpost',
    planetId: 'pl_w12_dune',
    planetName: 'Helios Prime',
    planetType: 'desert',
    stageReached: 3,
    outcome: 'eliminated',
    foundedAt: '2026-10-02T09:00:00.000Z',
    endedAt: '2026-10-08T19:30:00.000Z',
  },
  {
    colonyId: 'co_w12_past_2',
    name: 'Verdant Spire',
    planetId: 'pl_w12_ocean',
    planetName: 'Thalassa IV',
    planetType: 'ocean',
    stageReached: 10,
    outcome: 'settled',
    foundedAt: '2026-10-10T14:00:00.000Z',
    endedAt: '2026-10-21T22:15:00.000Z',
  },
];

/** In-memory store for current and past colony summaries on `/me` (W12-09). */
export class InMemoryColonyHistoryStore {
  private readonly pastByPlayer = new Map<string, PastColonySummary[]>();
  private readonly currentByPlayer = new Map<string, CurrentColonySummary[]>();

  async getPast(playerId: string): Promise<PastColonySummary[]> {
    return [...(this.pastByPlayer.get(playerId) ?? [])];
  }

  async getCurrent(playerId: string): Promise<CurrentColonySummary[]> {
    return [...(this.currentByPlayer.get(playerId) ?? [])];
  }

  async setPast(playerId: string, rows: readonly PastColonySummary[]): Promise<void> {
    this.pastByPlayer.set(playerId, [...rows]);
  }

  async setCurrent(playerId: string, rows: readonly CurrentColonySummary[]): Promise<void> {
    this.currentByPlayer.set(playerId, [...rows]);
  }

  async reset(playerId: string): Promise<void> {
    this.pastByPlayer.delete(playerId);
    this.currentByPlayer.delete(playerId);
  }
}

/** Postgres-backed `core.colony_history` + in-memory fallback store (W12-09). */
@Injectable()
export class ColonyHistoryStore {
  private readonly mem = new InMemoryColonyHistoryStore();
  private readonly useDb: boolean;

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.useDb = Boolean(this.prisma && (!env || databaseEnabled(env)));
  }

  async getPast(playerId: string): Promise<PastColonySummary[]> {
    const memRows = await this.mem.getPast(playerId);
    if (!this.useDb || !this.prisma) return memRows;
    const rows = await this.prisma.colonyHistory.findMany({
      where: { playerId },
      orderBy: { endedAt: 'desc' },
    });
    if (rows.length === 0) return memRows;
    return rows.map((r) => ({
      colonyId: r.colonyId,
      name: r.name,
      planetId: r.planetId,
      planetName: r.planetName,
      planetType: r.planetType,
      stageReached: r.stageReached,
      outcome: r.outcome as PastColonyOutcome,
      foundedAt: r.foundedAt.toISOString(),
      endedAt: r.endedAt.toISOString(),
    }));
  }

  async getCurrent(playerId: string): Promise<CurrentColonySummary[]> {
    return this.mem.getCurrent(playerId);
  }

  async setCurrent(playerId: string, rows: readonly CurrentColonySummary[]): Promise<void> {
    await this.mem.setCurrent(playerId, rows);
  }

  async setPast(playerId: string, rows: readonly PastColonySummary[]): Promise<void> {
    await this.mem.setPast(playerId, rows);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.colonyHistory.deleteMany({ where: { playerId } });
    if (rows.length === 0) return;
    await this.prisma.colonyHistory.createMany({
      data: rows.map((r) => ({
        id: `ch_${randomUUID()}`,
        playerId,
        colonyId: r.colonyId,
        planetId: r.planetId,
        planetName: r.planetName,
        planetType: r.planetType,
        name: r.name,
        stageReached: r.stageReached,
        outcome: r.outcome,
        foundedAt: new Date(r.foundedAt),
        endedAt: new Date(r.endedAt),
      })),
    });
  }

  async seedW12Colonies(playerId: string): Promise<void> {
    await this.setCurrent(playerId, W12_SEED_CURRENT_COLONIES);
    await this.setPast(playerId, W12_SEED_PAST_COLONIES);
  }

  async reset(playerId: string): Promise<void> {
    await this.mem.reset(playerId);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.colonyHistory.deleteMany({ where: { playerId } });
  }
}
