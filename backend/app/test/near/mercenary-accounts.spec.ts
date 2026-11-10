import 'reflect-metadata';
import type { PrismaClient } from '@terra/db';
import { describe, expect, it, vi } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';
import { MercenaryAccountsService } from '../../src/near/mercenary/accounts.service.js';

const MERC_IDS = [
  'merc-1.npc.terraagent.mock',
  'merc-2.npc.terraagent.mock',
  'merc-3.npc.terraagent.mock',
] as const;

function memoryChain(): { prisma: PrismaClient; ids(): readonly string[] } {
  const rows = new Map<string, string>();
  const prisma = {
    mockChainAccount: {
      upsert: async (args: { where: { accountId: string }; create: { accountId: string; kind: string } }) => {
        if (!rows.has(args.where.accountId)) rows.set(args.where.accountId, args.create.kind);
        return { accountId: args.where.accountId };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, ids: () => [...rows.keys()].sort() };
}

function boot(waves: string, prisma: PrismaClient) {
  const wallet = new MockAgentWalletAdapter(prisma);
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  return { wallet, svc: new MercenaryAccountsService(flags, wallet) };
}

describe('W22-27 mercenary NPC accounts', () => {
  it('creates three accounts whose roster size and price match the data table', async () => {
    const book = memoryChain();
    const { wallet, svc } = boot('..22', book.prisma);
    await svc.onModuleInit();
    const roster = svc.roster();
    expect(roster.map((row) => row.accountId)).toEqual([...MERC_IDS]);
    expect(book.ids()).toEqual([...MERC_IDS]);
    expect(wallet.accountIds()).toEqual([...MERC_IDS]);
    expect(roster.find((row) => row.id === 'light')).toMatchObject({
      archetype: 'robot.recon',
      count: 4,
      pricePerGameHour: { 'metals.t1': 100 },
      fundingCap: { 'metals.t1': 10000 },
    });
    expect(roster.find((row) => row.id === 'heavy')).toMatchObject({
      archetype: 'robot.recon',
      count: 6,
      pricePerGameHour: { 'metals.t1': 200 },
      fundingCap: { 'metals.t1': 10000 },
    });
    expect(roster.find((row) => row.id === 'reserve')).toMatchObject({
      archetype: 'robot.recon',
      count: 4,
      pricePerGameHour: { 'metals.t1': 100 },
      fundingCap: { 'metals.t1': 10000 },
    });
    expect(roster.every((row) => row.archetype === 'robot.recon')).toBe(true);
  });

  it('creates no mercenary account when W22 is off', async () => {
    const book = memoryChain();
    const { wallet, svc } = boot('..21', book.prisma);
    const create = vi.spyOn(wallet, 'createSubAccount');
    await svc.onModuleInit();
    expect(svc.roster()).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(book.ids()).toEqual([]);
    expect(wallet.accountIds()).toEqual([]);
  });

  it('a second init does not create a fourth account', async () => {
    const book = memoryChain();
    const { wallet, svc } = boot('..22', book.prisma);
    const create = vi.spyOn(wallet, 'createSubAccount');
    await svc.onModuleInit();
    await svc.onModuleInit();
    expect(create).toHaveBeenCalledTimes(6);
    expect(book.ids()).toEqual([...MERC_IDS]);
    expect(wallet.accountIds()).toEqual([...MERC_IDS]);
    expect(svc.roster()).toHaveLength(3);
  });
});
