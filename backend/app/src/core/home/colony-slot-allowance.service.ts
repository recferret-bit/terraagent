import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  maxColoniesForAiSlots,
  stakingTierFor,
  type ColonySlotAllowance,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module';
import { isLocalStakingFastTimings } from '../../near/staking/local-staking-timings';
import { isW28Enabled } from '../../near/staking/perks/legacy-ladder';
import { resolveWalletPerks } from '../../near/staking/perks/perks.resolver';
import { databaseEnabled } from '../persistence';
import { APP_ENV, type AppEnv } from '../tokens';

function sanitizeDevHandle(raw: string): string {
  const cleaned = raw
    .replace(/^pr_dev_/, '')
    .replace(/^pr_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return cleaned || 'pilot';
}

function fmtNear(n: number): string {
  const clean = Math.max(0, Number.isFinite(n) ? n : 0);
  return clean.toFixed(6).replace(/\.?0+$/, '') || '0';
}

export function buildDefaultColonySlotAllowance(used = 0): ColonySlotAllowance {
  return {
    used: Math.max(0, Math.floor(used)),
    max: 1,
    aiColonySlots: 0,
    isStaker: false,
    tier: 0,
    tierName: 'Free Cadet',
    stakedNear: '0',
  };
}

export function allowanceFromStakedNear(stakedNear: number, used = 0): ColonySlotAllowance {
  const amount = Math.max(0, Number.isFinite(stakedNear) ? stakedNear : 0);
  const tier = stakingTierFor(amount);
  const isStaker = tier.id >= 1 && tier.aiColonySlots > 0;
  return {
    used: Math.max(0, Math.floor(used)),
    max: isStaker ? maxColoniesForAiSlots(tier.aiColonySlots) : 1,
    aiColonySlots: tier.aiColonySlots,
    isStaker,
    tier: tier.id,
    tierName: tier.name,
    stakedNear: fmtNear(amount),
  };
}

/**
 * Authoritative server-side NEAR.AI colony-slot resolver.
 * Non-stakers (`tier === 0`) and Tier 1 (`10 NEAR`, `1` slot) may hold at most 1 active colony;
 * Tier 2–4 stakers (`50 / 200 / 500+ NEAR`) unlock `3 / 6 / 12` concurrent colonies across sectors and planets.
 */
@Injectable()
export class ColonySlotAllowanceService {
  private readonly testStakedNear = new Map<string, number>();

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  /** Test seam for unit/HTTP specs running without PostgreSQL staking tables. */
  setTestStakedNear(playerId: string, stakedNear: number | null): void {
    if (stakedNear === null) this.testStakedNear.delete(playerId);
    else this.testStakedNear.set(playerId, Math.max(0, stakedNear));
  }

  clearTestStakedNear(): void {
    this.testStakedNear.clear();
  }

  async resolveForPlayer(playerId: string, used = 0): Promise<ColonySlotAllowance> {
    const safeUsed = Math.max(0, Math.floor(used));
    if (!playerId || playerId.startsWith('ai:')) {
      return buildDefaultColonySlotAllowance(safeUsed);
    }

    const override = this.testStakedNear.get(playerId);
    if (override !== undefined) {
      return allowanceFromStakedNear(override, safeUsed);
    }

    const envBag = (this.env ?? process.env) as unknown as Record<string, string | undefined>;
    const activeDb =
      this.prisma && (databaseEnabled(this.env) || !('$connect' in this.prisma))
        ? this.prisma
        : null;
    if (!activeDb) {
      return buildDefaultColonySlotAllowance(safeUsed);
    }

    const fastLocal = isLocalStakingFastTimings(envBag);
    const devMockAcct =
      playerId === 'pr_dev_w12' || (fastLocal && playerId.startsWith('pr_dev_'))
        ? `${sanitizeDevHandle(playerId)}.terraagent.mock`
        : undefined;

    const w28 = isW28Enabled(envBag);
    const candidates: Array<{ playerId?: string; accountId?: string }> = [{ playerId }];
    if (devMockAcct) candidates.push({ accountId: devMockAcct, playerId });

    let bestYocto = -1n;
    let bestAllowance = buildDefaultColonySlotAllowance(safeUsed);

    for (const q of candidates) {
      const resolved = await resolveWalletPerks(activeDb, {
        ...q,
        env: envBag,
        w28,
      }).catch(() => null);
      if (!resolved) continue;
      const { perks } = resolved;
      if (perks.totalStakedYocto > bestYocto) {
        bestYocto = perks.totalStakedYocto;
        const isStaker = perks.active && perks.maxAiColonySlots > 0;
        bestAllowance = {
          used: safeUsed,
          max: isStaker ? maxColoniesForAiSlots(perks.maxAiColonySlots) : 1,
          aiColonySlots: perks.maxAiColonySlots,
          isStaker,
          tier: perks.tier,
          tierName: perks.tierName,
          stakedNear: perks.activeStakedNear,
        };
      }
    }

    return bestAllowance;
  }
}
