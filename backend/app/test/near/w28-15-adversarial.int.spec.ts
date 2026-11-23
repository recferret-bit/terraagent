import 'reflect-metadata';
import { CANONICAL_PLANETS, MANAGED_AI_MODEL, parseWaves, STAKING_TIERS } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createPlanet, SimHost } from '@terra/sim';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ManagedAiGate } from '../../src/ai/colony-agent/managed-ai-gate';
import type { AppEnv } from '../../src/core/tokens';
import type { FlagsService } from '../../src/flags/flags.service';
import { PatronPayoutService, patronPayoutId } from '../../src/market/settlement/patron-payout.service';
import type { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider';
import { AiSlotLedger } from '../../src/near/staking/perks/ai-slot.ledger';
import { PatronSeatService } from '../../src/near/staking/perks/patron-seat.service';
import { resolveWalletPerks } from '../../src/near/staking/perks/perks.resolver';
import { nearToYocto } from '../../src/near/staking/yocto';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const POOL = 'astro-stakers.pool.mock';
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
  await p.stakingPatronPayout.deleteMany({});
  await p.stakingPatronSeat.deleteMany({});
  await p.stakingPatronNomination.deleteMany({});
  await p.stakingPosition.deleteMany({});
  await p.nearColonyAccount.deleteMany({});
  await p.aiWalletUsage.deleteMany({});
  await p.aiFreeTrial.deleteMany({});
});

const gate = (price = 4) => new ManagedAiGate(db.prisma, env, slots, { priceProvider: { nearUsd: () => price } });

/** `colonies` colonies of one wallet `owner.near`; the stake sits on the first colony's account (wallet-wide read). */
async function wallet(owner: string, colonies: number, stakeNear: number | string, sinceMs = NOW - 3 * DAY): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < colonies; i++) {
    const colonyId = `${owner}-c${i}`;
    ids.push(colonyId);
    await db.prisma.nearColonyAccount.create({
      data: { accountId: `${colonyId}.mock`, playerId: `pl-${owner}`, slot: colonyId, colonyId, ownerAccountId: `${owner}.near`, publicKey: 'ed25519:t', encryptedSecret: 'x', kekVersion: 1 },
    });
  }
  if (Number(stakeNear) > 0) {
    await db.prisma.stakingPosition.create({
      data: { colonyId: ids[0]!, poolId: POOL, accountId: `${owner}.near`, stakedSnapshot: nearToYocto(stakeNear), stakedSinceAt: new Date(sinceMs), lastStakedAt: new Date(sinceMs) },
    });
  }
  return ids;
}

