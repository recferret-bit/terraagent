import type { PrismaClient } from '@terra/db';
import { afterEach, describe, expect, it } from 'vitest';
import { CoreException } from '../../src/core/errors';
import type { DevCommand } from '../../src/dev/dev-command.registry';
import { NearException } from '../../src/near/domain/errors';
import { NearMockCommand } from '../../src/near/infrastructure/dev/near-mock.command';
import type { MockChainConfig } from '../../src/near/infrastructure/mock/mock-chain.config';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls';
import { FixtureMock } from './fixture-mock';

const base = (failRate: number): MockChainConfig => ({ latencyMinMs: 300, latencyMaxMs: 1500, failRate, seed: 1 });

function commands(): Map<string, DevCommand> {
  const registered = new Map<string, DevCommand>();
  const cmd = new NearMockCommand(
    { register: (c: DevCommand) => { registered.set(c.name, c); } } as never,
    {} as PrismaClient,
    {} as never,
    {} as never,
  );
  cmd.onModuleInit();
  return registered;
}

afterEach(() => { mockChainControls.reset(); });

describe('mockChainControls.overlay', () => {
  it('returns the base fail rate when the port has no override', () => {
    const cfg = base(0.25);
    expect(mockChainControls.overlay('relayer', cfg)).toBe(cfg);
    expect(mockChainControls.overlay('relayer', cfg).failRate).toBe(0.25);
  });

  it('setFail is case-insensitive and replaces a zero base', () => {
    mockChainControls.setFail('Relayer', 1);
    expect(mockChainControls.overlay('relayer', base(0)).failRate).toBe(1);
  });

  it('maps TreasuryDao onto the treasury fail key', () => {
    mockChainControls.setFail('treasury', 1);
    expect(mockChainControls.overlay('TreasuryDao', base(0)).failRate).toBe(1);
  });

  it('setFail 0 forces success even when the base fail rate is 1', () => {
    mockChainControls.setFail('relayer', 0);
    expect(mockChainControls.overlay('Relayer', base(1)).failRate).toBe(0);
  });

  it('reset clears the override', () => {
    mockChainControls.setFail('relayer', 1);
    mockChainControls.reset();
    const cfg = base(0.4);
    expect(mockChainControls.overlay('relayer', cfg)).toBe(cfg);
    expect(cfg.failRate).toBe(0.4);
  });

  it('a fail override on one port does not change another, and latency replaces only the range', () => {
    mockChainControls.setFail('relayer', 1);
    mockChainControls.setLatency('Relayer', 0, 20);
    const cargo = base(0);
    expect(mockChainControls.overlay('cargo', cargo)).toBe(cargo);
    expect(mockChainControls.overlay('relayer', base(0))).toMatchObject({ failRate: 1, latencyMinMs: 0, latencyMaxMs: 20, seed: 1 });
    expect(() => mockChainControls.setLatency('relayer', 10, 1)).toThrow(/maxMs/);
  });

  it('callWithResult rolls the overlay rate, not the boot rate', async () => {
    mockChainControls.setFail('fixture', 1);
    const mock = new FixtureMock({} as PrismaClient, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 }, { sleep: async () => undefined });
    const err = await mock.fund(undefined, 'a.near', 'NEAR', '1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoreException);
    expect(err).toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE', status: 503 });
  });
});

describe('near mock dev commands', () => {
  it('near.mock.fail stores the rate, and latency rejects max < min with 400', async () => {
    const table = commands();
    await table.get('near.mock.fail')!.run({ port: 'Relayer', rate: 1 });
    expect(mockChainControls.overlay('relayer', base(0)).failRate).toBe(1);
    let err: unknown;
    try {
      await table.get('near.mock.latency')!.run({ port: 'relayer', minMs: 10, maxMs: 1 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreException);
    expect(err).toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });
    expect(mockChainControls.overlay('relayer', base(0)).latencyMinMs).toBe(300);
  });

  it('near.error throws the four player codes and rejects anything else with 400', async () => {
    const table = commands();
    const cases = [
      ['NEAR_PROVIDER_REJECTED', 401],
      ['NEAR_NAME_TAKEN', 409],
      ['NEAR_RELAY_FAILED', 503],
      ['NEAR_RELAY_RECEIVER_NOT_ALLOWED', 403],
    ] as const;
    for (const [code, status] of cases) {
      let err: unknown;
      try {
        await table.get('near.error')!.run({ code });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(NearException);
      expect(err).toMatchObject({ errorCode: code, status });
    }
    let bad: unknown;
    try {
      await table.get('near.error')!.run({ code: 'NEAR_UNAVAILABLE' });
    } catch (e) {
      bad = e;
    }
    expect(bad).toBeInstanceOf(CoreException);
    expect(bad).not.toBeInstanceOf(NearException);
    expect(bad).toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });
    expect(table.has('near.mock.fail')).toBe(true);
    expect(table.has('near.mock.latency')).toBe(true);
    expect(table.has('account.reset')).toBe(true);
    expect(table.has('account.upgrade')).toBe(true);
  });
});
