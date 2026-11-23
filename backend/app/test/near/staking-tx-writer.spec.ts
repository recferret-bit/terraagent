import { describe, expect, it } from 'vitest';
import { StakingTxWriter, stakingTxId, type StakingTxEntry } from '../../src/near/staking/services/staking-tx.writer';

const entry = (over: Partial<StakingTxEntry> = {}): StakingTxEntry => ({
  kind: 'stake',
  accountId: 'a.near',
  poolId: 'p.pool.mock',
  asset: 'near',
  amountYocto: 5n,
  txHash: 'mock:abc',
  opId: 'op-1',
  atMs: 1_700_000_000_000,
  ...over,
});

describe('W28-04 StakingTxWriter', () => {
  it('derives a stable id that fits the 120-char column even for a 200-char op id, per kind', () => {
    const long = 'x'.repeat(200);
    const id = stakingTxId('stake', long);
    expect(id.length).toBeLessThanOrEqual(120);
    expect(stakingTxId('stake', long)).toBe(id);
    expect(stakingTxId('unstake', long)).not.toBe(id);
    expect(stakingTxId('stake', `${long}y`)).not.toBe(id);
  });

  it('upserts with an empty update (a replay changes nothing) and stores the staking-clock time', async () => {
    const calls: Array<{ where: { id: string }; create: { createdAt: Date; amountYocto: string }; update: object }> = [];
    const writer = new StakingTxWriter(() => ({ stakingTx: { upsert: async (a: never) => void calls.push(a) } }) as never);
    await writer.record(entry());
    await writer.record(entry());
    expect(calls).toHaveLength(2);
    expect(calls[0]!.where.id).toBe(calls[1]!.where.id);
    expect(calls[0]!.update).toEqual({});
    expect(calls[0]!.create).toMatchObject({ amountYocto: '5', createdAt: new Date(1_700_000_000_000) });
  });

  it('is a no-op without a database and logs (never throws) when the write fails', async () => {
    await expect(new StakingTxWriter(() => null).record(entry())).resolves.toBeUndefined();
    const failing = new StakingTxWriter(() => ({ stakingTx: { upsert: async () => { throw new Error('db down'); } } }) as never);
    await expect(failing.record(entry())).resolves.toBeUndefined();
  });
});