describe('W28-15 multi-colony Sybil: perks + gate + slot ledger across every tier (Postgres)', () => {
  it.each(STAKING_TIERS.filter((t) => t.id > 0))('Tier $id: 14 colonies hammering the gate use at most $aiColonySlots slots and never exceed the wallet call cap', async (row) => {
    const owner = `sybil${row.id}`;
    const ids = await wallet(owner, 14, row.minStakeNear);
    const perColony = await Promise.all(ids.map((id) => resolveWalletPerks(db.prisma, { colonyId: id, w28: true, full: true, nowMs: NOW, deps: { priceProvider: { nearUsd: () => 4 } } })));
    // every colony resolves the SAME wallet quotas: never multiplied by colony count
    for (const r of perColony) {
      expect(r.wallet.walletKey).toBe(perColony[0]!.wallet.walletKey);
      expect([r.perks.gasMultiplier, r.perks.maxAiColonySlots, r.perks.dailyAiCallLimit]).toEqual([row.gasMultiplier, row.aiColonySlots, perColony[0]!.perks.dailyAiCallLimit]);
    }
    const limit = perColony[0]!.perks.dailyAiCallLimit;
    const results = await Promise.all(ids.flatMap((id) => Array.from({ length: 40 }, () => gate().admit({ id }, NOW).then((o) => ({ id, o })))));
    const tee = results.filter((r) => r.o.mode === 'tee');
    expect(new Set(tee.map((r) => r.id)).size).toBeLessThanOrEqual(row.aiColonySlots);
    expect(tee.length).toBeLessThanOrEqual(limit);
    expect(tee.length).toBe(Math.min(limit, row.aiColonySlots * 40));
    expect(tee.every((r) => r.o.model === MANAGED_AI_MODEL)).toBe(true);
    const usage = await db.prisma.aiWalletUsage.findFirstOrThrow({ where: { walletKey: `${owner}.near` } });
    expect(usage.callsUsed).toBe(tee.length);
    expect(slots.used(`${owner}.near`, NOW)).toBeLessThanOrEqual(row.aiColonySlots);
  });

  it('two wallets never share a budget or slots, and an unstaked 10-colony wallet gets no managed AI at all (guests: script)', async () => {
    const a = await wallet('wa', 10, 50);
    const b = await wallet('wb', 10, 0);
    const outA = await Promise.all(a.map((id) => gate().admit({ id }, NOW)));
    const outB = await Promise.all(b.map((id) => gate().admit({ id, playerId: 'guest' }, NOW)));
    expect(outA.filter((o) => o.mode === 'tee')).toHaveLength(3);
    expect(outB.every((o) => o.mode === 'script')).toBe(true);
    expect(await db.prisma.aiWalletUsage.count({ where: { walletKey: 'wb.near' } })).toBe(0);
  });
});

describe('W28-15 staking-no-p2w through the DB paths: gate, perks and patron seat leave the sim untouched', () => {
  it('byte-identical sim snapshot for stakes across the thresholds, with managed-AI admit (tee / trial / script), perks and a patron seat resolved mid-run', async () => {
    const run = async (during?: () => Promise<void>): Promise<Buffer> => {
      const host = new SimHost({ flags: parseWaves('..20') });
      host.load(createPlanet({ type: 'temperate', seed: 'w28-15-int', radius: 14 }));
      host.submit({ colonyIndex: 0, source: 'system', commandId: 's', kind: 'system.spawnColony', args: { colonyId: 'col_0', playerId: 'p', name: 'P2W', q: 0, r: 0 } });
      host.step(10);
      host.submit({ colonyIndex: 0, source: 'player', commandId: 'l', kind: 'landPod', args: {} });
      await during?.();
      host.step(20);
      return Buffer.from(host.snapshot());
    };
    const baseline = await run();
    const stakes: Array<number | string> = [0, '9.999999', 10, 50, 200, 500, 1_000_000];
    for (const stake of stakes) {
      const owner = `p2w-${String(stake).replace('.', '_')}`;
      const ids = await wallet(owner, 2, stake);
      const out = await run(async () => {
        await db.prisma.stakingPatronNomination.upsert({ where: { accountId: `${owner}-c0.mock` }, create: { accountId: `${owner}-c0.mock`, planetId: CANONICAL_PLANETS.temperate.id }, update: {} });
        const modes = await Promise.all(ids.map((id) => gate().admit({ id }, NOW).then((o) => o.mode)));
        expect(modes.every((m) => ['tee', 'script'].includes(m))).toBe(true);
        await resolveWalletPerks(db.prisma, { colonyId: ids[0]!, w28: true, full: true, nowMs: NOW, deps: { priceProvider: { nearUsd: () => 4 } } });
        await new PatronSeatService(db.prisma).refreshPlanet(CANONICAL_PLANETS.temperate.id, NOW);
      });
      expect(out.equals(baseline), `stake ${stake}`).toBe(true);
    }
  });
});

