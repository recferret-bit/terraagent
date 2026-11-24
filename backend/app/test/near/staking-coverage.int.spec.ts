import 'reflect-metadata';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { CANONICAL_PLANETS, StakingActionResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { EventBus } from '../../src/bus/event-bus';
import { ColonySlotAllowanceService } from '../../src/core/home/colony-slot-allowance.service';
import { FlagsService } from '../../src/flags/flags.service';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { clearNep413ReplayCache, signNep413Message } from '../../src/near/identity/nep413-verifier';
import { RelayStatusService } from '../../src/near/identity/relay-status.service';
import { enforceWalletRelayQuota, resetWalletRelayQuotasForTests } from '../../src/near/identity/wallet-relay-quota';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter';
import { encodeBase58 } from '../../src/near/keystore/base58';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service';
import { verifyStakingWalletSignature } from '../../src/near/staking/staking-signature-guard';
import { StakingService } from '../../src/near/staking/staking.service';
import { nearToYocto } from '../../src/near/staking/yocto';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service';
import { TreasuryController } from '../../src/near/treasury/treasury.controller';
import { voteWeightBp } from '../../src/near/treasury/vote-weight';
import { devPlayerId } from '../../src/ws/session-verifier';

const POOL = 'astro-stakers.pool.mock';
const DESERT = CANONICAL_PLANETS.desert.id;
const OCEAN = CANONICAL_PLANETS.ocean.id;
const JWT_SECRET = 'staking-coverage-jwt-secret-0123456789';

let db: TestDatabase;
const apps: INestApplication[] = [];

interface BootedApp {
  readonly app: INestApplication;
  readonly url: string;
  readonly staking: StakingService;
}

async function boot(waves: string, extraEnv: Record<string, string> = {}): Promise<BootedApp> {
  const created = await createApp({
    source: {
      NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: JWT_SECRET, MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0', TA_WAVES: waves, ...extraEnv,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url, staking: created.app.get(StakingService, { strict: false }) };
}

let allApp: BootedApp;
let localApp: BootedApp;
let offApp: BootedApp;

beforeAll(async () => {
  db = await createTestDatabase();
  allApp = await boot('all');
  localApp = await boot('all', { NEAR_MODE: 'local', NEAR_PROTOCOL_ACCOUNT: 'protocol.local.mock' });
  offApp = await boot('..27');
}, 180_000);

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await db?.drop();
});

async function linkWallet(name: string): Promise<{ accountId: string; playerId: string; auth: Record<string, string> }> {
  const accountId = `${name}.near`;
  const playerId = devPlayerId(name);
  await db.prisma.socialIdentity.create({
    data: { id: `si_cov_${name}`, playerId, provider: 'near', subject: accountId, accountId },
  });
  return { accountId, playerId, auth: { authorization: `Bearer dev:${name}` } };
}

describe('W28 Integration Part 1: Protocol Telemetry, Session Keys, Replay Guard & Position Sync', () => {
  it('1. GET /v1/near/protocol returns mock/local telemetry with W28 4-tier fee schedule', async () => {
    const rMock = await fetch(`${allApp.url}/v1/near/protocol`);
    expect(rMock.status).toBe(200);
    const bMock = (await rMock.json()) as Record<string, unknown>;
    expect(bMock.entityName).toBe('TerraAgent Protocol');
    expect((bMock.feeSchedule as { tierTakerFeeBp?: number[] }).tierTakerFeeBp).toEqual([100, 65, 50, 35, 25]);

    const rLocal = await fetch(`${localApp.url}/v1/near/protocol`);
    expect(rLocal.status).toBe(200);
    const bLocal = (await rLocal.json()) as Record<string, unknown>;
    expect(bLocal.nearMode).toBe('local');
    expect(bLocal.protocolAccountId).toBe('protocol.local.mock');
  });

  it('2. claim-account + DELETE/POST /v1/near/claim-account/session-key persists revocation and reauthorization in Postgres', async () => {
    const { accountId, auth } = await linkWallet('sess_pilot');
    const claimRes = await fetch(`${allApp.url}/v1/near/claim-account`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ colonyId: 'co_sess', walletAccountId: accountId }),
    });
    expect(claimRes.status).toBe(200);
    const claimed = (await claimRes.json()) as { accountId: string; tradingSessionPublicKey?: string };
    expect(claimed.tradingSessionPublicKey).toBeTruthy();

    const hijackRes = await fetch(`${allApp.url}/v1/near/claim-account`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ colonyId: 'co_sess', walletAccountId: 'other-wallet.near' }),
    });
    expect(hijackRes.status).toBe(403);

    expect((await fetch(`${allApp.url}/v1/near/claim-account/session-key?colonyId=co_sess`, { method: 'DELETE', headers: auth })).status).toBe(200);
    expect((await db.prisma.nearColonyAccount.findUnique({ where: { accountId: claimed.accountId } }))?.tradingSessionPublicKey).toBeNull();

    const reauthRes = await fetch(`${allApp.url}/v1/near/claim-account/session-key`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ colonyId: 'co_sess' }),
    });
    expect(reauthRes.status).toBe(200);
    const afterReauth = await db.prisma.nearColonyAccount.findUnique({ where: { accountId: claimed.accountId } });
    expect(afterReauth?.tradingSessionPublicKey).toBeTruthy();
    expect(afterReauth?.tradingSessionPublicKey).not.toBe(claimed.tradingSessionPublicKey);
  });

  it('3. verifyStakingWalletSignature persists NEP-413 nonce in Postgres and blocks replay across cache clears', async () => {
    clearNep413ReplayCache();
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubStr = `ed25519:${encodeBase58(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))}`;
    const sig = signNep413Message({
      accountId: 'sigwallet.testnet', publicKey: pubStr, privateKey,
      message: 'stake:co_sig:astro-stakers.poolv1.testnet:10', nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'staking.terraagent.testnet',
    });
    const baseParams = {
      sig, action: 'stake' as const, colonyId: 'co_sig',
      claimInfo: { claimed: true, accountId: 'sigwallet.testnet', claimedAt: new Date().toISOString(), claimedByAccountId: 'sigwallet.testnet', claimedPublicKey: pubStr },
      poolId: 'astro-stakers.poolv1.testnet', amount: '10',
      envMap: { NODE_ENV: 'test', NEAR_ADAPTER_STAKING: 'testnet', NEAR_CONTRACT_STAKING: 'staking.terraagent.testnet' },
      keyVerifier: async (_acct: string, pk: string) => { if (pk !== pubStr) throw new Error('Key is not an authorized FullAccess key'); },
      prisma: db.prisma,
    };
    await expect(verifyStakingWalletSignature(baseParams)).resolves.toBeUndefined();
    expect(await db.prisma.nep413UsedNonce.count({ where: { accountId: 'sigwallet.testnet' } })).toBeGreaterThanOrEqual(1);
    clearNep413ReplayCache();
    await expect(verifyStakingWalletSignature(baseParams)).rejects.toThrow(/nonce/i);
  });

  it('4. StakingPositionSyncService syncs native + LST (stNEAR) positions into Postgres and refreshes patron seat', async () => {
    const acct = 'sync_whale.near';
    const fakePort = {
      listPools: async () => [{ poolId: POOL, name: 'Astro', apyBp: 900 }],
      accountPositions: async (a: string) =>
        a === acct
          ? [
              { accountId: acct, pool: POOL, staked: nearToYocto(300), unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null, stakedSinceMs: 1_700_000_000_000, lastStakedAtMs: 1_700_000_000_000, asset: 'near' as const },
              { accountId: acct, pool: 'meta-pool.mock', staked: nearToYocto(250), unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null, stakedSinceMs: 1_700_000_000_000, lastStakedAtMs: 1_700_000_000_000, asset: 'stNEAR' as const },
            ]
          : [],
      position: async (q: { pool: string }) => ({
        accountId: acct, pool: q.pool, staked: nearToYocto(q.pool === POOL ? 300 : 250), unbonding: '0', withdrawable: '0', rewards: '0',
        unbondingReadyAtMs: null, stakedSinceMs: 1_700_000_000_000, lastStakedAtMs: 1_700_000_000_000, asset: (q.pool === POOL ? 'near' : 'stNEAR') as 'near' | 'stNEAR',
      }),
      rewards: async () => ({ accrued: '0' }),
    };
    await db.prisma.stakingPatronNomination.create({ data: { accountId: acct, planetId: DESERT } });
    const syncSvc = new StakingPositionSyncService(fakePort as never, { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: 'all' } as never, db.prisma, { has: () => true } as never);
    expect((await syncSvc.syncAccountPositions(acct, undefined, true)).length).toBeGreaterThanOrEqual(2);
    expect((await db.prisma.stakingPosition.findMany({ where: { accountId: acct } })).some((r) => r.asset === 'stNEAR')).toBe(true);
    expect((await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: DESERT } }))?.accountId).toBe(acct);
  });
});

