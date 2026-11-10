import type { BehaviorContext, BehaviorProfile } from '../types';
import { GUILD_PRICING_STEPS, replayGuildPricing } from '../guild-pricing';

const pinned = (assumptions: Readonly<Record<string, unknown>>, key: string, fallback: number): number => {
  const v = assumptions[key];
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : fallback;
};

/**
 * Behaviour `guild-pricing` (W15-29). One bounded `quoteGuild` replay, then no colony orders.
 * Overrides are ignored so a manifest cannot inject a buyer price or a demand volume.
 */
export const guildPricing = (_overrides?: Readonly<Record<string, unknown>>): BehaviorProfile => ({
  id: 'guild-pricing',
  actEveryTicks: 1,
  init(ctx: BehaviorContext) {
    const seed = pinned(ctx.scenario.assumptions, 'pricingSeed', 101);
    const steps = pinned(ctx.scenario.assumptions, 'pricingSteps', GUILD_PRICING_STEPS);
    const replay = replayGuildPricing(ctx.host.pipeline.config.data, seed, steps);
    const rested = replay.steps.filter((s) => s.status === 'rested').length;
    const rejected = replay.steps.filter((s) => s.status === 'funding_cap' || s.status === 'per_order').length;
    ctx.stats.notes = {
      rested, rejected, exposure: Number(replay.exposure), loss: Number(replay.loss), organicFills: 0, demandQuotes: 0,
    };
  },
  act() { /* the replay already ran; this behaviour does not place buyer or seller colony orders */ },
});