describe('W28-15 King-of-the-Hill across planets and nominations (Postgres)', () => {
  const seats = () => new PatronSeatService(db.prisma);
  const planetX = CANONICAL_PLANETS.desert.id;
  const planetY = CANONICAL_PLANETS.ocean.id;
  const planetZ = CANONICAL_PLANETS.temperate.id;

  async function whale(name: string, near: number, sinceMs: number): Promise<void> {
    await wallet(name, 1, near, sinceMs);
  }
  const nominate = (name: string, planet: string) => seats().nominate(`${name}-c0.mock`, planet);

  it('550 overtakes 500; switching a nomination moves the seat and vacates the planet left behind; unstake hands it to the runner-up', async () => {
    await whale('a', 500, NOW - 5 * DAY);
    await whale('b', 550, NOW - 2 * DAY);
    await nominate('a', planetX);
    expect((await seats().refreshPlanet(planetX, NOW - 3 * DAY))?.accountId).toBe('a-c0.mock');
    await nominate('b', planetX);
    expect((await seats().refreshPlanet(planetX, NOW - DAY))?.accountId).toBe('b-c0.mock');

    // b switches to planetY: planetX falls back to a, planetY gets b (one nomination per wallet)
    await nominate('b', planetY);
    expect((await seats().refreshPlanet(planetX, NOW))?.accountId).toBe('a-c0.mock');
    expect((await seats().refreshPlanet(planetY, NOW))?.accountId).toBe('b-c0.mock');
    expect(await db.prisma.stakingPatronNomination.count({ where: { accountId: 'b-c0.mock' } })).toBe(1);

    // a switches away too: planetX is vacated and its seat row is deleted
    await nominate('a', planetZ);
    expect(await seats().refreshPlanet(planetX, NOW)).toBeNull();
    expect(await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: planetX } })).toBeNull();

    // b (550) and a (500) compete on planetZ; b unstakes below a: the seat transfers immediately
    await nominate('b', planetZ);
    expect((await seats().refreshPlanet(planetZ, NOW))?.accountId).toBe('b-c0.mock');
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'b-c0', poolId: POOL } }, data: { stakedSnapshot: nearToYocto(499), unbondingSnapshot: nearToYocto(51) } });
    expect((await seats().refreshPlanet(planetZ, NOW))?.accountId).toBe('a-c0.mock');
  });

  it('exact ties keep the incumbent no matter who staked first; a challenger needs strictly more', async () => {
    await whale('old', 500, NOW - 9 * DAY);
    await whale('new', 500, NOW - 1 * DAY);
    await nominate('new', planetX);
    expect((await seats().refreshPlanet(planetX, NOW - 2 * DAY))?.accountId).toBe('new-c0.mock');
    await nominate('old', planetX);
    const tie = await seats().refreshPlanet(planetX, NOW);
    expect(tie?.accountId).toBe('new-c0.mock');
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'old-c0', poolId: POOL } }, data: { stakedSnapshot: nearToYocto('500.000001') } });
    expect((await seats().refreshPlanet(planetX, NOW))?.accountId).toBe('old-c0.mock');
  });

  it('499.999999 never qualifies; a 10-colony wallet counts once and is not a majority of itself; non-canonical planets reject nomination', async () => {
    await whale('near-miss', 499.999999, NOW - 3 * DAY);
    await nominate('near-miss', planetY);
    expect(await seats().refreshPlanet(planetY, NOW)).toBeNull();
    await expect(seats().nominate('near-miss-c0.mock', 'pl_sovereign_nft_01')).rejects.toMatchObject({ status: 400 });
    const ids = await wallet('multi', 10, 500);
    for (const id of ids) await seats().nominate(`${id}.mock`, planetY);
    expect((await seats().refreshPlanet(planetY, NOW))?.accountId).toBe('multi-c0.mock');
    expect(await db.prisma.stakingPatronSeat.count()).toBe(1);
  });
});