describe('W28 Integration Part 2: Patronage Multi-Account, Radar, Relay Quota & Colony Slots', () => {
  it('5. multi-account sibling Patron nomination vacates prior planet seat and updates new planet seat', async () => {
    await db.prisma.planet.upsert({ where: { id: DESERT }, create: { id: DESERT, name: 'Kharon Dunes', admission: 'OPEN' }, update: { admission: 'OPEN' } });
    await db.prisma.planet.upsert({ where: { id: OCEAN }, create: { id: OCEAN, name: 'Thalassa Verde', admission: 'OPEN' }, update: { admission: 'OPEN' } });
    const playerId = devPlayerId('multi_patron');
    await db.prisma.socialIdentity.createMany({
      data: [
        { id: 'si_pat_a', playerId, provider: 'near', subject: 'pat-a.near', accountId: 'pat-a.near' },
        { id: 'si_pat_b', playerId, provider: 'google', subject: 'sub_pat_b', accountId: 'pat-b.near' },
      ],
    });
    const auth = { authorization: 'Bearer dev:multi_patron' };
    await allApp.staking.fundWalletNear('pat-a.near', '650');
    const stRes = await fetch(`${allApp.url}/v1/near/stake`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ accountId: 'pat-a.near', pool: POOL, amount: '620' }),
    });
    expect(stRes.status).toBe(200);
    StakingActionResponse.parse(await stRes.json());

    expect((await fetch(`${allApp.url}/v1/near/staking/patron/nominate`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ accountId: 'pat-a.near', planetId: DESERT }),
    })).status).toBe(200);
    expect((await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: DESERT } }))?.accountId).toBe('pat-a.near');

    expect((await fetch(`${allApp.url}/v1/near/staking/patron/nominate`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ accountId: 'pat-b.near', planetId: OCEAN }),
    })).status).toBe(200);
    expect(await db.prisma.stakingPatronNomination.findUnique({ where: { accountId: 'pat-a.near' } })).toBeNull();
    expect((await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: DESERT } }))?.accountId).not.toBe('pat-a.near');
    expect((await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: OCEAN } }))?.accountId).toBe('pat-b.near');
  });

  it('6. GET /v1/market/guild/radar grants 300s lead to Tier 2+ stakers, 0 to Tier 0 and W28 off', async () => {
    const { accountId, auth } = await linkWallet('radar_pilot');
    expect(((await (await fetch(`${allApp.url}/v1/market/guild/radar?planetId=${DESERT}&accountId=${accountId}`)).json()) as { leadMs: number }).leadMs).toBe(0);
    await allApp.staking.fundWalletNear(accountId, '60');
    await fetch(`${allApp.url}/v1/near/stake`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ accountId, pool: POOL, amount: '55' }),
    });
    expect(((await (await fetch(`${allApp.url}/v1/market/guild/radar?planetId=${DESERT}&accountId=${accountId}`)).json()) as { leadMs: number }).leadMs).toBe(300_000);
    expect(((await (await fetch(`${offApp.url}/v1/market/guild/radar?planetId=${DESERT}&accountId=${accountId}`)).json()) as { leadMs: number }).leadMs).toBe(0);
    expect((await fetch(`${allApp.url}/v1/market/guild/radar`)).status).toBe(400);
  });

  it('7. enforceWalletRelayQuota scales by Postgres staking tier and malformed delegate does not burn quota', async () => {
    resetWalletRelayQuotasForTests();
    const { accountId, playerId } = await linkWallet('relay_tier');
    await db.prisma.stakingPosition.create({ data: { colonyId: accountId, poolId: POOL, accountId, stakedSnapshot: nearToYocto(55) } });
    const quota = await enforceWalletRelayQuota({
      prisma: db.prisma, env: { DATABASE_URL: db.url, NEAR_RELAYER_WALLET_DAILY_TX_BASE: '5' }, w28: true, playerId, signerId: accountId,
    });
    expect(quota).toMatchObject({ used: 1, cap: 20, gasMultiplier: 4 });
    const relaySvc = allApp.app.get(RelayStatusService, { strict: false });
    await expect(
      relaySvc.submitMetaTx({ headers: { authorization: 'Bearer dev:relay_tier' } } as never, { signerId: accountId, receiverId: 'res.terraagent.mock', signedDelegate: 'invalid_base64_borsh_payload' }),
    ).rejects.toThrow();
    const nextQuota = await enforceWalletRelayQuota({
      prisma: db.prisma, env: { DATABASE_URL: db.url, NEAR_RELAYER_WALLET_DAILY_TX_BASE: '5' }, w28: true, playerId, signerId: accountId,
    });
    expect(nextQuota.used).toBe(2);
  });

  it('8. ColonySlotAllowanceService resolves Tier 0 -> 1, Tier 2 -> 3, Tier 4 -> 12 from Postgres staking_position', async () => {
    const { accountId, playerId } = await linkWallet('slots_pilot');
    const slotSvc = new ColonySlotAllowanceService(db.prisma, { NODE_ENV: 'test', DATABASE_URL: db.url } as never);
    expect((await slotSvc.resolveForPlayer(playerId)).max).toBe(1);
    await db.prisma.stakingPosition.create({ data: { colonyId: accountId, poolId: POOL, accountId, stakedSnapshot: nearToYocto(50) } });
    expect((await slotSvc.resolveForPlayer(playerId)).max).toBe(3);
    await db.prisma.stakingPosition.updateMany({ where: { accountId }, data: { stakedSnapshot: nearToYocto(500) } });
    expect((await slotSvc.resolveForPlayer(playerId)).max).toBe(12);
  });
});

