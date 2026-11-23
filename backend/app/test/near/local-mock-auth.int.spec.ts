import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  AuthResponseSchema,
  CANONICAL_PLANETS,
  HomeResponseSchema,
  MeProfileResponseSchema,
  SocialAuthResponseSchema,
  type HomeResponse,
} from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { advanceMockStakingClockMs, resetMockStakingClock } from '../../src/near/infrastructure/adapters/mock/staking.adapter';

let db: TestDatabase;
let app: INestApplication;
let url: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      SNAPSHOTS: 'on',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'local-mock-auth-int-secret-012345',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
    },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

function refreshCookie(res: Response): string {
  const match = /ta_rt=([^;]*)/.exec(res.headers.get('set-cookie') ?? '');
  if (!match?.[1]) throw new Error('missing ta_rt cookie');
  return match[1];
}

function colonyId(home: HomeResponse): string {
  if (home.state !== 'ACTIVE') throw new Error(`expected ACTIVE, got ${home.state}`);
  return home.colony.id;
}

describe('localhost mock player-name auth — real Postgres persistence', () => {
  it('persists player, social_identity, auth_session, and near_colony_account, and supports refresh + /v1/me/profile', async () => {
    const res = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Commander Nova', mode: 'signup' }),
    });
    expect(res.status).toBe(200);
    const body = SocialAuthResponseSchema.parse(await res.json());
    expect(body.player.handle).toBe('Commander Nova');
    expect(body.player.isGuest).toBe(false);
    expect(body.accountId).toBe('commander-nova.terraagent.mock');
    const cookie = refreshCookie(res);

    const playerRow = await db.prisma.player.findUnique({ where: { id: body.player.id } });
    expect(playerRow?.handle).toBe('Commander Nova');

    const socialRow = await db.prisma.socialIdentity.findUnique({
      where: { provider_subject: { provider: 'local-mock', subject: 'commander nova' } },
    });
    expect(socialRow).toMatchObject({
      playerId: body.player.id,
      provider: 'local-mock',
      subject: 'commander nova',
      accountId: 'commander-nova.terraagent.mock',
    });

    const sessionCount = await db.prisma.authSession.count({
      where: { playerId: body.player.id, revokedAt: null },
    });
    expect(sessionCount).toBe(1);

    const nearAcct = await db.prisma.nearColonyAccount.findUnique({
      where: { playerId_slot: { playerId: body.player.id, slot: 'player' } },
    });
    expect(nearAcct?.accountId).toBe('commander-nova.terraagent.mock');

    const refreshRes = await fetch(`${url}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${cookie}` },
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = AuthResponseSchema.parse(await refreshRes.json());
    expect(refreshed.player.id).toBe(body.player.id);
    expect(refreshed.player.handle).toBe('Commander Nova');
    expect(refreshed.player.isGuest).toBe(false);
    expect(refreshed.accountId).toBe('commander-nova.terraagent.mock');

    const profileRes = await fetch(`${url}/v1/me/profile`, {
      headers: { authorization: `Bearer ${refreshed.accessToken}` },
    });
    expect(profileRes.status).toBe(200);
    const profile = MeProfileResponseSchema.parse(await profileRes.json());
    expect(profile.identity.handle).toBe('Commander Nova');
    expect(profile.identity.isGuest).toBe(false);
    expect(profile.identity.accountId).toBe('commander-nova.terraagent.mock');

    const repeatRes = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'commander nova', mode: 'signin' }),
    });
    expect(repeatRes.status).toBe(200);
    const repeat = SocialAuthResponseSchema.parse(await repeatRes.json());
    expect(repeat.player.id).toBe(body.player.id);
    expect(repeat.player.handle).toBe('Commander Nova');
  }, 60_000);
});

