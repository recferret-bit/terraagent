import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ACHIEVEMENT_FAMILY_BY_ID,
  type AchievementFamilyId,
  type AchievementMetric,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { PRISMA } from '../db/db.module.js';

export interface FactUpdateResult {
  readonly playerId: string;
  readonly family: AchievementFamilyId;
  readonly metric: AchievementMetric;
  readonly previousValue: number;
  readonly value: number;
}

export interface FactsStorePort {
  update(
    playerId: string,
    family: AchievementFamilyId,
    valueOrDelta: number,
    metricOverride?: AchievementMetric,
  ): Promise<FactUpdateResult>;
  get(playerId: string, family: AchievementFamilyId): Promise<number>;
  getAll(playerId: string): Promise<Record<string, number>>;
  setAll(playerId: string, facts: Readonly<Record<string, number>>): Promise<void>;
  reset(playerId: string): Promise<void>;
}

function defaultMetric(family: AchievementFamilyId, override?: AchievementMetric): AchievementMetric {
  if (override) return override;
  return ACHIEVEMENT_FAMILY_BY_ID.get(family)?.metric ?? 'counter';
}

function sanitizeNonNegative(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/** In-memory facts store used in unit tests and fallback when Postgres is disabled. */
export class InMemoryFactsStore implements FactsStorePort {
  private readonly rows = new Map<string, Map<AchievementFamilyId, { metric: AchievementMetric; value: number }>>();

  async update(
    playerId: string,
    family: AchievementFamilyId,
    valueOrDelta: number,
    metricOverride?: AchievementMetric,
  ): Promise<FactUpdateResult> {
    const metric = defaultMetric(family, metricOverride);
    const input = sanitizeNonNegative(valueOrDelta);
    let playerMap = this.rows.get(playerId);
    if (!playerMap) {
      playerMap = new Map();
      this.rows.set(playerId, playerMap);
    }
    const existing = playerMap.get(family);
    const previousValue = existing?.value ?? 0;
    const nextValue = metric === 'max' ? Math.max(previousValue, input) : previousValue + input;
    playerMap.set(family, { metric, value: nextValue });
    return { playerId, family, metric, previousValue, value: nextValue };
  }

  async get(playerId: string, family: AchievementFamilyId): Promise<number> {
    return this.rows.get(playerId)?.get(family)?.value ?? 0;
  }

  async getAll(playerId: string): Promise<Record<string, number>> {
    const map = this.rows.get(playerId);
    if (!map) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of map.entries()) out[k] = v.value;
    return out;
  }

  async setAll(playerId: string, facts: Readonly<Record<string, number>>): Promise<void> {
    const map = new Map<AchievementFamilyId, { metric: AchievementMetric; value: number }>();
    for (const [k, v] of Object.entries(facts)) {
      const fam = k as AchievementFamilyId;
      map.set(fam, { metric: defaultMetric(fam), value: sanitizeNonNegative(v) });
    }
    this.rows.set(playerId, map);
  }

  async reset(playerId: string): Promise<void> {
    this.rows.delete(playerId);
  }
}

/** Postgres-backed `core.player_fact` store with atomic `counter` addition and `max` GREATEST(old, new) (W12-02). */
@Injectable()
export class FactsStore implements FactsStorePort {
  private readonly mem = new InMemoryFactsStore();
  private readonly useDb: boolean;

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.useDb = Boolean(this.prisma && (!env || databaseEnabled(env)));
  }

  async update(
    playerId: string,
    family: AchievementFamilyId,
    valueOrDelta: number,
    metricOverride?: AchievementMetric,
  ): Promise<FactUpdateResult> {
    const memRes = await this.mem.update(playerId, family, valueOrDelta, metricOverride);
    if (!this.useDb || !this.prisma) return memRes;

    const metric = memRes.metric;
    const input = sanitizeNonNegative(valueOrDelta);
    const prevRow = await this.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId, family } },
      select: { value: true },
    });
    const previousValue = prevRow?.value ?? 0;
    if (metric === 'max') {
      const nextValue = Math.max(previousValue, input);
      await this.prisma.$executeRaw`
        INSERT INTO "core"."player_fact" ("player_id", "family", "metric", "value", "updated_at")
        VALUES (${playerId}, ${family}, ${metric}, ${input}, NOW())
        ON CONFLICT ("player_id", "family")
        DO UPDATE SET "value" = GREATEST("core"."player_fact"."value", EXCLUDED."value"), "updated_at" = NOW()
      `;
      return { playerId, family, metric, previousValue, value: nextValue };
    }
    const row = await this.prisma.playerFact.upsert({
      where: { playerId_family: { playerId, family } },
      create: { playerId, family, metric, value: input },
      update: { value: { increment: input } },
      select: { value: true },
    });
    return { playerId, family, metric, previousValue, value: row.value };
  }

  async get(playerId: string, family: AchievementFamilyId): Promise<number> {
    if (!this.useDb || !this.prisma) return this.mem.get(playerId, family);
    const row = await this.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId, family } },
      select: { value: true },
    });
    return row?.value ?? (await this.mem.get(playerId, family));
  }

  async getAll(playerId: string): Promise<Record<string, number>> {
    const memFacts = await this.mem.getAll(playerId);
    if (!this.useDb || !this.prisma) return memFacts;
    const rows = await this.prisma.playerFact.findMany({
      where: { playerId },
      select: { family: true, value: true },
    });
    const out: Record<string, number> = { ...memFacts };
    for (const r of rows) out[r.family] = r.value;
    return out;
  }

  async setAll(playerId: string, facts: Readonly<Record<string, number>>): Promise<void> {
    await this.mem.setAll(playerId, facts);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.playerFact.deleteMany({ where: { playerId } });
    const data = Object.entries(facts)
      .filter(([, v]) => sanitizeNonNegative(v) > 0)
      .map(([family, v]) => ({
        playerId,
        family,
        metric: defaultMetric(family as AchievementFamilyId),
        value: sanitizeNonNegative(v),
      }));
    if (data.length > 0) {
      await this.prisma.playerFact.createMany({ data });
    }
  }

  async reset(playerId: string): Promise<void> {
    await this.mem.reset(playerId);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.playerFact.deleteMany({ where: { playerId } });
  }
}
