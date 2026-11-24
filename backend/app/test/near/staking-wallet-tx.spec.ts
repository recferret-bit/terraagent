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

  it('builds deposit_and_stake_lst with protocol builder referral, 95 TGas, and attached NEAR deposit', () => {
    const tx = buildStakingWalletTxDescriptor(
      {
        action: 'deposit_and_stake_lst',
        lstContract: 'meta-pool.near',
        poolId: 'meta-pool.near',
        amountNear: '25',
      },
      { NEAR_ADAPTER_STAKING: 'mainnet' },
    );
    expect(tx.methodName).toBe('deposit_and_stake_lst');
    expect(tx.contractId).toBe('staking.terraagent.near');
    expect(tx.attachedDepositYocto).toBe('25000000000000000000000000');
    expect(tx.gasTgas).toBe(95);
    expect(tx.args).toMatchObject({
      pool_id: 'meta-pool.near',
      lst_contract: 'meta-pool.near',
      referral_id: 'protocol.terraagent.near',
    });
  });

  it('rejects deposit_and_stake_lst on unwhitelisted LST or zero/missing deposit', () => {
    expect(() =>
      buildStakingWalletTxDescriptor(
        { action: 'deposit_and_stake_lst', lstContract: 'rogue.near', amountNear: '5' },
        { NEAR_ADAPTER_STAKING: 'mainnet' },
      ),
    ).toThrow(/unwhitelisted/i);
    expect(() =>
      buildStakingWalletTxDescriptor(
        { action: 'deposit_and_stake_lst', lstContract: 'meta-pool.near', amountNear: '0' },
        { NEAR_ADAPTER_STAKING: 'mainnet' },
      ),
    ).toThrow(/amountNear/i);
  });
});

describe('W28-07 staking wallet-tx cross-network, HTTP 400 & LST compound guards', () => {
  it('rejects cross-network LST contracts, invalid NEAR decimals with HTTP 400, and sets apy_bp=0 on LST compound', () => {
    expect(() =>
      buildStakingWalletTxDescriptor(
        { action: 'deposit_and_stake_lst', lstContract: 'meta-pool.near', amountNear: '5' },
        { NEAR_ADAPTER_STAKING: 'testnet' },
      ),
    ).toThrow(/unwhitelisted/i);

    try {
      buildStakingWalletTxDescriptor(
        { action: 'deposit_and_stake', poolId: 'astro-stakers.poolv1.near', amountNear: 'not-a-number' },
        { NEAR_ADAPTER_STAKING: 'mainnet' },
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { getStatus?: () => number; code?: string }).getStatus?.() ?? (err as { status?: number }).status).toBe(400);
    }

    expect(() =>
      buildStakingWalletTxDescriptor(
        { action: 'unstake', poolId: 'astro-stakers.poolv1.near', amountNear: '0' },
        { NEAR_ADAPTER_STAKING: 'mainnet' },
      ),
    ).toThrow(/amountNear/i);

    const stNearCompound = buildStakingWalletTxDescriptor(
      { action: 'compound_yield', poolId: 'meta-pool.near' },
      { NEAR_ADAPTER_STAKING: 'mainnet' },
    );
    expect((stNearCompound.args as { apy_bp?: number }).apy_bp).toBe(0);

    const nativeCompound = buildStakingWalletTxDescriptor(
      { action: 'compound_yield', poolId: 'astro-stakers.poolv1.near' },
      { NEAR_ADAPTER_STAKING: 'mainnet' },
    );
    expect((nativeCompound.args as { apy_bp?: number }).apy_bp).toBeGreaterThan(0);
  });
});
