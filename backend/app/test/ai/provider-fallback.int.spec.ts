import 'reflect-metadata';
import { SCRIPT_AI_MODEL } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NearAiLlmAdapter, type FetchLike } from '../../src/ai/adapters/nearai-llm.adapter.js';
import { ColonyAgentLoopService } from '../../src/ai/colony-agent/colony-agent-loop.service.js';
import { ManagedAiGate } from '../../src/ai/colony-agent/managed-ai-gate.js';
import { PlanetHumanActivity } from '../../src/ai/colony-agent/planet-activity.js';
import { AiAccessController } from '../../src/ai/colony-agent/ai-access.controller.js';
import { GuardedLlmProvider } from '../../src/ai/provider/guarded-llm.js';
import { ProviderHealth, providerHealth } from '../../src/ai/provider/provider-health.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { sealPlayerApiKey } from '../../src/profile/player-ai-settings.store.js';
import { AiSlotLedger } from '../../src/near/staking/perks/ai-slot.ledger.js';
import { nearToYocto } from '../../src/near/staking/yocto.js';
import { LlmProviderError } from '../../src/ports/llm-provider.port.js';
import { createFakePlanetHarness } from './fake-planet-harness.js';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DAY = 86_400_000;
const env = { NODE_ENV: 'test', DATABASE_URL: 'x', TA_WAVES: 'all', NEAR_AI_API_KEY: 'protocol-key', NEAR_AI_ATTEST: '0' } as unknown as AppEnv;
const NO_CREDITS = JSON.stringify({ error: { message: 'No credits available.', type: 'no_credits' } });
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});
beforeEach(async () => {
  const p = db.prisma;
  await p.stakingPosition.deleteMany({});
  await p.nearColonyAccount.deleteMany({});
  await p.aiWalletUsage.deleteMany({});
  await p.aiFreeTrial.deleteMany({});
  await p.socialIdentity.deleteMany({});
  await p.colony.deleteMany({});
});

/** One staked (Tier 1, 10 NEAR) wallet owning `colonyId`. */
async function stakedColony(owner: string, colonyId: string): Promise<void> {
  await db.prisma.nearColonyAccount.create({
    data: { accountId: `${colonyId}.mock`, playerId: `pl-${owner}`, slot: colonyId, colonyId, ownerAccountId: `${owner}.near`, publicKey: 'ed25519:t', encryptedSecret: 'x', kekVersion: 1 },
  });
  await db.prisma.stakingPosition.create({
    data: { colonyId, poolId: 'pool.mock', accountId: `${owner}.near`, stakedSnapshot: nearToYocto(10), stakedSinceAt: new Date(NOW - 3 * DAY), lastStakedAt: new Date(NOW - 3 * DAY) },
  });
}

const callsUsed = async (walletKey: string): Promise<number> =>
  (await db.prisma.aiWalletUsage.findFirst({ where: { walletKey } }))?.callsUsed ?? 0;

