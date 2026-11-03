import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ACHIEVEMENT_BY_ID,
  type AchievementDef,
  type AchievementFamilyId,
  type AchievementNftState,
  type AchievementTier,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { PRISMA } from '../db/db.module.js';

export interface UnlockedAchievementRecord {
  readonly id: string;
  readonly playerId: string;
  readonly achievementId: string;
  readonly family: AchievementFamilyId;
  readonly tier: AchievementTier;
  readonly earnedAt: Date;
  readonly nftStatus: AchievementNftState;
  readonly nftTokenId?: string;
  readonly nftTxHash?: string;
}

export interface SeedUnlockEntry {
  readonly achievementId: string;
  readonly earnedAt?: Date;
  readonly nftStatus?: AchievementNftState;
  readonly nftTokenId?: string;
  readonly nftTxHash?: string;
}

function isUniqueError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

/** In-memory append-only achievement unlocks store. */
export class InMemoryAchievementUnlockStore {
  private readonly rows = new Map<string, Map<string, UnlockedAchievementRecord>>();

  async recordUnlock(
    playerId: string,
    def: AchievementDef,
    earnedAt: Date = new Date(),
  ): Promise<{ created: boolean; record: UnlockedAchievementRecord }> {
    let playerMap = this.rows.get(playerId);
    if (!playerMap) {
      playerMap = new Map();
      this.rows.set(playerId, playerMap);
    }
    const existing = playerMap.get(def.id);
    if (existing) return { created: false, record: existing };

    const record: UnlockedAchievementRecord = {
      id: `au_${randomUUID()}`,
      playerId,
      achievementId: def.id,
      family: def.familyId,
      tier: def.tier,
      earnedAt,
      nftStatus: 'none',
    };
    playerMap.set(def.id, record);
    return { created: true, record };
  }

  async getEarned(playerId: string): Promise<UnlockedAchievementRecord[]> {
    const map = this.rows.get(playerId);
    return map ? [...map.values()] : [];
  }

  async getEarnedMap(playerId: string): Promise<Map<string, UnlockedAchievementRecord>> {
    const map = this.rows.get(playerId);
    return map ? new Map(map) : new Map();
  }

  async setNftStatus(
    playerId: string,
    achievementId: string,
    nft: { status: AchievementNftState; tokenId?: string; txHash?: string },
  ): Promise<void> {
    const map = this.rows.get(playerId);
    const existing = map?.get(achievementId);
    if (!map || !existing) return;
    map.set(achievementId, {
      ...existing,
      nftStatus: nft.status,
      nftTokenId: nft.tokenId ?? existing.nftTokenId,
      nftTxHash: nft.txHash ?? existing.nftTxHash,
    });
  }

  async seedEarned(playerId: string, entries: readonly SeedUnlockEntry[]): Promise<void> {
    const map = new Map<string, UnlockedAchievementRecord>();
    for (const entry of entries) {
      const def = ACHIEVEMENT_BY_ID.get(entry.achievementId);
      if (!def) continue;
      map.set(def.id, {
        id: `au_${randomUUID()}`,
        playerId,
        achievementId: def.id,
        family: def.familyId,
        tier: def.tier,
        earnedAt: entry.earnedAt ?? new Date(),
        nftStatus: entry.nftStatus ?? 'none',
        nftTokenId: entry.nftTokenId,
        nftTxHash: entry.nftTxHash,
      });
    }
    this.rows.set(playerId, map);
  }

  async reset(playerId: string): Promise<void> {
    this.rows.delete(playerId);
  }
}

