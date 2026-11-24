// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LST_CONTRACTS, sendStakingWalletTx } from './stakingWalletTx';

describe('W28 stakingWalletTx (unit)', () => {
  it('exposes testnet and mainnet LST contracts and converts gasTgas via BigInt 10^12', async () => {
    expect(LST_CONTRACTS.testnet.stNEAR).toBe('meta-v2.pool.testnet');
    expect(LST_CONTRACTS.mainnet.stNEAR).toBe('meta-pool.near');
    expect(LST_CONTRACTS.mainnet.LiNEAR).toBe('linear-protocol.near');

    const statusMsgEl = document.createElement('span');
    const signCalls: Array<{ receiverId: string; actions: unknown[] }> = [];
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          contractId: 'staking.terraagent.testnet',
          methodName: 'stake_payable',
          args: { pool_id: 'astro-stakers.pool.testnet' },
          attachedDepositYocto: '10000000000000000000000000',
          gasTgas: 85,
        }),
        { status: 200 },
      ),
    );
    const onSuccess = vi.fn();
    const res = await sendStakingWalletTx({
      fetchFn: fetchFn as unknown as typeof fetch,
      network: 'testnet',
      action: 'stake_payable',
      poolId: 'astro-stakers.pool.testnet',
      amountNear: '10',
      accountId: 'pilot.testnet',
      statusMsgEl,
      selectorFactory: async () =>
        ({
          wallet: async () => ({
            signAndSendTransaction: async (tx: { receiverId: string; actions: unknown[] }) => {
              signCalls.push(tx);
              return { transaction: { hash: 'tx-wallet-1' } };
            },
          }),
        }) as never,
      onSuccess,
    });

    expect(res).toContain('Submitted');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(signCalls).toHaveLength(1);
    const fc = (signCalls[0]!.actions[0] as { functionCall?: { gas?: bigint; deposit?: bigint } }).functionCall;
    expect(fc?.gas).toBe(85_000_000_000_000n);
    expect(fc?.deposit).toBe(10_000_000_000_000_000_000_000_000n);
  });

  it('surfaces descriptor HTTP errors and returns null cleanly when wallet signing is cancelled', async () => {
    const statusMsgEl = document.createElement('span');
    const errRes = await sendStakingWalletTx({
      fetchFn: (async () => new Response(JSON.stringify({ message: 'Bad LST pool' }), { status: 400 })) as unknown as typeof fetch,
      network: 'testnet',
      action: 'deposit_and_stake_lst',
      poolId: 'evil.testnet',
      amountNear: '5',
      accountId: 'pilot.testnet',
      statusMsgEl,
    });
    expect(errRes).toBeNull();
    expect(statusMsgEl.textContent?.trim().length).toBeGreaterThan(0);

    const cancelRes = await sendStakingWalletTx({
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            contractId: 'staking.terraagent.testnet',
            methodName: 'unstake',
            args: { pool_id: 'astro.pool.testnet' },
            attachedDepositYocto: '0',
            gasTgas: 60,
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
      network: 'testnet',
      action: 'unstake',
      poolId: 'astro.pool.testnet',
      amountNear: '2',
      accountId: 'pilot.testnet',
      statusMsgEl,
      selectorFactory: async () =>
        ({
          wallet: async () => ({
            signAndSendTransaction: async () => {
              throw new Error('User cancelled wallet prompt');
            },
          }),
        }) as never,
    });
    expect(cancelRes).toBeNull();
    expect(statusMsgEl.textContent).toContain('User cancelled');
  });
});
