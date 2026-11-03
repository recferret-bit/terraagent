import { withProgressionTransaction } from './progression-transaction.js';
import { recordReward, creditRewardXp } from './progression-rewards.js';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ACHIEVEMENT_FAMILY_BY_ID,
  evaluateNewUnlocks,
  ProgressEventV1Schema,
  type ProgressEventV1,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../db/db.module.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { databaseEnabled } from '../core/persistence.js';
import { FamilyAvailabilityService } from './family-availability.js';
import type { FactUpdateResult } from './facts.store.js';

/** One commit is the boundary: receipt + facts + unlocks + XP + independently deliverable effects. */
@Injectable()
export class ProgressionEngine {
  readonly enabled: boolean;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(FamilyAvailabilityService) private readonly availability: FamilyAvailabilityService,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.enabled = !env || databaseEnabled(env);
  }

  async resetPlayer(playerId: string): Promise<void> {
    await withProgressionTransaction(this.db, playerId, async tx => {
      await tx.progressionEffect.deleteMany({ where: { playerId } });
      await tx.progressionReceipt.deleteMany({ where: { playerId } });
      await tx.xpLedger.deleteMany({ where: { playerId } });
      await tx.playerXp.deleteMany({ where: { playerId } });
      await tx.achievementUnlock.deleteMany({ where: { playerId } });
      await tx.playerFact.deleteMany({ where: { playerId } });
    });
  }

  async apply(raw: ProgressEventV1): Promise<FactUpdateResult> {
    const event = ProgressEventV1Schema.parse(raw);
    const spec = ACHIEVEMENT_FAMILY_BY_ID.get(event.family)!;
    if (event.metric !== spec.metric) throw new Error(`Metric mismatch for ${event.family}`);
    const id = event.eventId ?? randomUUID();
    return withProgressionTransaction(this.db, event.playerId, async (tx) => {
      const previous = await tx.playerFact.findUnique({
        where: { playerId_family: { playerId: event.playerId, family: event.family } },
      });
      const previousValue = previous?.value ?? 0;
      const result: FactUpdateResult & { value: number } = {
        unlocked: [],
        playerId: event.playerId,
        family: event.family,
        metric: event.metric,
        previousValue,
        value: previousValue,
      };
      const receipt = await tx.progressionReceipt.findUnique({ where: { id } });
      if (receipt) {
        const saved = receipt.payload as unknown as ProgressEventV1;
        for (const key of Object.keys(event) as (keyof ProgressEventV1)[]) {
          if (saved[key] !== event[key]) throw new Error('Progression eventId reused with a different payload');
        }
        return result;
      }
      await tx.progressionReceipt.create({ data: { id, playerId: event.playerId, payload: { ...event } } });
      result.value = event.metric === 'max' ? Math.max(previousValue, event.value) : previousValue + event.value;
      await tx.playerFact.upsert({
        where: { playerId_family: { playerId: event.playerId, family: event.family } },
        create: { playerId: event.playerId, family: event.family, metric: event.metric, value: result.value },
        update: { value: result.value },
      });
      const facts = Object.fromEntries(
        (await tx.playerFact.findMany({ where: { playerId: event.playerId } })).map((r) => [r.family, r.value]),
      );
      const earned = new Set(
        (await tx.achievementUnlock.findMany({ where: { playerId: event.playerId } })).map((r) => r.achievementId),
      );
      const candidates = evaluateNewUnlocks(facts, earned, this.availability.availableFamilies());
      for (const def of candidates) result.unlocked!.push(await recordReward(tx, event.playerId, def));
      const levelUp = await creditRewardXp(tx, event.playerId, candidates.reduce((sum, def) => sum + def.xp, 0));
      return { ...result, levelUp };
    });
  }
}
