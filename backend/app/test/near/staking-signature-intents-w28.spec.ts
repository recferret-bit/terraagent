import { describe, expect, it } from 'vitest';
import { assertStakingMessageMatchesIntent } from '../../src/near/staking/staking-signature-guard';

const base = { colonyId: 'alice.near', poolId: 'p.pool.mock' };

describe('W28-04 NEP-413 intent binding for compound and stake_profits', () => {
  it('compound binds to the pool (compact and wallet-scoped forms) and rejects another pool or action', () => {
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'compound', message: 'compound:p.pool.mock' })).not.toThrow();
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'compound', message: 'compound:alice.near:p.pool.mock' })).not.toThrow();
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'compound', message: 'compound' })).not.toThrow();
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'compound', message: 'compound:other.pool.mock' })).toThrow(/does not match/);
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'compound', message: 'withdraw:p.pool.mock' })).toThrow(/expected message starting with "compound:"/);
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'compound', message: 'compound:bob.near:p.pool.mock' })).toThrow(/signed colonyId/);
  });

  it('stake_profits binds the USDC amount and cannot be replayed with a bigger one', () => {
    const ok = { ...base, action: 'stake_profits' as const, amount: '10' };
    expect(() => assertStakingMessageMatchesIntent({ ...ok, message: 'stake_profits:10' })).not.toThrow();
    expect(() => assertStakingMessageMatchesIntent({ ...ok, message: 'stake_profits:p.pool.mock:10.0' })).not.toThrow();
    expect(() => assertStakingMessageMatchesIntent({ ...ok, message: 'stake_profits:1' })).toThrow(/does not match requested amount/);
    expect(() => assertStakingMessageMatchesIntent({ ...ok, message: 'stake:10' })).toThrow(/expected message starting with/);
  });

  it('withdraw keeps its original messages and wording', () => {
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'withdraw', message: 'withdraw:p.pool.mock' })).not.toThrow();
    expect(() => assertStakingMessageMatchesIntent({ ...base, action: 'withdraw', message: 'withdraw:zzz' })).toThrow(/signed withdraw target/);
  });
});