describe('localhost mock player-name auth — guest upgrade & testnet mode', () => {

  it('upgrades a guest with an active colony in place and rejects non-localhost requests without DB writes', async () => {
    const guestRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'local-mock-guest-secret-001' }),
    });
    expect(guestRes.status).toBe(200);
    const guest = AuthResponseSchema.parse(await guestRes.json());
    const oldCookie = refreshCookie(guestRes);

    const homeRes = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${guest.accessToken}` } });
    expect(homeRes.status).toBe(200);
    const seatedColonyId = colonyId(HomeResponseSchema.parse(await homeRes.json()));

    const upgradeRes = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${guest.accessToken}` },
      body: JSON.stringify({ playerName: 'Vanguard One', mode: 'signup' }),
    });
    expect(upgradeRes.status).toBe(200);
    const upgraded = SocialAuthResponseSchema.parse(await upgradeRes.json());
    expect(upgraded.player.id).toBe(guest.player.id);
    expect(upgraded.player.handle).toBe('Vanguard One');
    expect(upgraded.player.isGuest).toBe(false);

    const dbPlayer = await db.prisma.player.findUnique({ where: { id: guest.player.id } });
    expect(dbPlayer?.handle).toBe('Vanguard One');
    expect(await db.prisma.colony.count({ where: { playerId: guest.player.id } })).toBe(1);

    const homeAfter = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${upgraded.accessToken}` } });
    expect(homeAfter.status).toBe(200);
    expect(colonyId(HomeResponseSchema.parse(await homeAfter.json()))).toBe(seatedColonyId);

    const oldRefresh = await fetch(`${url}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${oldCookie}` },
    });
    expect(oldRefresh.status).toBe(401);

    const rejected = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'terraagent.fun' },
      body: JSON.stringify({ playerName: 'Remote Attacker' }),
    });
    expect(rejected.status).toBe(403);
    expect(await db.prisma.player.findUnique({ where: { handle: 'Remote Attacker' } })).toBeNull();
  }, 60_000);

  it('persists under NEAR_MODE=testnet without calling Testnet RPC', async () => {
    const testnetCreated = await createApp({
      source: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        SIM_THREADS: '1',
        SNAPSHOTS: 'off',
        DATABASE_URL: db.url,
        NEAR_MODE: 'testnet',
        NEAR_ROOT_ACCOUNT: 'terraagent.testnet',
        JWT_ACCESS_SECRET: 'local-mock-testnet-int-secret-0123',
      },
    });
    await testnetCreated.app.listen(0, '127.0.0.1');
    try {
      const tUrl = (await testnetCreated.app.getUrl()).replace('[::1]', '127.0.0.1');
      const res = await fetch(`${tUrl}/v1/dev/mock-oauth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: 'Testnet Local Pilot' }),
      });
      expect(res.status).toBe(200);
      const body = SocialAuthResponseSchema.parse(await res.json());
      expect(body.player.handle).toBe('Testnet Local Pilot');
      const row = await db.prisma.socialIdentity.findUnique({
        where: { provider_subject: { provider: 'local-mock', subject: 'testnet local pilot' } },
      });
      expect(row?.playerId).toBe(body.player.id);
    } finally {
      await testnetCreated.app.close();
    }
  }, 60_000);
});

async function bootLocalStakingApp(dbUrl: string) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      SNAPSHOTS: 'off',
      DATABASE_URL: dbUrl,
      NEAR_MODE: 'local',
      JWT_ACCESS_SECRET: 'local-mode-staking-int-secret-01234',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
    },
  });
  await created.app.listen(0, '127.0.0.1');
  const lUrl = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, lUrl };
}

describe('localhost mock staking — starter funds, faucet & 1-minute NEAR_MODE=local timings', () => {
  it('runs 1-minute warmup, compound, unbonding & withdraw cycles from starter funds', async () => {
    resetMockStakingClock();
    const { app: localApp, lUrl } = await bootLocalStakingApp(db.url);
    try {
      const loginRes = await fetch(`${lUrl}/v1/dev/mock-oauth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: 'Staker Minute', mode: 'signup' }),
      });
      const session = SocialAuthResponseSchema.parse(await loginRes.json());
      const acct = session.accountId!;
      const authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` };

      const stakeRes = await fetch(`${lUrl}/v1/near/stake`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ accountId: acct, pool: 'astro-stakers.pool.mock', amount: '50' }),
      });
      expect(stakeRes.status).toBe(200);
      const staked = (await stakeRes.json()) as { perks: { tier: number; platformFeeBp: number; feeWarmupReadyAtMs: number | null } };
      expect(staked.perks).toMatchObject({ tier: 2, platformFeeBp: 65 });
      expect(staked.perks.feeWarmupReadyAtMs).not.toBeNull();

      advanceMockStakingClockMs(61_000);
      const compRes = await fetch(`${lUrl}/v1/near/stake/compound`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ accountId: acct, pool: 'astro-stakers.pool.mock' }),
      });
      expect(compRes.status).toBe(200);
      const comp = (await compRes.json()) as { compoundedNear: string; perks: { platformFeeBp: number; earlyExitFeeBp: number } };
      expect(Number(comp.compoundedNear)).toBeGreaterThan(0.05);
      expect(comp.perks).toMatchObject({ platformFeeBp: 50, earlyExitFeeBp: 0 });

      const unstakeRes = await fetch(`${lUrl}/v1/near/unstake`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ accountId: acct, pool: 'astro-stakers.pool.mock', amount: '20' }),
      });
      expect(unstakeRes.status).toBe(200);
      const unstaked = (await unstakeRes.json()) as { earlyExitFeeBp: number; earlyExitFeeNear: string };
      expect(unstaked).toEqual({ ...unstaked, earlyExitFeeBp: 0, earlyExitFeeNear: '0' });
      const perfAfterUnstake = (await (await fetch(`${lUrl}/v1/near/staking/performance?accountId=${acct}`)).json()) as { txs: Array<{ kind: string }> };
      expect(perfAfterUnstake.txs.some((t) => t.kind === 'early_exit_fee')).toBe(false);
      expect((await fetch(`${lUrl}/v1/near/withdraw`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ accountId: acct, pool: 'astro-stakers.pool.mock' }),
      })).status).toBe(409);

      advanceMockStakingClockMs(61_000);
      expect((await fetch(`${lUrl}/v1/near/withdraw`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ accountId: acct, pool: 'astro-stakers.pool.mock' }),
      })).status).toBe(200);
    } finally {
      resetMockStakingClock();
      await localApp.close();
    }
  }, 60_000);
});