describe('W28 Integration Part 3: DAO Vote Weight, AI Access & Wallet-Tx HTTP Descriptors', () => {
  it('9. TreasuryProposalsService.vote + voteWeightBp applies 1.5x weight for Tier 3+ staker on Postgres', async () => {
    const daoEnv = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: 'all' };
    const flags = new FlagsService(daoEnv as never);
    const dao = new MockTreasuryDaoAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 9 }, { sleep: async () => undefined });
    const outbox = new ChainOutboxRepository(db.prisma);
    const lifecycle = new PlanetDaoLifecycleService(flags, dao, outbox, db.prisma, daoEnv as never);
    const ctrl = new TreasuryController(new TreasuryProposalsService(flags, lifecycle, dao, db.prisma, daoEnv as never, outbox, new EventBus()), flags);

    const tier3Acct = 'dao-whale.pilot.terraagent.mock';
    const tier0Acct = 'dao-cadet.pilot.terraagent.mock';
    await db.prisma.stakingPosition.create({ data: { colonyId: tier3Acct, poolId: POOL, accountId: tier3Acct, stakedSnapshot: nearToYocto(220) } });
    expect(await voteWeightBp(db.prisma, daoEnv, true, tier3Acct)).toBe(15_000);
    expect(await voteWeightBp(db.prisma, daoEnv, true, tier0Acct)).toBe(10_000);

    const c = await ctrl.council('pl-vote-weight');
    await dao.deposit({ opId: 'dep:vw', daoAccountId: c.daoAccountId, from: tier3Acct, tokenId: 'metals.t1', amount: '2000' });
    await dao.addMember({ opId: 'm:t3', daoAccountId: c.daoAccountId, member: tier3Acct });
    await dao.addMember({ opId: 'm:t0', daoAccountId: c.daoAccountId, member: tier0Acct });
    const prop = await ctrl.propose('pl-vote-weight', { kind: 'meteor_shield', colonyAccountId: tier3Acct, description: 'Shield' }, { headers: {} } as never);
    const vWhale = await ctrl.vote('pl-vote-weight', String(prop.proposalId), { vote: 'approve', colonyAccountId: tier3Acct }, { headers: {} } as never);
    expect(vWhale.yes).toBeGreaterThanOrEqual(1);
  });

  it('10. GET /v1/near/staking/ai-access distinguishes guest/trial/tee and 404s when W28 is off', async () => {
    const { accountId, playerId, auth } = await linkWallet('ai_pilot');
    await db.prisma.planet.upsert({ where: { id: DESERT }, create: { id: DESERT, name: 'Kharon Dunes', admission: 'OPEN' }, update: {} });
    await db.prisma.colony.create({ data: { id: 'col_ai_1', planetId: DESERT, playerId, name: 'AI Test Col', colonyIndex: 0 } });
    const trialRes = await fetch(`${allApp.url}/v1/near/staking/ai-access?colonyId=col_ai_1`, { headers: auth });
    expect(trialRes.status).toBe(200);
    expect(['trial', 'script']).toContain(((await trialRes.json()) as { aiBudget: { mode: string } }).aiBudget.mode);

    await allApp.staking.fundWalletNear(accountId, '60');
    await fetch(`${allApp.url}/v1/near/stake`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ accountId, pool: POOL, amount: '55' }) });
    const teeRes = await fetch(`${allApp.url}/v1/near/staking/ai-access?colonyId=col_ai_1`, { headers: auth });
    expect(teeRes.status).toBe(200);
    expect(((await teeRes.json()) as { aiBudget: { mode: string } }).aiBudget.mode).toBe('tee');
    expect((await fetch(`${offApp.url}/v1/near/staking/ai-access?colonyId=col_ai_1`, { headers: auth })).status).toBe(404);
  });

  it('12. GET /v1/near/staking/wallet-tx validates valid descriptors and rejects invalid inputs with 400', async () => {
    const okStake = await fetch(`${allApp.url}/v1/near/staking/wallet-tx?action=stake_payable&poolId=${POOL}&amountNear=10&accountId=pilot.mock`);
    expect(okStake.status).toBe(200);
    expect(((await okStake.json()) as { methodName: string }).methodName).toBe('stake_payable');
    const okCompoundLst = await fetch(`${allApp.url}/v1/near/staking/wallet-tx?action=compound_yield&poolId=meta-pool.mock&accountId=pilot.mock`);
    expect(okCompoundLst.status).toBe(200);
    expect(((await okCompoundLst.json()) as { args: { apy_bp: number } }).args.apy_bp).toBe(0);
    expect((await fetch(`${allApp.url}/v1/near/staking/wallet-tx?action=deposit_and_stake_lst&lstContract=evil.near&amountNear=5`)).status).toBe(400);
    expect((await fetch(`${allApp.url}/v1/near/staking/wallet-tx?action=stake_payable&poolId=${POOL}&amountNear=0`)).status).toBe(400);
    expect((await fetch(`${allApp.url}/v1/near/staking/wallet-tx?action=unknown_action`)).status).toBe(400);
  });
});
