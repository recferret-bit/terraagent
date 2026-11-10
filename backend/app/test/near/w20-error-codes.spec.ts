import { describe, expect, it } from 'vitest';
import { mapError, restCodeFor } from '../../src/core/errors/map-error';
import { NEAR_ERROR_CODES, NearException } from '../../src/near/domain/errors';
import { DeedNftPort } from '../../src/near/application/ports/deed-nft.port';
import { StakingPort, StakeInput, StakingPoolView, StakingPositionView } from '../../src/near/application/ports/staking.port';

describe('W20-01 NEAR error codes & port definitions', () => {
  it('maps each F6 (W20) error code to its HTTP status, REST code, and description', () => {
    const expected = {
      DEED_NOT_FOUND: { status: 404, restCode: 'deed_not_found', description: 'Colony Deed not found.' },
      DEED_NOT_SETTLED: { status: 409, restCode: 'deed_not_settled', description: 'Available after your colony is Settled.' },
      ACCOUNT_NOT_CLAIMED: { status: 409, restCode: 'account_not_claimed', description: 'Claim your colony account before staking NEAR.' },
      POOL_NOT_WHITELISTED: { status: 422, restCode: 'pool_not_whitelisted', description: 'Staking pool is not in NEAR_STAKING_POOLS.' },
      STAKE_INSUFFICIENT_BALANCE: { status: 409, restCode: 'stake_insufficient_balance', description: 'Insufficient NEAR balance in your wallet for this stake.' },
    } as const;

    for (const code of Object.keys(expected) as (keyof typeof expected)[]) {
      const err = new NearException(code);
      expect(err.status).toBe(expected[code].status);
      expect(err.message).toBe(expected[code].description);
      expect(NEAR_ERROR_CODES[code]).toEqual({ status: expected[code].status, description: expected[code].description });
      expect(restCodeFor(err.status, code)).toBe(expected[code].restCode);
      const mapped = mapError(err);
      expect(mapped.status).toBe(expected[code].status);
      expect(mapped.errorCode).toBe(code);
    }
  });

  it('exposes DeedNftPort (without markSettled) and StakingPort schemas', () => {
    expect(DeedNftPort).toBeDefined();
    expect('markSettled' in DeedNftPort.prototype).toBe(false);
    expect(StakingPort).toBeDefined();

    expect(
      StakingPoolView.parse({
        poolId: 'astro-stakers.pool.mock',
        name: 'Astro Stakers',
        apyBp: 900,
      }).poolId,
    ).toBe('astro-stakers.pool.mock');

    expect(
      StakeInput.parse({
        opId: 'stake:col-0:1',
        accountId: 'col-0.pilot.terraagent.mock',
        pool: 'astro-stakers.pool.mock',
        amount: '10000000000000000000000000',
      }).pool,
    ).toBe('astro-stakers.pool.mock');

    expect(
      StakingPositionView.parse({
        accountId: 'col-0.pilot.terraagent.mock',
        pool: 'astro-stakers.pool.mock',
        staked: '10000000000000000000000000',
        unbonding: '0',
        unbondingReadyAtMs: null,
        withdrawable: '0',
        rewards: '500000000000000000000',
      }).staked,
    ).toBe('10000000000000000000000000');
  });
});
