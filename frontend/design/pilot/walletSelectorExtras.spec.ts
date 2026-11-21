// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTxWithInjectedExtraWallet } from './walletSelectorExtras';

describe('sendTxWithInjectedExtraWallet', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).hotWallet;
    delete (window as unknown as Record<string, unknown>).nightly;
  });

  it('dispatches signAndSendTransaction to injected hot-wallet and nightly providers and returns true', async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ transaction_outcome: { id: 'tx_hot_123' } });
    (window as unknown as Record<string, unknown>).hotWallet = { signAndSendTransaction };
    (window as unknown as Record<string, unknown>).nightly = { near: { signAndSendTransaction } };

    const sent = await sendTxWithInjectedExtraWallet('hot-wallet', {
      receiverId: 'staking.terraagent.testnet',
      methodName: 'stake_payable',
      args: { pool_id: 'astro-stakers.pool.testnet' },
      gasYocto: '50000000000000',
      depositYocto: '10000000000000000000000000',
    });
    const sentNightly = await sendTxWithInjectedExtraWallet('nightly', {
      receiverId: 'staking.terraagent.testnet',
      methodName: 'unstake',
      args: { pool_id: 'astro-stakers.pool.testnet' },
      gasYocto: '30000000000000',
      depositYocto: '0',
    });

    expect(sent).toBe(true);
    expect(sentNightly).toBe(true);
    expect(signAndSendTransaction).toHaveBeenCalledWith({
      receiverId: 'staking.terraagent.testnet',
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'stake_payable',
            args: { pool_id: 'astro-stakers.pool.testnet' },
            gas: '50000000000000',
            deposit: '10000000000000000000000000',
          },
        },
      ],
    });
  });

  it('returns false when the injected wallet is not present or unsupported', async () => {
    expect(
      await sendTxWithInjectedExtraWallet('hot-wallet', {
        receiverId: 'staking.terraagent.testnet',
        methodName: 'unstake',
        args: {},
        gasYocto: '30000000000000',
        depositYocto: '0',
      }),
    ).toBe(false);
    expect(
      await sendTxWithInjectedExtraWallet('meteor-wallet', {
        receiverId: 'staking.terraagent.testnet',
        methodName: 'unstake',
        args: {},
        gasYocto: '30000000000000',
        depositYocto: '0',
      }),
    ).toBe(false);
  });
});
