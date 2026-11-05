import { MarketColonies } from '../../src/market/orders/market-colonies.js';
import 'reflect-metadata';
import { MARKET_TOKENS, formatAtomic, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { buildTradeBatch, type BatchOrder } from '@terra/sim/systems/trade/market-batch';
import type { Fill } from '@terra/sim/systems/trade/market-matcher';
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MarketFaucetService } from '../../src/market/dev/market-faucet.service.js';
import { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';
import { loadKekRing } from '../../src/near/keystore/kek.js';
import { KeyStore } from '../../src/near/keystore/keys.js';

let db: TestDatabase;
const cfg = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 5 };
const WATER = 'bio.water' as const;
const verifier = (k: keyof typeof MARKET_TOKENS): string => MARKET_TOKENS[k].verifierId;
const env = { NODE_ENV: 'test' } as never;
const on = { has: () => true } as never;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});
afterEach(() => mockChainControls.reset());

async function account(name: string, colonyId: string, playerId: string): Promise<void> {
  const g = new KeyStore(loadKekRing({ NODE_ENV: 'test' })).generate();
  await db.prisma.mockChainAccount.create({ data: { accountId: name, kind: 'named' } });
  await db.prisma.$executeRaw`INSERT INTO chain.near_colony_account (account_id, player_id, slot, colony_id, owner_account_id, public_key, encrypted_secret, kek_version)
    VALUES (${name}, ${playerId}, 'colony-1', ${colonyId}, 'owner.mock', ${g.row.publicKey}, ${g.row.encryptedSecret}, ${g.row.kekVersion})`;
}
const bal = async (a: string, token: keyof typeof MARKET_TOKENS): Promise<bigint> =>
  BigInt((await db.prisma.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId: a, tokenId: verifier(token) } } }))?.amount.toFixed(0) ?? '0');

const order = (o: Partial<BatchOrder> & Pick<BatchOrder, 'orderId' | 'side' | 'accountId'>): BatchOrder => ({
  colonyId: o.orderId, amount: 300n, filled: 0n, priceAmount: 10_000_000n, platformFeeBp: 100, stallFeeBp: 100, stallColonyId: 'stall-col',
  stallAccountId: 'stall.mock', platformAccountId: 'platform.mock', policyVersion: 'v1', feeBuckets: {}, cumNotional: 0n,
  reservedPrincipal: 10_000_000n, reservedFees: 10n ** 20n, ...o,
});

describe('faucet + exact settlement of the demo trade (W13-17)', () => {
  it('fund 20 USDC, settle 10 USDC notional with 0.10 + 0.10 fees: balances 9.80 / 10.00 / 0.10 / 0.10', async () => {
    for (const [name, col, pl] of [['buyer.mock', 'col-b', 'p-b'], ['seller.mock', 'col-s', 'p-s'], ['platform.mock', 'col-p', 'p-p'], ['stall.mock', 'col-t', 'p-t']] as const) {
      await account(name, col, pl);
    }
    await db.prisma.$executeRaw`INSERT INTO chain.mock_chain_intents_balance (account_id, token_id, amount) VALUES ('seller.mock', ${verifier(WATER)}, ${toChainUnits(WATER, 300n).toString()}::numeric)`;

    const faucet = new MarketFaucetService(db.prisma, env, on, new MarketColonies(db.prisma, { isScenarioColonyPlanet: () => false } as never));
    const funded = await faucet.credit({ colonyId: 'col-b', token: 'usdc', amount: '20' });
    expect(funded).toMatchObject({ accountId: 'buyer.mock', amountAtomic: '20000000', display: '20.00', label: 'mock USDC', funding: 'fixture' });
    expect(await bal('buyer.mock', 'USDC')).toBe(20_000_000n);
    const note = await db.prisma.mockChainIntent.findUniqueOrThrow({ where: { id: funded.noteId } });
    expect(note.diff).toMatchObject({ actorKind: 'fixture', organic: false });

    const sell = order({ orderId: 'S', side: 'sell', accountId: 'seller.mock', reservedPrincipal: 300n });
    const buy = order({ orderId: 'B', side: 'buy', accountId: 'buyer.mock' });
    const fill: Fill = { makerOrderId: 'S', takerOrderId: 'B', makerSide: 'sell', buyerOrderId: 'B', sellerOrderId: 'S', buyerColonyId: 'B', sellerColonyId: 'S', qty: 300n, price: { num: 10_000_000n, den: 300n } };
    const batch = buildTradeBatch({ tradeId: 'demo', base: WATER, quote: 'USDC', fill, buyer: buy, seller: sell, treasury: { enabled: false, shareBp: 0, accountId: 't' } });
    expect([batch.notional, batch.platformFee, batch.stallFee]).toEqual([10_000_000n, 100_000n, 100_000n]);

    const ix = new MockIntentsAdapter(db.prisma, cfg, { sleep: async () => undefined });
    const byAccount = new Map<string, Record<string, string>>();
    for (const l of batch.legs) {
      const d = byAccount.get(l.accountId) ?? {};
      d[verifier(l.token as keyof typeof MARKET_TOKENS)] = toChainUnits(l.token as never, l.delta < 0n ? -l.delta : l.delta).toString().replace(/^/, l.delta < 0n ? '-' : '');
      byAccount.set(l.accountId, d);
    }
    const deadlineMs = Date.now() + 3_600_000;
    const intents = [];
    for (const [accountId, deltas] of byAccount) intents.push(await ix.signTokenDiff({ accountId, deltas, deadlineMs }));
    expect(await ix.simulate(intents)).toMatchObject({ ok: true });
    await ix.execute({ opId: 'trade:demo', intents });

    const [b, s, p, t] = [await bal('buyer.mock', 'USDC'), await bal('seller.mock', 'USDC'), await bal('platform.mock', 'USDC'), await bal('stall.mock', 'USDC')];
    expect([b, s, p, t]).toEqual([9_800_000n, 10_000_000n, 100_000n, 100_000n]);
    expect([formatAtomic('USDC', b), formatAtomic('USDC', s), formatAtomic('USDC', p), formatAtomic('USDC', t)]).toEqual(['9.80', '10.00', '0.10', '0.10']);
    expect(await bal('buyer.mock', WATER)).toBe(toChainUnits(WATER, 300n));
    expect(await bal('seller.mock', WATER)).toBe(0n);
  });

  it('refuses outside dev: production, W13 off, bad amounts and unknown colonies', async () => {
    await expect(new MarketFaucetService(db.prisma, { NODE_ENV: 'production' } as never, on, new MarketColonies(db.prisma, { isScenarioColonyPlanet: () => false } as never)).credit({ colonyId: 'col-b', token: 'USDC', amount: '1' })).rejects.toMatchObject({ status: 404 });
    await expect(new MarketFaucetService(db.prisma, env, { has: () => false } as never, new MarketColonies(db.prisma, { isScenarioColonyPlanet: () => false } as never)).credit({ colonyId: 'col-b', token: 'USDC', amount: '1' })).rejects.toMatchObject({ status: 403, details: { code: 'wave_disabled' } });
    const f = new MarketFaucetService(db.prisma, env, on, new MarketColonies(db.prisma, { isScenarioColonyPlanet: () => false } as never));
    await expect(f.credit({ colonyId: 'col-b', token: 'USDC', amount: '0.0000001' })).rejects.toMatchObject({ status: 400 });
    await expect(f.credit({ colonyId: 'nope', token: 'NEAR', amount: '1' })).rejects.toMatchObject({ status: 404 });
    await expect(f.credit({ token: 'USDC', amount: '1' })).rejects.toThrow();
  });
});