describe('W28-15 Patron payout: conservation and idempotency under replay (Postgres)', () => {
  const flags = (on: boolean) => ({ has: (f: string) => on && f === 'W28' }) as unknown as FlagsService;
  const policy = { current: () => ({ treasuryShareBp: 2_000 }) } as unknown as MarketPolicyProvider;
  const svc = (on = true) => new PatronPayoutService(flags(on), policy, db.prisma as never);
  const CANON_PLANET = CANONICAL_PLANETS.temperate.id;
  const plan = (tradeId: string, over: Record<string, unknown> = {}) => ({ tradeId, planetId: CANON_PLANET, quote: 'USDC', platformFee: '1000000', treasuryFee: '200000', ...over }) as Parameters<PatronPayoutService['record']>[0];

  async function seat(): Promise<void> {
    await wallet('lead', 1, 600);
    await new PatronSeatService(db.prisma).nominate('lead-c0.mock', CANON_PLANET);
    await new PatronSeatService(db.prisma).refreshPlanet(CANON_PLANET, NOW);
  }

  it('pays 12 % of gross with or without a DAO carve-out, once per trade, and a replay is a no-op', async () => {
    await seat();
    const first = await svc().record(plan('t1'));
    expect(first).toMatchObject({ accountId: 'lead-c0.mock', amountUsdcAtomic: 120_000n, created: true });
    const replay = await svc().record(plan('t1'));
    expect(replay).toMatchObject({ amountUsdcAtomic: 120_000n, created: false });
    const noCarve = await svc().record(plan('t2', { treasuryFee: '0' }));
    expect(noCarve?.amountUsdcAtomic).toBe(150_000n); // no DAO share taken: 15 % of the whole protocol cut
    const rows = await db.prisma.stakingPatronPayout.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.id)).toEqual([patronPayoutId('t1'), patronPayoutId('t2')]);
    expect(rows.map((r) => r.amountUsdcAtomic.toFixed(0))).toEqual(['120000', '150000']);
  });

  it('20 concurrent replays of one trade write exactly one row and the paid total never exceeds the patron share', async () => {
    await seat();
    const out = await Promise.all(Array.from({ length: 20 }, () => svc().record(plan('t3'))));
    expect(out.filter((o) => o?.created)).toHaveLength(1);
    expect(await db.prisma.stakingPatronPayout.count()).toBe(1);
  });

  it('a seat that changes hands later does not re-pay or rewrite a settled trade', async () => {
    await seat();
    await svc().record(plan('t4'));
    await wallet('usurper', 1, 900);
    await new PatronSeatService(db.prisma).nominate('usurper-c0.mock', CANON_PLANET);
    await new PatronSeatService(db.prisma).refreshPlanet(CANON_PLANET, NOW + DAY);
    const again = await svc().record(plan('t4'));
    expect(again?.created).toBe(false);
    const row = await db.prisma.stakingPatronPayout.findUniqueOrThrow({ where: { id: patronPayoutId('t4') } });
    expect(row.accountId).toBe('lead-c0.mock');
    const next = await svc().record(plan('t5'));
    expect(next).toMatchObject({ accountId: 'usurper-c0.mock', created: true });
  });

  it('records nothing without a seat, with W28 off, for non-USDC quotes, non-canonical sovereign planets, or a zero fee', async () => {
    expect(await svc().record(plan('n1'))).toBeNull();
    await seat();
    expect(await svc(false).record(plan('n2'))).toBeNull();
    expect(await svc().record(plan('n3', { quote: 'NEAR' }))).toBeNull();
    expect(await svc().record(plan('n_sov', { planetId: 'pl_sovereign_nft_01' }))).toBeNull();
    expect(await svc().record(plan('n4', { platformFee: '0' }))).toBeNull();
    expect(await svc().record(plan('n5', { platformFee: '3' }))).toBeNull(); // 3 atomic units: patron cut rounds to 0
    expect(await db.prisma.stakingPatronPayout.count()).toBe(0);
    await expect(svc().recordSafely(plan('n6', { platformFee: 'not-a-number' }))).resolves.toBeUndefined();
  });
});
