import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { ModuleRef } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildFundingService, type AllowQuoteRequest } from '../../src/market/guild/funding/guild-funding.service.js';
import { GuildKillSwitch } from '../../src/market/guild/funding/guild-kill.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { YOCTO_PER_NEAR } from '../../src/market/guild/guild-plan.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { TradeKeysService } from '../../src/market/trade/trade-keys.service.js';
import { TradeRequestRepository } from '../../src/market/trade/trade-request.repository.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const NPC_CAP = 5n * YOCTO_PER_NEAR;
const sleep = async () => undefined;

let db: TestDatabase;
let env: AppEnv;
let provision: GuildProvisionService;
let funding: GuildFundingService;

beforeAll(async () => {
  db = await createTestDatabase();
  env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  const wallet = new MockAgentWalletAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 15 },
    { sleep },
  );
  provision = new GuildProvisionService(
    on,
    new GuildNpcRepository(db.prisma),
    new GuildWalletBinder(wallet),
    new GuildTradeKeyBinder(db.prisma, new TradeKeyRepository(db.prisma)),
    env,
  );
  funding = new GuildFundingService(new GuildFundingRepository(db.prisma), on, env);
  await provision.provision();
});

afterAll(async () => {
  await db?.drop();
});

function restarted(): GuildFundingService {
  return new GuildFundingService(new GuildFundingRepository(db.prisma), on, env);
}

function cashBuy(npcId: string, size: bigint, cashEnabled = 1): AllowQuoteRequest {
  return {
    npcId,
    side: 'buy',
    quote: 'cash',
    size,
    stock: 0n,
    cashEnabled,
    referenceAgeS: 10,
    eligibleVolume: 20,
    referenceMaxAgeS: 3600,
    minReferenceVolume: 10,
  };
}

