import { dailyAiBudgetUsd, dailyAiCallLimit, MANAGED_AI_MODEL, SCRIPT_AI_MODEL, STAKING_RULES, STAKING_TIERS } from '@terra/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedAiGate } from '../../src/ai/colony-agent/managed-ai-gate.js';
import { AI_CALL_COST_MICROS } from '../../src/ai/colony-agent/wallet-ai-usage.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { radarVisits } from '../../src/market/guild/visit/radar.js';
import { splitPlatformFee } from '../../src/near/infrastructure/network/protocol-fee.config.js';
import { AiSlotLedger } from '../../src/near/staking/perks/ai-slot.ledger.js';
import { EMPTY_AI_USAGE } from '../../src/near/staking/perks/ai-usage.reader.js';
import { resolvePerkLadder } from '../../src/near/staking/perks/legacy-ladder.js';
import { evaluatePerks } from '../../src/near/staking/perks/tier-engine.js';
import { BASE_VOTE_WEIGHT_BP, proposalPasses, tallyMemberVotes, type StoredVote } from '../../src/near/treasury/pass-rule.js';
import { nearToYocto } from '../../src/near/staking/yocto.js';

const NOW = 1_800_000_000_000;
const W28 = resolvePerkLadder({ w28: true, env: {} });

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), verified: vi.fn(), consume: vi.fn(), charge: vi.fn() }));
vi.mock('../../src/near/staking/perks/perks.resolver.js', () => ({ resolveWalletPerks: mocks.resolve }));
vi.mock('../../src/ai/colony-agent/trial-ledger.js', () => ({ isVerifiedPilot: mocks.verified, consumeTrialTurn: mocks.consume }));
vi.mock('../../src/ai/colony-agent/wallet-ai-usage.js', async (orig) => ({ ...(await orig<object>()), chargeWalletCall: mocks.charge }));

const perksFor = (stakeNear: number, nearUsd: number, usage = EMPTY_AI_USAGE) =>
  evaluatePerks({
    ladder: W28,
    activeStakedYocto: BigInt(nearToYocto(stakeNear)),
    unbondingYocto: 0n,
    stakedSinceMs: NOW - 3 * 86_400_000,
    lastStakedAtMs: null,
    nowMs: NOW,
    protocolAccountId: 'protocol.test',
    nearUsd,
    dailyProtocolTradeFeeUsd: 0,
    usage,
    leadPatronPlanetIds: [],
  });

describe('W28-06 AiSlotLedger (wallet-wide colony slots)', () => {
  it.each([
    [10, 1],
    [50, 3],
    [200, 6],
    [500, 12],
  ])('a wallet staking %i NEAR with 14 colonies holds exactly %i managed slots, first come', (stake, slots) => {
    const ledger = new AiSlotLedger();
    expect(perksFor(stake, 4).maxAiColonySlots).toBe(slots);
    const granted = Array.from({ length: 14 }, (_, i) => ledger.claim('w', `c${i}`, slots, NOW));
    expect(granted.filter(Boolean)).toHaveLength(slots);
    expect(granted.slice(0, slots).every(Boolean)).toBe(true);
    expect(ledger.used('w', NOW)).toBe(slots);
  });

  it('re-claiming a held slot is free, wallets are independent, 0 slots never grants, and the day rollover clears', () => {
    const ledger = new AiSlotLedger();
    expect(ledger.claim('a', 'c1', 1, NOW)).toBe(true);
    expect(ledger.claim('a', 'c1', 1, NOW)).toBe(true);
    expect(ledger.claim('a', 'c2', 1, NOW)).toBe(false);
    expect(ledger.claim('b', 'c2', 1, NOW)).toBe(true);
    expect(ledger.claim('z', 'c9', 0, NOW)).toBe(false);
    expect(ledger.has('a', 'c1', NOW)).toBe(true);
    expect(ledger.claim('a', 'c2', 1, NOW + 86_400_000)).toBe(true);
    expect(ledger.has('a', 'c1', NOW + 86_400_000)).toBe(false);
  });
});

