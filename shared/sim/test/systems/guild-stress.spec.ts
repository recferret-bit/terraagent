import { parseExperimentManifest, parseWaves, type ExperimentManifest } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { loadExperimentScenarios } from '../../../../tests/economy/scenarios';
import guild from '../../src/data/guild';
import {
  boardRow, compileData, compileProfile, guildColonyInput, guildPolicy, guildPricingFixture, guildQuoteParams,
  guildSideOrganic, quoteColony, quoteGuild, replayGuildPricing, runScenario, behaviorIds,
} from '../../src';

/** W15-29: a 20-step guild quote replay. No invented demand. Re-run: `npx vitest run shared/sim/test/systems/guild-stress.spec.ts` */

const SEED = 101;
const FLAGS = [...parseWaves('..15').list];
const data = compileData(new Set(FLAGS));
const policyRow = guild.rows.find((row) => row.id === 'policy');

function manifest(): ExperimentManifest {
  const compiled = compileProfile({ parameters: {} }, FLAGS);
  const parsed = parseExperimentManifest({
    schemaVersion: 1, profile: { id: 'baseline', version: 1, hash: compiled.overridesHash }, engineCommit: 'workspace', waves: '..15',
    scenarios: [{ id: 'guild-pricing', version: 1 }], seeds: [SEED], warmupTicks: 0, measureTicks: 1, sampleEveryTicks: 1, ticksPerSecond: 5,
    budget: { maxRuns: 1, maxWallSeconds: 60, maxWorkers: 1 }, behaviorProfile: 'guild-pricing',
    demandModel: { source: 'none', perPayingActorMonthlyBudgetUsdcAtomic: '0' }, output: { format: 'jsonl', trace: 'none' },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

describe('guild-pricing replay', () => {
  const first = replayGuildPricing(data, SEED);
  const second = replayGuildPricing(data, SEED);

  it('uses the compiled guild caps and does not price a bid', () => {
    expect(policyRow?.perOrderExposureAtomic).toBe(first.perOrderCap);
    expect(policyRow?.globalExposureAtomic).toBe(first.globalCap);
    expect(policyRow?.dailyLossAtomic).toBe(first.lossCap);
    expect(first.demandSource).toBe('none');
    expect(first.steps).toHaveLength(20);
    expect(first.steps.every((s) => s.bid === null)).toBe(true);
    expect(guildPolicy(data).cashEnabled).toBe(0);
  });

  it('keeps exposure and loss inside the funded caps, and the global cap actually binds', () => {
    const globalCap = BigInt(first.globalCap);
    const perOrder = BigInt(first.perOrderCap);
    const lossCap = BigInt(first.lossCap);
    let prev = 0n;
    for (const step of first.steps) {
      const exposure = BigInt(step.exposure);
      expect(exposure <= globalCap).toBe(true);
      expect(exposure >= prev).toBe(true);
      expect(BigInt(step.loss) <= lossCap).toBe(true);
      if (step.priceAmount) expect(BigInt(step.priceAmount) <= perOrder).toBe(true);
      prev = exposure;
    }
    expect(first.loss).toBe('0');
    expect(first.steps.some((s) => s.status === 'rested')).toBe(true);
    expect(first.steps.some((s) => s.status === 'funding_cap')).toBe(true);
    expect(BigInt(first.exposure) <= globalCap).toBe(true);
  });

  it('is deterministic for one seed and matches quoteColony', () => {
    expect(first.steps.map((s) => s.priceAmount)).toEqual(second.steps.map((s) => s.priceAmount));
    expect(first).toEqual(second);
    const step = first.steps[0]!;
    const fixture = guildPricingFixture(data, step.npcId, step.resource);
    const policy = guildPolicy(data);
    const input = guildColonyInput(policy, fixture);
    expect(quoteGuild(data, fixture)).toEqual(quoteColony(input, guildQuoteParams(policy, input.inventory, input.target)));
    expect(fixture.referencePrice).toBeNull();
  });

  it('records a guild fill as not organic, so the board does not take it as the reference', () => {
    const fill = first.fill;
    expect(fill).not.toBeNull();
    if (!fill) return;
    expect(fill.actorKind).toBe('npc');
    expect(guildSideOrganic(fill.actorKind)).toBe(false);
    expect(fill.organic).toBe(false);
    const pair = `${fill.resource}/USDC`;
    const now = 100 * 3_600_000;
    const trade = {
      pair, amount: BigInt(fill.amount), notional: BigInt(fill.priceAmount), atMs: now - 1000,
      organic: fill.organic, buyerId: fill.accountId, sellerId: 'player-a',
    };
    expect(boardRow(pair, [trade], now).classification).toBe('fixture');
    expect(boardRow(pair, [trade], now).vwap).toBeNull();
    expect(boardRow(pair, [{ ...trade, organic: true }], now).classification).not.toBe('fixture');
  });
});

describe('guild-pricing on the W13 experiment runner', () => {
  it('is registered and the runner replay stays inside the cap without demand quotes', () => {
    expect(behaviorIds()).toContain('guild-pricing');
    const scenarios = loadExperimentScenarios();
    const scenario = scenarios.find((s) => s.manifest.id === 'guild-pricing' && s.manifest.version === 1);
    expect(scenario?.manifest.assumptions.demandSource).toBe('none');
    if (!scenario) return;
    const compiled = compileProfile({ parameters: {} }, FLAGS);
    const run = runScenario(manifest(), scenario, SEED, compiled);
    const notes = run.summary.behavior.notes;
    expect(notes?.demandQuotes).toBe(0);
    expect(notes?.organicFills).toBe(0);
    expect(notes?.rested).toBeGreaterThan(0);
    expect(notes?.rejected).toBeGreaterThan(0);
    expect(notes?.loss).toBe(0);
    expect(notes?.exposure).toBeLessThanOrEqual(Number(policyRow?.globalExposureAtomic));
    expect(run.summary.trades).toBe(0);
  });
});
