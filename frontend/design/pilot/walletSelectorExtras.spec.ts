// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePerformance } from '../../game/pages/me/sections/staking/dashboard/dashboardFixtures';
import { renderPatronCard } from '../../game/pages/me/sections/staking/dashboard/parts/patronCard';
import { saveNearWallet } from './nearWalletStorage';
import { sendTxWithInjectedExtraWallet } from './walletSelectorExtras';

describe('sendTxWithInjectedExtraWallet', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).hotWallet;
    delete (window as unknown as Record<string, unknown>).nightly;
    localStorage.clear();
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

  it('routes NEAR Social Patron Card share transactions through an injected hot-wallet session on testnet', async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ transaction_outcome: { id: 'tx_social_hot' } });
    (window as unknown as Record<string, unknown>).hotWallet = { signAndSendTransaction };
    saveNearWallet({ walletId: 'hot-wallet', walletName: 'HOT Wallet', accountId: 'pilot.testnet', publicKey: 'ed25519:abc', connectedAt: 1 });

    const opened: string[] = [];
    const card = renderPatronCard(makePerformance({ accountId: 'pilot.testnet' }), {
      accountId: 'pilot.testnet',
      network: 'testnet',
      origin: 'https://play.terraagent.fun',
      openWindow: (u) => opened.push(u),
    });
    card.querySelector<HTMLButtonElement>('[data-testid="staking-share-social"]')!.click();
    await new Promise((r) => setTimeout(r, 15));

    expect(signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ receiverId: 'v1.social08.testnet' }),
    );
    expect(opened).toHaveLength(1);
  });
});