describe('W28-06 budget guardrail: AI spend stays <= 35 % of protocol income (margin >= 65 %)', () => {
  it.each([4, 2, 1, 0.5])('at NEAR/USD %d every tier keeps margin >= 65 %', (price) => {
    for (const row of STAKING_TIERS.filter((t) => t.id > 0)) {
      const stake = row.minStakeNear;
      const incomeUsd = (stake * price * W28.grossApyBp * STAKING_RULES.protocolYieldShareBp) / (10_000 * 10_000 * 365);
      const calls = dailyAiCallLimit(dailyAiBudgetUsd({ activeStakedNear: stake, nearUsd: price, grossApyBp: W28.grossApyBp, dailyProtocolTradeFeeUsd: 0 }));
      const spend = calls * STAKING_RULES.aiCostPerCallUsd;
      expect(spend).toBeLessThanOrEqual(incomeUsd * 0.35 + 1e-12);
      if (incomeUsd > 0) expect(1 - spend / incomeUsd).toBeGreaterThanOrEqual(0.65);
      expect(perksFor(stake, price).dailyAiCallLimit).toBe(calls);
    }
  });

  it('a NEAR price drop from $4 to $0.50 shrinks the Tier 1 wallet budget from 18 to 2 calls a day', () => {
    expect(perksFor(10, 4).dailyAiCallLimit).toBe(18);
    expect(perksFor(10, 0.5).dailyAiCallLimit).toBe(2);
    expect(perksFor(10, 0).dailyAiCallLimit).toBe(0);
  });

  it('records the call cost rounded up (never understating spend)', () => {
    expect(Number(AI_CALL_COST_MICROS)).toBeGreaterThanOrEqual(STAKING_RULES.aiCostPerCallUsd * 1_000_000);
  });
});

describe('W28-06 ManagedAiGate.admit decisions', () => {
  const env = { NODE_ENV: 'production' } as unknown as AppEnv;
  const prisma = {} as never;
  const resolved = (stake: number, price: number, usage = EMPTY_AI_USAGE) => ({
    perks: perksFor(stake, price, usage),
    wallet: { walletKey: 'wallet.near', accountIds: [], colonyIds: [], playerId: null },
    usage,
    nearUsd: price,
  });
  let slots: AiSlotLedger;
  const gate = () => new ManagedAiGate(prisma, env, slots);

  beforeEach(() => {
    slots = new AiSlotLedger();
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.charge.mockResolvedValue(true);
    mocks.verified.mockResolvedValue(true);
  });

  it('a staked wallet in budget and slots gets the managed TEE model and is charged once', async () => {
    mocks.resolve.mockResolvedValue(resolved(50, 4));
    const out = await gate().admit({ id: 'c1' }, NOW);
    expect(out).toEqual({ mode: 'tee', model: MANAGED_AI_MODEL });
    expect(mocks.charge).toHaveBeenCalledWith(prisma, 'wallet.near', expect.any(Number), NOW);
  });

  it('10 colonies of one Tier 2 wallet: 3 run managed, 7 downshift with slot_cap and are not charged', async () => {
    mocks.resolve.mockResolvedValue(resolved(50, 4));
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => gate().admit({ id: `c${i}` }, NOW)));
    expect(out.filter((o) => o.mode === 'tee')).toHaveLength(3);
    const script = out.filter((o) => o.mode === 'script');
    expect(script).toHaveLength(7);
    expect(script.every((o) => o.reason === 'slot_cap' && o.model === SCRIPT_AI_MODEL)).toBe(true);
    expect(mocks.charge).toHaveBeenCalledTimes(3);
  });

  it('an exhausted daily budget (usage at the limit, or a lost atomic race) downshifts with budget_exhausted', async () => {
    const limit = perksFor(10, 0.5).dailyAiCallLimit;
    mocks.resolve.mockResolvedValue(resolved(10, 0.5, { ...EMPTY_AI_USAGE, dailyCallsUsed: limit }));
    expect(await gate().admit({ id: 'c1' }, NOW)).toMatchObject({ mode: 'script', reason: 'budget_exhausted' });
    expect(mocks.charge).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue(resolved(10, 4));
    mocks.charge.mockResolvedValue(false);
    expect(await gate().admit({ id: 'c2' }, NOW)).toMatchObject({ mode: 'script', reason: 'budget_exhausted' });
  });

  it('a verified unstaked pilot gets trial turns until the ledger refuses, then trial_exhausted', async () => {
    mocks.resolve.mockResolvedValue(resolved(0, 4));
    mocks.consume.mockResolvedValueOnce(4).mockResolvedValueOnce(0).mockResolvedValueOnce(null);
    expect(await gate().admit({ id: 'g', playerId: 'p' }, NOW)).toEqual({ mode: 'trial', model: MANAGED_AI_MODEL, trialTurnsLeft: 4 });
    expect(await gate().admit({ id: 'g', playerId: 'p' }, NOW)).toMatchObject({ mode: 'trial', trialTurnsLeft: 0 });
    expect(await gate().admit({ id: 'g', playerId: 'p' }, NOW)).toMatchObject({ mode: 'script', reason: 'trial_exhausted' });
  });

  it('an anonymous guest never touches the trial ledger', async () => {
    mocks.resolve.mockResolvedValue(resolved(0, 4));
    mocks.verified.mockResolvedValue(false);
    expect(await gate().admit({ id: 'g', playerId: 'guest' }, NOW)).toMatchObject({ mode: 'script', reason: 'guest', model: SCRIPT_AI_MODEL });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('no database means script, not an error', async () => {
    expect(await new ManagedAiGate(undefined, env, slots).admit({ id: 'c' }, NOW)).toMatchObject({ mode: 'script', reason: 'no_database' });
  });
});