describe('managed AI charge vs provider state (Postgres)', () => {
  it('an open protocol circuit downshifts with provider_unfunded and charges nothing', async () => {
    await stakedColony('open', 'c-open');
    const health = new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 });
    health.settle(undefined, new LlmProviderError('unfunded', 'NEAR AI Cloud HTTP 402', 402));
    const gate = new ManagedAiGate(db.prisma, env, new AiSlotLedger(), undefined, health);
    expect(await gate.admit({ id: 'c-open' }, NOW)).toMatchObject({ mode: 'script', model: SCRIPT_AI_MODEL, reason: 'provider_unfunded' });
    expect(await callsUsed('open.near')).toBe(0);
    expect(await gate.view({ id: 'c-open' }, { nowMs: NOW })).toMatchObject({ mode: 'script', downshiftReason: 'provider_unfunded', dailyCallsUsed: 0 });
  });

  it('refund gives back the wallet call (once) and the trial turn', async () => {
    await stakedColony('ref', 'c-ref');
    const gate = new ManagedAiGate(db.prisma, env, new AiSlotLedger(), undefined, new ProviderHealth());
    const tee = await gate.admit({ id: 'c-ref' }, NOW);
    expect(tee.mode).toBe('tee');
    expect(await callsUsed('ref.near')).toBe(1);
    expect(await gate.refund(tee)).toBe(true);
    expect(await gate.refund(tee)).toBe(false);
    const row = await db.prisma.aiWalletUsage.findFirstOrThrow({ where: { walletKey: 'ref.near' } });
    expect(row.callsUsed).toBe(0);
    expect(row.usdMicros).toBe(0n);

    await db.prisma.socialIdentity.create({ data: { id: 'si-t', playerId: 'pt', provider: 'google', subject: 'st', accountId: 'pt.near' } });
    const trial = await gate.admit({ id: 'solo', playerId: 'pt' }, NOW);
    expect(trial).toMatchObject({ mode: 'trial', trialTurnsLeft: 4 });
    expect(await gate.refund(trial)).toBe(true);
    expect((await db.prisma.aiFreeTrial.findUniqueOrThrow({ where: { playerId: 'pt' } })).turnsUsed).toBe(0);
  });

  it('colony loop with a 402 provider: the staker colony plays on rules and its wallet is not charged', async () => {
    await stakedColony('loop', 'col_0');
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(NO_CREDITS, { status: 402 });
    };
    const health = new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 });
    const llm = new GuardedLlmProvider(new NearAiLlmAdapter(fetchImpl, env), health);
    const h = createFakePlanetHarness();
    h.host.state.colonies[0]!.aiEnabled = true;
    const svc = new ColonyAgentLoopService(h.planets, llm, undefined, db.prisma, env);
    const evals = await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {}, nowMs: NOW });
    const col0 = evals.find((e) => e.colonyIndex === 0)!;
    expect(col0.model).toBe(SCRIPT_AI_MODEL);
    expect(col0.aiAccess).toMatchObject({ mode: 'script', reason: 'provider_unfunded' });
    expect(await callsUsed('loop.near')).toBe(0);
    // the next tick makes no HTTP call and no charge: the gate sees the open circuit first
    await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {}, nowMs: NOW + 1 });
    expect(calls).toBe(1);
    expect(await callsUsed('loop.near')).toBe(0);
  });

  it('colony loop, staker first to hit the 402: charged, then refunded in the same turn', async () => {
    await stakedColony('first', 'col_0');
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(NO_CREDITS, { status: 402 });
    };
    const llm = new GuardedLlmProvider(new NearAiLlmAdapter(fetchImpl, env), new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 }));
    const h = createFakePlanetHarness();
    h.host.state.colonies[0]!.aiEnabled = true;
    for (const i of [4, 5]) h.host.state.colonies[i]!.status = 'eliminated'; // no bot batch: the managed turn is the first call
    const svc = new ColonyAgentLoopService(h.planets, llm, undefined, db.prisma, env);
    const col0 = (await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {}, nowMs: NOW })).find((e) => e.colonyIndex === 0)!;
    expect(calls).toBe(1);
    expect(col0.aiAccess).toMatchObject({ mode: 'script', reason: 'provider_unfunded' });
    expect(col0.model).toBe(SCRIPT_AI_MODEL);
    expect(col0.governed).toBe(true);
    const row = await db.prisma.aiWalletUsage.findFirstOrThrow({ where: { walletKey: 'first.near' } }); // the charge happened
    expect(row.callsUsed).toBe(0); // and was given back
    expect(row.usdMicros).toBe(0n);
  });

  it('GET ai-access: a sealed BYOK key whose circuit is open shows byok + provider_unfunded (same fingerprint as the guard)', async () => {
    await db.prisma.player.create({ data: { id: 'p-byok', handle: 'byok-pilot', nearAiApiKey: sealPlayerApiKey('sk-drained-key') } });
    await db.prisma.colony.create({ data: { id: 'co_byok', playerId: 'p-byok', planetId: 'pl_byok', colonyIndex: 0, name: 'Byok' } });
    const controller = new AiAccessController(new FlagsService({ TA_WAVES: 'all' } as never), db.prisma, env);
    providerHealth.reset();
    try {
      expect((await controller.aiAccess('co_byok')).aiBudget).toMatchObject({ mode: 'byok' });
      expect((await controller.aiAccess('co_byok')).aiBudget.downshiftReason).toBeUndefined();
      providerHealth.settle(' sk-drained-key ', new LlmProviderError('unfunded', 'NEAR AI Cloud HTTP 402', 402));
      expect((await controller.aiAccess('co_byok')).aiBudget).toMatchObject({ mode: 'byok', downshiftReason: 'provider_unfunded' });
    } finally {
      providerHealth.reset();
    }
  });

  it('PlanetHumanActivity reads core.colony.last_seen_at for the 24 h window', async () => {
    await db.prisma.colony.create({ data: { id: 'co_seen', playerId: 'p-seen', planetId: 'pl_seen', colonyIndex: 0, name: 'Seen', lastSeenAt: new Date(NOW - 2 * 3_600_000) } });
    await db.prisma.colony.create({ data: { id: 'co_old', playerId: 'p-old', planetId: 'pl_old', colonyIndex: 0, name: 'Old', lastSeenAt: new Date(NOW - 2 * DAY) } });
    const activity = new PlanetHumanActivity(db.prisma, env);
    expect(await activity.recentlyActive('pl_seen', NOW)).toBe(true);
    expect(await activity.recentlyActive('pl_old', NOW)).toBe(false);
    expect(await activity.recentlyActive('pl_none', NOW)).toBe(false);
  });
});