describe('guild funding on Postgres (W15-12)', () => {
  it('seeds each cap from the allocation once; a second boot and a quote do not raise it', async () => {
    await funding.read('kestrel');
    await funding.read('vanguard');
    const before = await caps();
    expect(before.kestrel).toBe(NPC_CAP);
    expect(before.vanguard).toBe(NPC_CAP);
    expect(before.global).toBe(NPC_CAP * 2n);
    expect(before.kestrelQuote).toBe(NPC_CAP);
    await provision.provision();
    await funding.allowQuote(cashBuy('kestrel', 1n, 0));
    await funding.allowQuote({ ...cashBuy('vanguard', 4n, 0), side: 'sell', quote: 'inventory', stock: 4n });
    expect(await caps()).toEqual(before);
  });

  it('one of two concurrent reserves pauses with funding_cap; release then reserve fits again', async () => {
    const [left, right] = await Promise.all([
      funding.reserve('kestrel', 'cash', NPC_CAP),
      funding.reserve('kestrel', 'cash', NPC_CAP),
    ]);
    expect([left, right].filter((row) => row.ok)).toHaveLength(1);
    expect([left, right].find((row) => !row.ok)).toMatchObject({ reason: 'funding_cap' });
    expect((await funding.read('kestrel')).npc.cash.reserved).toBe(NPC_CAP);
    await funding.release('kestrel', 'cash', NPC_CAP);
    expect((await funding.reserve('kestrel', 'cash', NPC_CAP)).ok).toBe(true);
  });

  it('restart shows the same reserved and spent, and a depleted book pauses', async () => {
    expect((await restarted().read('kestrel')).npc.cash).toMatchObject({ reserved: NPC_CAP, spent: 0n });
    await funding.consume('kestrel', 'cash', NPC_CAP);
    const again = await restarted().read('kestrel');
    expect(again.npc.cash).toMatchObject({ reserved: 0n, spent: NPC_CAP });
    expect(again.global.cash.spent).toBe(NPC_CAP);
    expect(await funding.allowQuote(cashBuy('kestrel', 1n))).toEqual({ ok: false, reason: 'funding_cap' });
    const [kestrel, vanguard] = await Promise.all([
      funding.reserve('kestrel', 'cash', 1n),
      funding.reserve('vanguard', 'cash', NPC_CAP),
    ]);
    expect(kestrel).toMatchObject({ ok: false, reason: 'funding_cap' });
    expect(vanguard.ok).toBe(true);
    expect(await funding.allowQuote(cashBuy('vanguard', 1n))).toEqual({ ok: false, reason: 'funding_cap' });
  });

  it('killGuild pauses quotes and cancels an unsubmitted request through the trade kill switch', async () => {
    const row = await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'vanguard' } });
    await db.prisma.tradeApiRequest.create({
      data: {
        requestId: 'rq_guild_kill',
        ownerRef: 'player:guild:vanguard',
        keyId: row.tradeKeyId,
        idemKey: 'guild-kill-1',
        bodyHash: 'ab'.repeat(32),
        kind: 'place',
        planetId: 'loop-local',
        colonyId: 'vanguard',
        colonyIndex: 2,
        ownerId: 'guild:vanguard',
        notional: '0',
        state: 'PENDING',
      },
    });
    const kill = new GuildKillSwitch(
      moduleRef(),
      new GuildNpcRepository(db.prisma),
      new GuildFundingRepository(db.prisma),
      on,
      env,
    );
    expect(await kill.killGuild('vanguard')).toMatchObject({ npcId: 'vanguard', keyId: row.tradeKeyId, killed: true });
    expect(await funding.allowQuote(cashBuy('vanguard', 1n))).toEqual({ ok: false, reason: 'killed' });
    const pending = await db.prisma.tradeApiRequest.findUniqueOrThrow({ where: { requestId: 'rq_guild_kill' } });
    expect(pending.state).toBe('CANCELLED');
    const allowance = await db.prisma.tradeApiAllowance.findUniqueOrThrow({ where: { keyId: row.tradeKeyId } });
    expect(allowance.killSwitch).toBe(true);
  });

  it('topUp raises the allocation only when called, and not the chain key allowance', async () => {
    const before = await caps();
    const key = await db.prisma.mockChainAgentAllowance.findFirstOrThrow({
      where: { accountId: 'guild-2.npc.terraagent.mock', token: 'NEAR' },
    });
    const raised = await funding.topUp('guild-alloc:guild-mock-1:vanguard', 10n);
    expect(raised.cashCapAtomic).toBe((before.vanguard + 10n).toString());
    expect(raised.globalCashCapAtomic).toBe((before.global + 10n).toString());
    await provision.provision();
    const after = await caps();
    expect(after.vanguardQuote).toBe(before.vanguardQuote + 10n);
    expect(after.kestrelQuote).toBe(before.kestrelQuote);
    expect(after.vanguard).toBe(before.vanguard + 10n);
    expect(after.global).toBe(before.global + 10n);
    const keyAfter = await db.prisma.mockChainAgentAllowance.findFirstOrThrow({
      where: { accountId: 'guild-2.npc.terraagent.mock', token: 'NEAR' },
    });
    expect(keyAfter.allowance.toFixed(0)).toBe(key.allowance.toFixed(0));
    expect((await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'vanguard' } })).spendAtomic.toFixed(0)).toBe(
      '0',
    );
    expect(await funding.allowQuote(cashBuy('vanguard', 1n))).toEqual({ ok: false, reason: 'killed' });
  });
});

async function caps(): Promise<{
  kestrel: bigint;
  vanguard: bigint;
  global: bigint;
  kestrelQuote: bigint;
  vanguardQuote: bigint;
}> {
  const rows = await db.prisma.guildFunding.findMany();
  const byScope = new Map(rows.map((row) => [row.scope, BigInt(row.cashCapAtomic.toFixed(0))]));
  const npc = await db.prisma.guildNpc.findMany();
  const quote = new Map(npc.map((row) => [row.id, BigInt(row.quoteBudgetAtomic.toFixed(0))]));
  return {
    kestrel: byScope.get('kestrel') ?? 0n,
    vanguard: byScope.get('vanguard') ?? 0n,
    global: byScope.get('global') ?? 0n,
    kestrelQuote: quote.get('kestrel') ?? 0n,
    vanguardQuote: quote.get('vanguard') ?? 0n,
  };
}

function moduleRef(): ModuleRef {
  const orders = { gate: () => undefined };
  const keys = new TradeKeysService(
    new TradeKeyRepository(db.prisma),
    new TradeRequestRepository(db.prisma),
    { current: () => ({ pairs: [] }) } as never,
    orders as never,
    { submit: async () => ({ ok: true, appliedAtTick: 1 }) } as never,
    { closeKey: () => undefined } as never,
    db.prisma,
  );
  return { get: () => keys } as unknown as ModuleRef;
}