/** Append-only `core.achievement_unlock` store (`(playerId, achievementId)` unique, W12-03). */
@Injectable()
export class AchievementUnlockStore {
  private readonly mem = new InMemoryAchievementUnlockStore();
  private readonly useDb: boolean;

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.useDb = Boolean(this.prisma && (!env || databaseEnabled(env)));
  }

  async recordUnlock(
    playerId: string,
    def: AchievementDef,
    earnedAt: Date = new Date(),
  ): Promise<{ created: boolean; record: UnlockedAchievementRecord }> {
    const memRes = await this.mem.recordUnlock(playerId, def, earnedAt);
    if (!this.useDb || !this.prisma) return memRes;

    const existing = await this.prisma.achievementUnlock.findUnique({
      where: { playerId_achievementId: { playerId, achievementId: def.id } },
    });
    if (existing) {
      return {
        created: false,
        record: {
          id: existing.id,
          playerId: existing.playerId,
          achievementId: existing.achievementId,
          family: existing.family as AchievementFamilyId,
          tier: existing.tier as AchievementTier,
          earnedAt: existing.earnedAt,
          nftStatus: existing.nftStatus as AchievementNftState,
          nftTokenId: existing.nftTokenId ?? undefined,
          nftTxHash: existing.nftTxHash ?? undefined,
        },
      };
    }

    try {
      const created = await this.prisma.achievementUnlock.create({
        data: {
          id: memRes.record.id,
          playerId,
          achievementId: def.id,
          family: def.familyId,
          tier: def.tier,
          earnedAt,
          nftStatus: 'none',
        },
      });
      return {
        created: true,
        record: {
          id: created.id,
          playerId: created.playerId,
          achievementId: created.achievementId,
          family: created.family as AchievementFamilyId,
          tier: created.tier as AchievementTier,
          earnedAt: created.earnedAt,
          nftStatus: created.nftStatus as AchievementNftState,
        },
      };
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      return { created: false, record: memRes.record };
    }
  }

  async getEarned(playerId: string): Promise<UnlockedAchievementRecord[]> {
    const map = await this.getEarnedMap(playerId);
    return [...map.values()];
  }

  async getEarnedMap(playerId: string): Promise<Map<string, UnlockedAchievementRecord>> {
    const memMap = await this.mem.getEarnedMap(playerId);
    if (!this.useDb || !this.prisma) return memMap;
    const rows = await this.prisma.achievementUnlock.findMany({ where: { playerId } });
    const out = new Map(memMap);
    for (const r of rows) {
      out.set(r.achievementId, {
        id: r.id,
        playerId: r.playerId,
        achievementId: r.achievementId,
        family: r.family as AchievementFamilyId,
        tier: r.tier as AchievementTier,
        earnedAt: r.earnedAt,
        nftStatus: r.nftStatus as AchievementNftState,
        nftTokenId: r.nftTokenId ?? undefined,
        nftTxHash: r.nftTxHash ?? undefined,
      });
    }
    return out;
  }

  async setNftStatus(
    playerId: string,
    achievementId: string,
    nft: { status: AchievementNftState; tokenId?: string; txHash?: string },
  ): Promise<void> {
    await this.mem.setNftStatus(playerId, achievementId, nft);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.achievementUnlock.updateMany({
      where: { playerId, achievementId },
      data: {
        nftStatus: nft.status,
        ...(nft.tokenId !== undefined ? { nftTokenId: nft.tokenId } : {}),
        ...(nft.txHash !== undefined ? { nftTxHash: nft.txHash } : {}),
      },
    });
  }

  async seedEarned(playerId: string, entries: readonly SeedUnlockEntry[]): Promise<void> {
    await this.mem.seedEarned(playerId, entries);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.achievementUnlock.deleteMany({ where: { playerId } });
    const data = entries
      .map((entry) => {
        const def = ACHIEVEMENT_BY_ID.get(entry.achievementId);
        if (!def) return null;
        return {
          id: `au_${randomUUID()}`,
          playerId,
          achievementId: def.id,
          family: def.familyId,
          tier: def.tier,
          earnedAt: entry.earnedAt ?? new Date(),
          nftStatus: entry.nftStatus ?? 'none',
          nftTokenId: entry.nftTokenId ?? null,
          nftTxHash: entry.nftTxHash ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (data.length > 0) {
      await this.prisma.achievementUnlock.createMany({ data });
    }
  }

  async reset(playerId: string): Promise<void> {
    await this.mem.reset(playerId);
    if (!this.useDb || !this.prisma) return;
    await this.prisma.achievementUnlock.deleteMany({ where: { playerId } });
  }
}