describe('localhost mock staking — faucet, profits, nomination & ?as= dev alias link', () => {
  it('supports profit staking, /v1/dev/chain/faucet, planet nomination, and blocks remote/stranger faucet calls', async () => {
    const { app: localApp, lUrl } = await bootLocalStakingApp(db.url);
    try {
      const loginRes = await fetch(`${lUrl}/v1/dev/mock-oauth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: 'Faucet Pilot', mode: 'signup' }),
      });
      const session = SocialAuthResponseSchema.parse(await loginRes.json());
      const acct = session.accountId!;
      const authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` };

      expect((await fetch(`${lUrl}/v1/near/stake/profits`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ accountId: acct, amountUsdc: '20.00' }),
      })).status).toBe(200);

      const faucetRes = await fetch(`${lUrl}/v1/dev/chain/faucet`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ accountId: acct }),
      });
      expect(faucetRes.status).toBe(200);
      const faucetBody = (await faucetRes.json()) as { addedNear: string; defaultPlanetId: string };
      expect(faucetBody.addedNear).toBe('500');
      expect(faucetBody.defaultPlanetId).toBe(CANONICAL_PLANETS.temperate.id);

      expect((await fetch(`${lUrl}/v1/near/staking/patron/nominate`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ accountId: acct, planetId: CANONICAL_PLANETS.temperate.id }),
      })).status).toBe(200);
      expect((await fetch(`${lUrl}/v1/near/staking/patron/nominate`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ accountId: acct, planetId: 'pl_sovereign_nft' }),
      })).status).toBe(400);

      // Visiting /v1/me/profile?as=localdev in NEAR_MODE=local provisions localdev.terraagent.mock + starter funds + WalletControlGuard link
      const devProfRes = await fetch(`${lUrl}/v1/me/profile?as=localdev`);
      expect(devProfRes.status).toBe(200);
      const devProf = MeProfileResponseSchema.parse(await devProfRes.json());
      expect(devProf.identity.accountId).toBe('localdev.terraagent.mock');
      expect(devProf.identity.handle).toBe('localdev');
      const devProfReload = MeProfileResponseSchema.parse(await (await fetch(`${lUrl}/v1/me/profile?as=localdev`)).json());
      expect(devProfReload.identity.handle).toBe('localdev');
      const devStakeRes = await fetch(`${lUrl}/v1/near/stake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer dev:localdev' },
        body: JSON.stringify({ accountId: 'localdev.terraagent.mock', pool: 'astro-stakers.pool.mock', amount: '25' }),
      });
      expect(devStakeRes.status).toBe(200);
      const devVerifyRes = await fetch(`${lUrl}/v1/me/ai-settings/verify`, {
        method: 'POST',
        headers: { authorization: 'Bearer dev:localdev' },
      });
      expect(devVerifyRes.status).toBe(200);

      expect((await fetch(`${lUrl}/v1/dev/chain/faucet`, {
        method: 'POST', headers: { ...authHeaders, 'x-forwarded-host': 'terraagent.fun' }, body: JSON.stringify({ accountId: acct }),
      })).status).toBe(403);

      expect((await fetch(`${lUrl}/v1/dev/chain/faucet`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer dev:stranger' }, body: JSON.stringify({ accountId: acct }),
      })).status).toBe(403);
    } finally {
      await localApp.close();
    }
  }, 60_000);
});