describe('W28-06 Patron fee split', () => {
  it('splits 100 000 into DAO 20 000, Patron 12 000 (12 % of gross), Protocol 68 000, summing exactly', () => {
    const s = splitPlatformFee(100_000n, { daoShareBp: 2_000, patronActive: true });
    expect(s).toEqual({ dao: 20_000n, patron: 12_000n, protocol: 68_000n });
  });

  it('sums exactly for odd amounts, pays no patron without one, and clamps a negative gross', () => {
    for (const gross of [1n, 7n, 65_001n, 99_999n, 123_456_789n]) {
      const s = splitPlatformFee(gross, { daoShareBp: 2_000, patronActive: true });
      expect(s.protocol + s.dao + s.patron).toBe(gross);
    }
    expect(splitPlatformFee(100_000n, { daoShareBp: 2_000, patronActive: false })).toEqual({ dao: 20_000n, patron: 0n, protocol: 80_000n });
    expect(splitPlatformFee(-5n, { daoShareBp: 2_000, patronActive: true })).toEqual({ dao: 0n, patron: 0n, protocol: 0n });
  });
});

describe('W28-06 Guild radar lead (Tier 2+ five minutes early)', () => {
  const window = { npcId: 'kestrel', planetId: 'p', name: 'Kestrel', arriveAt: NOW + 600_000, departAt: NOW + 900_000 };

  it('Tier 2+ sees the ship 5 min before arrival; a Tier 1 wallet sees it only at arrival', () => {
    const lead = perksFor(50, 4).guildRadarLeadMs;
    expect(lead).toBe(300_000);
    const at = NOW + 400_000;
    expect(radarVisits([window], lead, at)[0]).toMatchObject({ noticeAt: window.arriveAt - 300_000, visibleNow: true, early: true });
    expect(radarVisits([window], perksFor(10, 4).guildRadarLeadMs, at)[0]).toMatchObject({ visibleNow: false, early: false });
  });

  it('is invisible before the notice, not early once docked, and gone after departure', () => {
    expect(radarVisits([window], 300_000, NOW)[0]!.visibleNow).toBe(false);
    expect(radarVisits([window], 300_000, window.arriveAt + 1)[0]).toMatchObject({ visibleNow: true, early: false });
    expect(radarVisits([window], 300_000, window.departAt)).toEqual([]);
  });
});

describe('W28-06 DAO vote weight (Tier 3+ 1.5x)', () => {
  const members = ['a', 'b', 'c', 'd'];
  const vote = (voter: string, weightBp?: number): StoredVote => ({ voter, vote: 'approve', ...(weightBp ? { weightBp } : {}) });
  const reject = (voter: string): StoredVote => ({ voter, vote: 'reject' });

  it('Tier 3 carries 15 000 bp, Tier 2 and below 10 000', () => {
    expect(perksFor(200, 4).daoVoteWeightBp).toBe(15_000);
    expect(perksFor(50, 4).daoVoteWeightBp).toBe(BASE_VOTE_WEIGHT_BP);
  });

  it('unweighted votes behave exactly as before (3 of 4 passes strictly above 50 %, 2 yes + 1 no of 4 does not)', () => {
    expect(proposalPasses(tallyMemberVotes([vote('a'), vote('b'), vote('c')], members))).toBe(true);
    expect(proposalPasses(tallyMemberVotes([vote('a'), vote('b'), reject('c')], members))).toBe(false);
  });

  it('a 1.5x voter tips the 50 % line: yes(1.5x) + yes + no of 4 passes, the same votes at 1x do not', () => {
    expect(proposalPasses(tallyMemberVotes([vote('a', 15_000), vote('b'), reject('c')], members))).toBe(true);
    expect(tallyMemberVotes([vote('a', 15_000), vote('b'), reject('c')], members).yesWeightBp).toBe(25_000);
    expect(proposalPasses(tallyMemberVotes([vote('a'), vote('b'), reject('c')], members))).toBe(false);
  });

  it('weight never rescues a rejected or removed member and ignores voters who left the council', () => {
    const no: StoredVote = { voter: 'c', vote: 'reject', weightBp: 15_000 };
    expect(tallyMemberVotes([vote('a', 15_000), no], members)).toMatchObject({ yes: 1, no: 1, yesWeightBp: 15_000 });
    expect(proposalPasses(tallyMemberVotes([vote('ghost', 15_000), vote('a')], members))).toBe(false);
  });
});
