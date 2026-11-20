import { describe, expect, it } from 'vitest';
import { buildStakingWalletTxDescriptor } from '../../src/near/staking/staking-wallet-tx.js';

const TESTNET = { NEAR_ADAPTER_STAKING: 'testnet' };

describe('W28-07 staking wallet-tx: compound_yield & withdraw_lst', () => {
  it('builds an owner-signed compound_yield with zero deposit and a non-operator-safe APY', () => {
    const tx = buildStakingWalletTxDescriptor(
      { action: 'compound_yield', poolId: 'astro-stakers.pool.testnet', accountId: 'pilot.testnet' },
      TESTNET,
    );
    expect(tx.methodName).toBe('compound_yield');
    expect(tx.attachedDepositYocto).toBe('0');
    expect(tx.contractId).toBe('staking.terraagent.testnet');
    expect(tx.args).toMatchObject({ pool_id: 'astro-stakers.pool.testnet', account_id: 'pilot.testnet' });
    expect(Number(tx.args.apy_bp)).toBeLessThanOrEqual(1_000);
  });

  it('defaults the compound pool and omits account_id when the wallet is the caller', () => {
    const tx = buildStakingWalletTxDescriptor({ action: 'compound_yield' }, TESTNET);
    expect(tx.args.pool_id).toBe('astro-stakers.pool.testnet');
    expect(tx.args).not.toHaveProperty('account_id');
  });

  it('builds withdraw_lst against a whitelisted LST with zero deposit', () => {
    const tx = buildStakingWalletTxDescriptor(
      { action: 'withdraw_lst', lstContract: 'meta-v2.pool.testnet', amountNear: '3', poolId: 'meta-v2.pool.testnet' },
      TESTNET,
    );
    expect(tx.methodName).toBe('withdraw_lst');
    expect(tx.attachedDepositYocto).toBe('0');
    expect(tx.args).toMatchObject({
      pool_id: 'meta-v2.pool.testnet',
      lst_contract: 'meta-v2.pool.testnet',
      amount: '3000000000000000000000000',
    });
  });

  it('rejects an unwhitelisted LST for withdraw_lst and unknown actions', () => {
    expect(() =>
      buildStakingWalletTxDescriptor({ action: 'withdraw_lst', lstContract: 'evil.testnet' }, TESTNET),
    ).toThrow(/unwhitelisted/i);
    expect(() => buildStakingWalletTxDescriptor({ action: 'drain' }, TESTNET)).toThrow(/Unsupported/);
  });

  it('keeps stake_payable as the single native tx carrying the attached deposit', () => {
    const tx = buildStakingWalletTxDescriptor({ action: 'stake_payable', amountNear: '10', poolId: 'p.pool.testnet' }, TESTNET);
    expect(tx.methodName).toBe('stake_payable');
    expect(tx.attachedDepositYocto).toBe('10000000000000000000000000');
  });
});
