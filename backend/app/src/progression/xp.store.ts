import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { levelForXp, titleForLevel } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { PRISMA } from '../db/db.module.js';

export interface PlayerXpState {
  readonly playerId: string;
  readonly xp: number;
  readonly level: number;
  readonly title: string;
  readonly frame: string;
  readonly unlockStage: number;
}

export interface XpAwardOutcome {
  readonly applied: boolean;
  readonly delta: number;
  readonly previousXp: number;
  readonly previousLevel: number;
  readonly state: PlayerXpState;
}

export interface SeedPlayerXpInput {
  readonly xp: number;
  readonly level?: number;
  readonly title?: string;
  readonly frame?: string;
  readonly unlockStage?: number;
}

function isUniqueError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

function defaultState(playerId: string): PlayerXpState {
  return {
    playerId,
    xp: 0,
    level: 0,
    title: 'Cadet',
    frame: 'default',
    unlockStage: 1,
  };
}

/** In-memory XP ledger + player XP state store. */
export class InMemoryXpStore {
  private readonly ledger = new Set<string>();
  private readonly states = new Map<string, PlayerXpState>();

  async get(playerId: string): Promise<PlayerXpState> {
    return this.states.get(playerId) ?? defaultState(playerId);
  }

  async award(playerId: string, source: string, sourceId: string, rawDelta: number): Promise<XpAwardOutcome> {
    const prev = await this.get(playerId);
    const delta = Number.isFinite(rawDelta) && rawDelta > 0 ? Math.floor(rawDelta) : 0;
    const key = `${playerId}\0${source}\0${sourceId}`;
    if (delta <= 0 || this.ledger.has(key)) {
      return {
        applied: false,
        delta: 0,
        previousXp: prev.xp,
        previousLevel: prev.level,
        state: prev,
      };
    }
    this.ledger.add(key);
    const nextXp = prev.xp + delta;
    const { level: nextLevel } = levelForXp(nextXp);
    const nextTitle = nextLevel > prev.level ? titleForLevel(nextLevel) : prev.title;
    const next: PlayerXpState = {
      ...prev,
      xp: nextXp,
      level: nextLevel,
      title: nextTitle,
    };
    this.states.set(playerId, next);
    return {
      applied: true,
      delta,
      previousXp: prev.xp,
      previousLevel: prev.level,
      state: next,
    };
  }

  async setUnlockStage(playerId: string, stage: number): Promise<PlayerXpState> {
    const prev = await this.get(playerId);
    const clamped = Math.max(prev.unlockStage, Math.min(10, Math.max(0, Math.floor(stage))));
    const next: PlayerXpState = { ...prev, unlockStage: clamped };
    this.states.set(playerId, next);
    return next;
  }

  async seed(playerId: string, input: SeedPlayerXpInput): Promise<PlayerXpState> {
    const cleanXp = Math.max(0, Math.floor(input.xp));
    const { level: calcLevel } = levelForXp(cleanXp);
    const level = input.level ?? calcLevel;
    const next: PlayerXpState = {
      playerId,
      xp: cleanXp,
      level,
      title: input.title ?? titleForLevel(level),
      frame: input.frame ?? (level >= 4 ? 'surveyor' : 'default'),
      unlockStage: input.unlockStage ?? 1,
    };
    this.states.set(playerId, next);
    return next;
  }

  async reset(playerId: string): Promise<void> {
    for (const k of [...this.ledger]) {
      if (k.startsWith(`${playerId}\0`)) this.ledger.delete(k);
    }
    this.states.delete(playerId);
  }
}

/** Postgres-backed `core.xp_ledger` (`(playerId, source, sourceId)` unique) + `core.player_xp` store (W12-05). */
@Injectable()
export class XpStore {
  private readonly mem = new InMemoryXpStore();
  private readonly useDb: boolean;

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.useDb = Boolean(this.prisma && (!env || databaseEnabled(env)));
  }

  async get(playerId: string): Promise<PlayerXpState> {
    const memState = await this.mem.get(playerId);
    if (!this.useDb || !this.prisma) return memState;
    const row = await this.prisma.playerXp.findUnique({ where: { playerId } });
    if (!row) return memState;
    return {
      playerId: row.playerId,
      xp: row.xp,
      level: row.level,
      title: row.title,
      frame: row.frame,
      unlockStage: row.unlockStage,
    };
  }

  async award(playerId: string, source: string, sourceId: string, rawDelta: number): Promise<XpAwardOutcome> {
    const delta = Number.isFinite(rawDelta) && rawDelta > 0 ? Math.floor(rawDelta) : 0;
    const prev = await this.get(playerId);
    if (delta <= 0) {
      return { applied: false, delta: 0, previousXp: prev.xp, previousLevel: prev.level, state: prev };
    }
    const memOut = await this.mem.award(playerId, source, sourceId, delta);
    if (!this.useDb || !this.prisma) return memOut;

    try {
      await this.prisma.xpLedger.create({
        data: {
          id: `xp_${randomUUID()}`,
          playerId,
          source,
          sourceId,
          delta,
        },
      });
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      return { applied: false, delta: 0, previousXp: prev.xp, previousLevel: prev.level, state: prev };
    }

    const nextXp = prev.xp + delta;
    const { level: nextLevel } = levelForXp(nextXp);
    const nextTitle = nextLevel > prev.level ? titleForLevel(nextLevel) : prev.title;
    const saved = await this.prisma.playerXp.upsert({
      where: { playerId },
      create: {
        playerId,
        xp: nextXp,
        level: nextLevel,
        title: nextTitle,
        frame: prev.frame,
        unlockStage: prev.unlockStage,
      },
      update: {
        xp: nextXp,
        level: nextLevel,
        title: nextTitle,
      },
    });
    const state: PlayerXpState = {
      playerId: saved.playerId,
      xp: saved.xp,
      level: saved.level,
      title: saved.title,
      frame: saved.frame,
      unlockStage: saved.unlockStage,
    };
    await this.mem.seed(playerId, state);
    return {
      applied: true,
      delta,
      previousXp: prev.xp,
      previousLevel: prev.level,
      state,
    };
  }

  async setUnlockStage(playerId: string, stage: number): Promise<PlayerXpState> {
    const next = await this.mem.setUnlockStage(playerId, stage);
    if (!this.useDb || !this.prisma) return next;
    await this.prisma.playerXp.upsert({
      where: { playerId },
      create: {
        playerId,
        xp: next.xp,
        level: next.level,
        title: next.title,
        frame: next.frame,
        unlockStage: next.unlockStage,
      },
      update: { unlockStage: next.unlockStage },
    });
    return next;
  }

  async seed(playerId: string, input: SeedPlayerXpInput): Promise<PlayerXpState> {
    const seeded = await this.mem.seed(playerId, input);
    if (!this.useDb || !this.prisma) return seeded;
    await this.prisma.xpLedger.deleteMany({ where: { playerId } });
    await this.prisma.playerXp.upsert({
      where: { playerId },
      create: {
        playerId,
        xp: seeded.xp,
        level: seeded.level,
        title: seeded.title,
        frame: seeded.frame,
        unlockStage: seeded.unlockStage,
      },
      update: {
        xp: seeded.xp,
        level: seeded.level,
        title: seeded.title,
        frame: seeded.frame,
        unlockStage: seeded.unlockStage,
      },
    });
    return seeded;
  }

  async reset(playerId: string): Promise<void> {
    await this.mem.reset(playerId);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.xpLedger.deleteMany({ where: { playerId } });
    await this.prisma.playerXp.deleteMany({ where: { playerId } });
  }
}
