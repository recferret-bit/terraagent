import type { PrismaClient } from '@terra/db';
import { describe, expect, it, vi } from 'vitest';
import type { DevCommand } from '../../src/dev/dev-command.registry';
import { toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port';
import { NearMockCommand } from '../../src/near/infrastructure/dev/near-mock.command';
import { InMemoryCargoToken } from '../../src/near/testing/in-memory-cargo-token';

describe('cargo.grant dev command (W10-26)', () => {
  it('registers cargo.grant and mints cargo tokens on the mock chain', async () => {
    const cargo = new InMemoryCargoToken();
    const mintSpy = vi.spyOn(cargo, 'mint');

    const accounts = new Map<string, unknown>();
    const mockPrisma = {
      nearColonyAccount: {
        findFirst: vi.fn(async ({ where }: { where?: { OR?: Array<{ colonyId?: string; accountId?: string }> } }) => {
          const col = where?.OR?.[0]?.colonyId;
          if (col === 'col-1') {
            return { accountId: 'colony-1.terraagent.mock', colonyId: 'col-1' };
          }
          return null;
        }),
      },
      mockChainAccount: {
        upsert: vi.fn(async ({ where, create }: { where: { accountId: string }; create: { accountId: string } }) => {
          accounts.set(where.accountId, create);
          return create;
        }),
      },
    } as unknown as PrismaClient;

    const registered = new Map<string, DevCommand>();
    const cmd = new NearMockCommand(
      { register: (c: DevCommand) => { registered.set(c.name, c); } } as never,
      mockPrisma,
      {} as never,
      {} as never,
      cargo,
    );
    cmd.onModuleInit();

    const cargoGrant = registered.get('cargo.grant');
    expect(cargoGrant).toBeDefined();

    // 1. With matched colony in nearColonyAccount
    const res1 = (await cargoGrant!.run({
      colony: 'col-1',
      resource: 'metals.t1',
      amount: 500,
    })) as { colony: string; accountId: string; resource: string; amount: number; txHash: string };

    expect(res1.colony).toBe('col-1');
    expect(res1.accountId).toBe('colony-1.terraagent.mock');
    expect(res1.resource).toBe('metals.t1');
    expect(res1.amount).toBe(500);
    expect(res1.txHash).toBeDefined();
    expect(mintSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'colony-1.terraagent.mock',
        tokenId: 'metals.t1',
        amount: toCargoBaseUnits(500),
      }),
    );

    // 2. Fallback to ${colony}.terraagent.mock
    const res2 = (await cargoGrant!.run({
      colony: 'alpha',
      resource: 'minerals.t1',
      amount: 100,
    })) as { colony: string; accountId: string; resource: string; amount: number; txHash: string };

    expect(res2.accountId).toBe('alpha.terraagent.mock');
    expect(accounts.has('alpha.terraagent.mock')).toBe(true);
    expect(res2.txHash).toBeDefined();
  });
});
