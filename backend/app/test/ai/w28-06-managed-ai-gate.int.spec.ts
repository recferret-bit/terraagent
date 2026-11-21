import 'reflect-metadata';
import { MANAGED_AI_MODEL, SCRIPT_AI_MODEL, STAKING_RULES } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ManagedAiGate } from '../../src/ai/colony-agent/managed-ai-gate.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { AiSlotLedger } from '../../src/near/staking/perks/ai-slot.ledger.js';
import { nearToYocto } from '../../src/near/staking/yocto.js';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DAY = 86_400_000;
const env = { NODE_ENV: 'test', DATABASE_URL: 'x' } as unknown as AppEnv;
let db: TestDatabase;
let slots: AiSlotLedger;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});
beforeEach(async () => {
  slots = new AiSlotLedger();
  const p = db.prisma;
  await p.stakingPosition.deleteMany({});
  await p.nearColonyAccount.deleteMany({});
  await p.aiWalletUsage.deleteMany({});
  await p.aiFreeTrial.deleteMany({});
  await p.socialIdentity.deleteMany({});
  await p.colony.deleteMany({});
});

const gate = (price = 4) => new ManagedAiGate(db.prisma, env, slots, { priceProvider: { nearUsd: () => price } });

async function wallet(owner: string, colonies: number, stakeNear: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < colonies; i++) {
    const colonyId = `${owner}-c${i}`;
    ids.push(colonyId);
    await db.prisma.nearColonyAccount.create({
      data: { accountId: `${colonyId}.mock`, playerId: `pl-${owner}`, slot: colonyId, colonyId, ownerAccountId: `${owner}.near`, publicKey: 'ed25519:t', encryptedSecret: 'x', kekVersion: 1 },
    });
  }
  if (stakeNear > 0) {
    await db.prisma.stakingPosition.create({
      data: { colonyId: ids[0]!, poolId: 'pool.mock', accountId: `${owner}.near`, stakedSnapshot: nearToYocto(stakeNear), stakedSinceAt: new Date(NOW - 3 * DAY), lastStakedAt: new Date(NOW - 3 * DAY) },
    });
  }
  return ids;
}

describe('W28-06 free trial ledger (Postgres)', () => {
  it('a verified pilot gets exactly 5 trial turns, then script; never a 6th', async () => {
    await db.prisma.socialIdentity.create({ data: { id: 'si1', playerId: 'pv', provider: 'google', subject: 's1', accountId: 'pv.near' } });
    const out: string[] = [];
    for (let i = 0; i < 7; i++) out.push((await gate().admit({ id: 'solo', playerId: 'pv' }, NOW)).mode);
    expect(out).toEqual(['trial', 'trial', 'trial', 'trial', 'trial', 'script', 'script']);
    expect((await db.prisma.aiFreeTrial.findUniqueOrThrow({ where: { playerId: 'pv' } })).turnsUsed).toBe(STAKING_RULES.freeTrialTurns);
  });

  it('concurrent trial turns never exceed 5', async () => {
    await db.prisma.socialIdentity.create({ data: { id: 'si2', playerId: 'pc', provider: 'x', subject: 's2', accountId: 'pc.near' } });
    const res = await Promise.all(Array.from({ length: 16 }, () => gate().admit({ id: 'solo2', playerId: 'pc' }, NOW)));
    expect(res.filter((r) => r.mode === 'trial')).toHaveLength(5);
    expect(res.filter((r) => r.mode === 'script' && r.reason === 'trial_exhausted')).toHaveLength(11);
    expect((await db.prisma.aiFreeTrial.findUniqueOrThrow({ where: { playerId: 'pc' } })).turnsUsed).toBe(5);
  });

  it('an anonymous guest gets none and writes no trial row', async () => {
    const out = await gate().admit({ id: 'g1', playerId: 'guest-1' }, NOW);
    expect(out).toMatchObject({ mode: 'script', reason: 'guest', model: SCRIPT_AI_MODEL });
    expect(await db.prisma.aiFreeTrial.count()).toBe(0);
  });

  it('resolves scenario colonies (sim id col_0 != DB id co_...) via (planetId, colonyIndex) for both 5-turn trial and wallet-first stake', async () => {
    await db.prisma.colony.create({
      data: { id: 'co_w28_0', playerId: 'p-scn', planetId: 'scn_w28_test', colonyIndex: 0, name: 'Scenario Hub' },
    });
    await db.prisma.socialIdentity.create({
      data: { id: 'si-scn', playerId: 'p-scn', provider: 'near', subject: 'scn.near', accountId: 'scn.near' },
    });
    // Zero near_colony_account rows, sim state only knows id='col_0' without playerId:
    const first = await gate().admit({ id: 'col_0', planetId: 'scn_w28_test', colonyIndex: 0 }, NOW);
    expect(first).toMatchObject({ mode: 'trial', trialTurnsLeft: 4 });
    // Now wallet stakes >= 10 NEAR wallet-first (colonyId='wallet:scn.near'):
    await db.prisma.stakingPosition.create({
      data: {
        colonyId: 'wallet:scn.near',
        poolId: 'pool.mock',
        accountId: 'scn.near',
        stakedSnapshot: nearToYocto(15),
        stakedSinceAt: new Date(NOW - DAY),
        lastStakedAt: new Date(NOW - DAY),
      },
    });
    const upgraded = await gate().admit({ id: 'col_0', planetId: 'scn_w28_test', colonyIndex: 0 }, NOW);
    expect(upgraded).toMatchObject({ mode: 'tee', model: MANAGED_AI_MODEL });
  });
});

