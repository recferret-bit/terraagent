import { parseWaves, type SimCommandV1 } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { DevCommand } from '../../src/dev/dev-command.registry';
import { W22DevCommands } from '../../src/near/treasury/dev-console.command';
import { DEV_TREASURY_FUNDER } from '../../src/near/treasury/dev-console.handlers';

const flagsOn = { has: (wave: string) => parseWaves('..22').has(wave), flags: parseWaves('..22') };

function harness(flags = flagsOn) {
  const submitted: SimCommandV1[] = [];
  const deposits: { tokenId: string; amount: string; from: string; daoAccountId: string }[] = [];
  let row: { id: string; state: string; claimerAccountId: string | null } | null = {
    id: 'bt_1',
    state: 'claimed',
    claimerAccountId: 'b.terraagent.mock',
  };
  const pay = vi.fn(async () => {
    if (row) row = { ...row, state: 'paid' };
    return true;
  });
  const registered = new Map<string, DevCommand>();
  const cmd = new W22DevCommands(
    {
      register: (c: DevCommand) => {
        registered.set(c.name, c);
      },
    } as never,
    flags as never,
    {
      deposit: async (input: { tokenId: string; amount: string; from: string; daoAccountId: string }) => {
        deposits.push(input);
        return { txHash: 'mock:fund' };
      },
      get: async () => ({ balances: { 'metals.t1': '1500' } }),
    } as never,
    {
      ensurePlanetDao: async (planetId: string) => ({
        planetId,
        daoAccountId: 'pl-dune.dao.mock',
        opId: 'dao-create:pl_dune',
      }),
    } as never,
    {
      isLoaded: () => true,
      fullState: async () => ({ tick: 1_000 }),
      submit: async (_planetId: string, command: SimCommandV1) => {
        submitted.push(command);
        return { ok: true, commandId: command.commandId };
      },
    } as never,
    { post: vi.fn() } as never,
    { pay } as never,
    {
      find: async () => row,
      completeForPayout: async (_id: string, accountId: string) => {
        if (row) row = { ...row, state: 'completed', claimerAccountId: accountId };
        return true;
      },
      markCompleted: async () => {
        if (row) row = { ...row, state: 'completed' };
        return true;
      },
    } as never,
    { load: async () => null } as never,
    {} as never,
  );
  cmd.onModuleInit();
  return {
    registered,
    submitted,
    deposits,
    pay,
    row: () => row,
    setRow: (next: typeof row) => {
      row = next;
    },
  };
}

describe('W22-35 dev console commands', () => {
  it('posts meteor_shield from the loaded tick and rejects nuke', async () => {
    const { registered, submitted } = harness();
    const effect = registered.get('treasury.effect');
    expect(effect?.args.safeParse({ kind: 'meteor_shield', planetId: 'pl_dune' }).success).toBe(true);
    expect(effect?.args.safeParse({ kind: 'nuke', planetId: 'pl_dune' }).success).toBe(false);
    const out = (await effect!.run({ kind: 'meteor_shield', planetId: 'pl_dune' })) as {
      untilTick: number;
      tick: number;
    };
    expect(out.tick).toBe(1_000);
    expect(out.untilTick).toBe(1_000 + (6 * 3_600_000) / 200);
    expect(submitted[0]).toMatchObject({
      source: 'system',
      colonyIndex: null,
      kind: 'system.treasuryEffect',
      args: { kind: 'meteor_shield', untilTick: out.untilTick },
    });
  });

  it('funds metals.t1, completes a claimed bounty, and spawns the light squad', async () => {
    const { registered, deposits, submitted, pay } = harness();
    const funded = (await registered.get('treasury.fund')!.run({ planetId: 'pl_dune', amount: 1500 })) as {
      balance: string;
      tokenId: string;
    };
    expect(funded.tokenId).toBe('metals.t1');
    expect(funded.balance).toBe('1500');
    expect(deposits[0]).toMatchObject({
      tokenId: 'metals.t1',
      amount: '1500',
      from: DEV_TREASURY_FUNDER,
      daoAccountId: 'pl-dune.dao.mock',
    });

    const done = (await registered.get('bounty.complete')!.run({ id: 'bt_1' })) as {
      state: string;
      paid: boolean;
      claimer: string;
    };
    expect(done).toMatchObject({ state: 'paid', paid: true, claimer: 'b.terraagent.mock' });
    expect(pay).toHaveBeenCalledWith('bt_1', 'b.terraagent.mock');

    const hired = (await registered.get('merc.hire')!.run({
      planetId: 'pl_dune',
      colonyIndex: 0,
      hours: 2,
      q: 4,
      r: -2,
    })) as { count: number; escrow: boolean; endTick: number };
    expect(hired.count).toBe(4);
    expect(hired.escrow).toBe(false);
    expect(hired.endTick).toBe(1_000 + (2 * 3_600_000) / 200);
    expect(submitted.at(-1)).toMatchObject({
      source: 'dev',
      colonyIndex: 0,
      kind: 'mercenary.spawn',
      args: { q: 4, r: -2, count: 4, rosterId: 'light', radius: 3, endTick: hired.endTick },
    });
  });

  it('skips pay when the bounty has no claimer and rejects the commands when W22 is off', async () => {
    const open = harness();
    open.setRow({ id: 'bt_open', state: 'open', claimerAccountId: null });
    const skipped = (await open.registered.get('bounty.complete')!.run({ id: 'bt_open' })) as {
      state: string;
      paid: boolean;
      note?: string;
    };
    expect(skipped.state).toBe('completed');
    expect(skipped.paid).toBe(false);
    expect(skipped.note).toContain('no claimer');
    expect(open.pay).not.toHaveBeenCalled();

    const off = harness({ has: () => false, flags: parseWaves('..21') });
    await expect(
      off.registered.get('treasury.effect')!.run({ kind: 'meteor_shield', planetId: 'pl_dune' }),
    ).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });
  });
});
