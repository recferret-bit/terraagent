import { TREASURY_EFFECT_KINDS } from '@terra/contracts';
import type { StepContext } from '../../kernel/context';
import type { TreasuryBlobValue } from './blob';

/** Drops effects whose `untilTick` has arrived and emits `treasuryEffectEnded` once per kind. */
export function expireTreasuryEffects(blob: TreasuryBlobValue, ctx: StepContext, planetId: string): boolean {
  let ended = false;
  for (const kind of TREASURY_EFFECT_KINDS) {
    const effect = blob.effects[kind];
    if (!effect || ctx.tick < effect.untilTick) continue;
    delete blob.effects[kind];
    ended = true;
    ctx.emit({ kind: 'treasuryEffectEnded', data: { planetId, kind, atTick: ctx.tick } });
  }
  return ended;
}