describe('W28-06 wallet-shared budget and slots (Postgres)', () => {
  it('a 10-colony Sybil wallet at Tier 2 runs 3 colonies on one shared budget; the other 7 downshift', async () => {
    const ids = await wallet('sybil', 10, 50);
    const out = await Promise.all(ids.map((id) => gate().admit({ id }, NOW)));
    expect(out.filter((o) => o.mode === 'tee')).toHaveLength(3);
    expect(out.filter((o) => o.reason === 'slot_cap')).toHaveLength(7);
    const row = await db.prisma.aiWalletUsage.findFirstOrThrow({ where: { walletKey: 'sybil.near' } });
    expect(row.callsUsed).toBe(3);
  });

  it('the daily call limit holds under concurrency: $4 gives 18 calls, $0.50 gives 2, wallet-wide', async () => {
    const a = await wallet('rich', 1, 10);
    const hi = await Promise.all(Array.from({ length: 30 }, () => gate(4).admit({ id: a[0]! }, NOW)));
    expect(hi.filter((o) => o.mode === 'tee')).toHaveLength(18);
    expect(hi.filter((o) => o.reason === 'budget_exhausted')).toHaveLength(12);
    const b = await wallet('poor', 1, 10);
    const lo = await Promise.all(Array.from({ length: 6 }, () => gate(0.5).admit({ id: b[0]! }, NOW)));
    expect(lo.filter((o) => o.mode === 'tee')).toHaveLength(2);
  });

  it('view reports budget used / cap and slots, and byok overrides the mode', async () => {
    const ids = await wallet('viewer', 2, 10);
    await gate().admit({ id: ids[0]! }, NOW);
    const v = await gate().view({ id: ids[1]! }, { nowMs: NOW });
    expect(v).toMatchObject({ mode: 'script', model: SCRIPT_AI_MODEL, dailyCallsUsed: 1, dailyCallLimit: 18, colonySlotsUsed: 1, colonySlotsMax: 1 });
    expect(await gate().view({ id: ids[1]! }, { nowMs: NOW, byok: true })).toMatchObject({ mode: 'byok' });
    expect((await gate().view({ id: ids[0]! }, { nowMs: NOW })).model).toBe(MANAGED_AI_MODEL);
  });
});
