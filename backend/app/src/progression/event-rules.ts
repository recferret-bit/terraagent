import { createHash } from 'node:crypto';
import type { AchievementFamilyId } from '@terra/contracts';

/** Content registry: adding a producer for an existing metric requires no evaluator branch. */
export const PROGRESSION_EVENT_RULES: Readonly<
  Record<
    string,
    {
      family: AchievementFamilyId;
      familyByOp?: Readonly<Record<string, AchievementFamilyId>>;
      fields: readonly string[];
      fallback: number;
      predicate?: (data: Record<string, unknown>) => boolean;
    }
  >
> = {
  tilePrepared: { family: 'groundbreaker', fields: ['count'], fallback: 1 },
  obstacleRemoved: {
    family: 'stone-mason',
    familyByOp: {
      clear: 'stone-mason',
      break: 'stone-mason',
      level: 'stone-mason',
      fill: 'stone-mason',
      reclaim: 'hydro-engineer',
      deepReclaim: 'hydro-engineer',
      seed: 'green-thumb',
    },
    fields: ['count'],
    fallback: 1,
  },
  colonyFounded: { family: 'first-landfall', fields: [], fallback: 1 },
  buildingCompleted: { family: 'architect', fields: [], fallback: 1 },
  resourceProduced: { family: 'stockpile', fields: ['amount', 'count'], fallback: 1 },
  faunaKilled: { family: 'exterminator', fields: ['count'], fallback: 1 },
  nestDestroyed: { family: 'nest-breaker', fields: ['count'], fallback: 1 },
  raidRepelled: { family: 'unbreached', fields: ['count'], fallback: 1, predicate: (d) => d.unbreached === true },
  deedSettled: { family: 'settler', fields: ['count'], fallback: 1 },
  unitDestroyed: {
    family: 'warlord',
    fields: ['count'],
    fallback: 1,
    predicate: (d) =>
      d.pvp !== false &&
      (d.pvp === true ||
        (typeof d.killerColonyId === 'string' &&
          d.killerColonyId.length > 0 &&
          d.killerColonyId !== d.colonyId &&
          d.killerColonyId !== d.victimColonyId) ||
        (typeof d.attackerColonyId === 'string' &&
          d.attackerColonyId.length > 0 &&
          d.attackerColonyId !== d.colonyId &&
          d.attackerColonyId !== d.victimColonyId) ||
        (typeof d.killerOwner === 'number' &&
          d.killerOwner >= 0 &&
          typeof d.owner === 'number' &&
          d.killerOwner !== d.owner)),
  },
  truceEnded: {
    family: 'diplomat',
    fields: ['count'],
    fallback: 1,
    predicate: (d) => d.reason === 'expired',
  },
};

export function progressEventId(event: unknown): string {
  return `planet:${createHash('sha256').update(JSON.stringify(event)).digest('hex')}`;
}
