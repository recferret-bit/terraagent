import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { YOCTO_PER_NEAR } from '../../src/market/guild/guild-plan.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const off = { has: () => false } as unknown as FlagsService;
const sleep = async () => undefined;

let db: TestDatabase;
let svc: GuildProvisionService;

beforeAll(async () => {
  db = await createTestDatabase();
  const wallet = new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 15 }, { sleep });
  svc = new GuildProvisionService(
    on,
    new GuildNpcRepository(db.prisma),
    new GuildWalletBinder(wallet),
    new GuildTradeKeyBinder(db.prisma, new TradeKeyRepository(db.prisma)),
    { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv,
  );
});

afterAll(async () => {
  await db?.drop();
});

describe('Guild provisioning on Postgres (W15-05)', () => {
  it('boots twice: one row, one key, fixture label, counters survive', async () => {
    const first = await svc.provision();
    const kestrel = first.find((row) => row.npcId === 'kestrel');
    const vanguard = first.find((row) => row.npcId === 'vanguard');
    expect(kestrel).toMatchObject({
      allocationId: 'guild-alloc:guild-mock-1:kestrel',
      accountId: 'guild-1.npc.terraagent.mock',
      publicKey: 'ed25519:guild-kestrel',
      cargoLabel: 'fixture',
      quoteLabel: 'subsidy',
      cashEnabled: 0,
      actorKind: 'npc',
      spendAtomic: '0',
      lossAtomic: '0',
      quoteBudgetAtomic: (5n * YOCTO_PER_NEAR).toString(),
    });
    expect(vanguard?.accountId).toBe('guild-2.npc.terraagent.mock');
    expect(kestrel!.inventory.lines).toEqual([]);
    expect(BigInt(kestrel!.quoteBudgetAtomic) + BigInt(vanguard!.quoteBudgetAtomic)).toBe(10n * YOCTO_PER_NEAR);

    await db.prisma.guildNpc.update({ where: { id: 'kestrel' }, data: { spendAtomic: '11', lossAtomic: '2' } });
    const second = await svc.provision();
    expect(second.find((row) => row.npcId === 'kestrel')).toMatchObject({
      allocationId: kestrel!.allocationId,
      tradeKeyId: kestrel!.tradeKeyId,
      publicKey: kestrel!.publicKey,
      quoteBudgetAtomic: kestrel!.quoteBudgetAtomic,
      spendAtomic: '11',
      lossAtomic: '2',
    });
    expect(await db.prisma.guildNpc.count()).toBe(2);
    expect(await db.prisma.tradeApiKey.count({ where: { ownerId: { startsWith: 'guild:' } } })).toBe(2);
    expect(await db.prisma.mockChainAgentKey.count({ where: { publicKey: { startsWith: 'ed25519:guild-' } } })).toBe(2);
    const allowance = await db.prisma.mockChainAgentAllowance.findUniqueOrThrow({
      where: { accountId_publicKey_token: { accountId: kestrel!.accountId, publicKey: kestrel!.publicKey, token: 'NEAR' } },
    });
    expect(allowance.allowance.toFixed(0)).toBe(kestrel!.quoteBudgetAtomic);
    expect(allowance.spent.toFixed(0)).toBe('0');
    const cargo = await db.prisma.mockChainBalance.findMany({ where: { accountId: { in: [kestrel!.accountId, vanguard!.accountId] } } });
    expect(cargo).toEqual([]);
    const stored = await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'kestrel' } });
    expect(stored.strategy).toMatchObject({ actorKind: 'npc', cashEnabled: 0, quoteLabel: 'subsidy' });
    expect(stored.homeRoute).toMatchObject({ routeLoop: 1, route: ['loop-local'] });
    expect(stored.cargoLabel).toBe('fixture');
  });

  it('refuses an unknown npc and does not add a key', async () => {
    await expect(svc.ensureNpc('osprey')).rejects.toMatchObject({ errorCode: 'unknown_npc' });
    expect(await db.prisma.guildNpc.count()).toBe(2);
    expect(await db.prisma.tradeApiKey.count({ where: { ownerId: 'guild:osprey' } })).toBe(0);
  });

  it('a refill does not raise the quote budget', async () => {
    const before = await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'vanguard' } });
    const after = await svc.refill('vanguard', '1000000000000000000000000');
    expect(after!.quoteBudgetAtomic).toBe(before.quoteBudgetAtomic.toFixed(0));
    const row = await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'vanguard' } });
    expect(row.quoteBudgetAtomic.toFixed(0)).toBe(before.quoteBudgetAtomic.toFixed(0));
    expect(row.spendAtomic.toFixed(0)).toBe(before.spendAtomic.toFixed(0));
  });

  it('allocation amount 0 does not create cargo', async () => {
    const before = await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'kestrel' } });
    const zero = await svc.allocateFixtureCargo('kestrel', 'metals.t1', 0);
    expect(zero!.inventory.lines).toEqual([]);
    const row = await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'kestrel' } });
    expect(row.inventoryCache).toEqual(before.inventoryCache);
    expect(row.spendAtomic.toFixed(0)).toBe('11');
    const granted = await svc.allocateFixtureCargo('vanguard', 'bio.water', 2);
    expect(granted!.inventory.lines).toEqual([{ resource: 'bio.water', amount: 2, label: 'fixture', organic: false, source: 'mock-grant' }]);
    const balances = await db.prisma.mockChainBalance.findMany({ where: { accountId: 'guild-2.npc.terraagent.mock' } });
    expect(balances).toEqual([]);
  });

  it('W15 off does not write another row or key', async () => {
    const quiet = new GuildProvisionService(
      off,
      new GuildNpcRepository(db.prisma),
      new GuildWalletBinder(new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 1 }, { sleep })),
      new GuildTradeKeyBinder(db.prisma, new TradeKeyRepository(db.prisma)),
      { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv,
    );
    expect(await quiet.provision()).toEqual([]);
    expect(await quiet.ensureNpc('kestrel')).toBeNull();
    expect(await db.prisma.guildNpc.count()).toBe(2);
    expect(await db.prisma.tradeApiKey.count({ where: { ownerId: { startsWith: 'guild:' } } })).toBe(2);
  });
});
