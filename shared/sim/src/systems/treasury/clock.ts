import { dataRow } from '../../data';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { rowNum } from '../rows';
import { readTreasury, writeTreasury, type TreasuryBlobValue } from './blob';
import { expireTreasuryEffects } from './expire';
import { attemptTicks, strikeChanceBp, strikeRollBp } from './roll';

/**
 * Hazard slot. Counts meteor and lightning strikes. Does not crater tiles (GP-116):
 * a destructive meteor here would raze the colony the shield is meant to protect.
 */
export function stepTreasuryHazards(state: PlanetState, ctx: StepContext): void {
  const policy = dataRow(ctx.data, 'treasuryPolicy', 'hazard');
  const interval = rowNum(policy, 'intervalTicks');
  const base = rowNum(policy, 'baseStrikeBp');
  const blob = readTreasury(state);
  const struck = countStrikes(state.meta.seed, blob, state.meta.tick, ctx.tick, interval, base);
  const ended = expireTreasuryEffects(blob, ctx, state.meta.planetId);
  if (struck || ended) writeTreasury(state, blob, ctx.tick);
}

function countStrikes(
  seed: string,
  blob: TreasuryBlobValue,
  prevTick: number,
  tick: number,
  interval: number,
  baseStrikeBp: number,
): boolean {
  const shield = blob.effects.meteor_shield;
  let hit = false;
  for (const at of attemptTicks(prevTick, tick, interval)) {
    const active = shield !== undefined && at < shield.untilTick;
    const chance = strikeChanceBp(baseStrikeBp, shield?.magnitudeBp ?? 0, active);
    if (strikeRollBp(seed, at) >= chance) continue;
    blob.hazardStrikes += 1;
    if (Math.floor(at / interval) % 2 === 0) blob.lightningStrikes += 1;
    hit = true;
  }
  return hit;
}

export const treasuryHazardSystem = defineSystem({
  id: 'treasury.hazards',
  slot: 2,
  wave: 'W22',
  run: stepTreasuryHazards,
});
