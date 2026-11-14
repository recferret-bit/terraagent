// @vitest-environment jsdom
import type { Wallet } from '@near-wallet-selector/core';
import type { NearAuthChallengeResponse } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureBrowserPolyfills } from '../../../design/pilot/browserPolyfills';
import { openNearWalletSelectorModal } from '../../../design/pilot/nearWalletModal';
import { createPrefetchedChallengeStore, friendlyWalletError } from '../../../design/pilot/nearWalletModalParts';
import {
  assertNetworkAccountId,
  ensureWalletConnected,
  getNearWalletSelector,
  getPrewarmedWallet,
  setWalletSelectorDriverForTests,
  signWithSelectorWallet,
  WalletPopupBlockedError,
} from '../../../design/pilot/walletSelectorRuntime';
import { setRealSignerWalletDriverForTests } from '../deed/parts/realNearWalletDriver';
import { openRealNearSignerModal } from '../deed/realNearSignerModal';

const SAMPLE_PUBKEY = 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp';
const SAMPLE_SIG_B64 = btoa('s'.repeat(64));
const SAMPLE_NONCE_B64 = btoa('n'.repeat(32));

function makeChallenge(id: string, ttlMs = 300_000): NearAuthChallengeResponse {
  return {
    challengeId: id,
    message: `Sign in to TerraAgent\nNetwork: testnet\nChallenge: ${id}`,
    nonce: SAMPLE_NONCE_B64,
    recipient: 'terraagent.testnet',
    network: 'testnet',
    expiresAt: Date.now() + ttlMs,
  };
}

function makeFakeWallet(overrides: Partial<Wallet> & { name?: string } = {}): Wallet {
  return {
    id: 'meteor-wallet',
    type: 'browser',
    metadata: {
      name: overrides.name ?? 'Meteor Wallet',
      description: '',
      iconUrl: '',
      deprecated: false,
      available: true,
    },
    getAccounts: vi.fn(async () => []),
    signIn: vi.fn(async () => [{ accountId: 'alice.testnet', publicKey: SAMPLE_PUBKEY }]),
    signOut: vi.fn(async () => undefined),
    signMessage: vi.fn(async () => ({
      accountId: 'alice.testnet',
      publicKey: SAMPLE_PUBKEY,
      signature: SAMPLE_SIG_B64,
    })),
    ...overrides,
  } as unknown as Wallet;
}

afterEach(() => {
  setWalletSelectorDriverForTests(null);
  setRealSignerWalletDriverForTests(null);
  delete (window as { meteorCom?: unknown }).meteorCom;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('NEP-413 challenge pre-warming & zero-await popup invocation', () => {
  it('pre-warms challenge on modal open, invokes wallet with zero network await, and refreshes on mode toggle or low TTL', async () => {
    const challengeBodies: Array<{ intent?: string; walletId?: string }> = [];
    let nextTtlMs = 300_000;
    let seq = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/v1/auth/near/challenge') {
        seq += 1;
        challengeBodies.push(JSON.parse(String(init?.body ?? '{}')) as { intent?: string; walletId?: string });
        return new Response(JSON.stringify(makeChallenge(`ch_prewarm_00000000_${seq}`, nextTtlMs)), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    let invokedSynchronouslyInClick = false;
    let fetchCountBeforeWalletCall = -1;
    const receivedChallengeIds: string[] = [];
    setWalletSelectorDriverForTests({
      async signChallenge(_mod, ch) {
        invokedSynchronouslyInClick = syncClickActive;
        fetchCountBeforeWalletCall = fetchMock.mock.calls.length;
        receivedChallengeIds.push(ch.challengeId);
        return {
          challengeId: ch.challengeId,
          accountId: 'alice.testnet',
          publicKey: SAMPLE_PUBKEY,
          signature: SAMPLE_SIG_B64,
          walletId: 'my-near-wallet',
        };
      },
      async signOutActiveWallet() {},
    });

    const onDirectToken = vi.fn();
    let syncClickActive = false;
    const dialog = openNearWalletSelectorModal({ initialMode: 'signin', onDirectToken });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(challengeBodies[0]).toEqual({ intent: 'signin' });

    // Toggling to Sign Up pre-warms a fresh `signup` challenge; toggling back pre-warms `signin`:
    dialog.querySelector<HTMLButtonElement>('[data-testid="near-mode-signup"]')!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(challengeBodies[1]).toEqual({ intent: 'signup' });

    dialog.querySelector<HTMLButtonElement>('[data-testid="near-mode-signin"]')!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 0));

    // Clicking MyNearWallet uses ch_prewarm_00000000_3 synchronously inside the click stack with zero extra fetch!
    syncClickActive = true;
    dialog.querySelector<HTMLButtonElement>('[data-testid="near-wallet-mynearwallet"]')!.click();
    syncClickActive = false;
    expect(invokedSynchronouslyInClick).toBe(true);
    expect(fetchCountBeforeWalletCall).toBe(3);
    await vi.waitFor(() => expect(onDirectToken).toHaveBeenCalledTimes(1));
    expect(receivedChallengeIds[0]).toBe('ch_prewarm_00000000_3');

    // Low-TTL (<15s) pre-warmed challenge is discarded and re-fetched before wallet signing:
    nextTtlMs = 10_000;
    const dialogLowTtl = openNearWalletSelectorModal({ initialMode: 'signin', onDirectToken });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await new Promise((r) => setTimeout(r, 0));
    nextTtlMs = 300_000;
    dialogLowTtl.querySelector<HTMLButtonElement>('[data-testid="near-wallet-meteor"]')!.click();
    await vi.waitFor(() => expect(receivedChallengeIds[1]).toBe('ch_prewarm_00000000_5'));
  });
});

describe('Meteor web single-popup signMessage & two-step popup-blocker 1-click CTA', () => {
  it('calls wallet.signMessage directly in Meteor web mode and falls back to signIn only if required', async () => {
    const BufferCtor = ensureBrowserPolyfills();
    delete (window as { meteorCom?: unknown }).meteorCom;
    const challenge = makeChallenge('ch_meteor_web_00001');

    const directWallet = makeFakeWallet({ name: 'Meteor Wallet' });
    const directRes = await signWithSelectorWallet(
      directWallet,
      'meteor-wallet',
      challenge,
      'http://127.0.0.1:5173/',
      BufferCtor,
    );
    expect(directWallet.signIn).not.toHaveBeenCalled();
    expect(directWallet.signMessage).toHaveBeenCalledTimes(1);
    expect(directRes.accountId).toBe('alice.testnet');

    // Fallback when signMessage demands a connected account first:
    let attempts = 0;
    const fallbackWallet = makeFakeWallet({
      name: 'Meteor Wallet',
      signMessage: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('No account connected');
        return { accountId: 'alice.testnet', publicKey: SAMPLE_PUBKEY, signature: SAMPLE_SIG_B64 };
      }),
    });
    const fallbackRes = await signWithSelectorWallet(
      fallbackWallet,
      'meteor-wallet',
      challenge,
      'http://127.0.0.1:5173/',
      BufferCtor,
    );
    expect(fallbackWallet.signIn).toHaveBeenCalledWith({ contractId: '' });
    expect(fallbackRes.accountId).toBe('alice.testnet');

    // Meteor NO_ACCOUNTS ("No Meteor account found- try again after creating one") must NOT trigger a second signIn popup:
    const noAccountsWallet = makeFakeWallet({
      name: 'Meteor Wallet',
      signMessage: vi.fn(async () => {
        throw new Error('No Meteor account found- try again after creating one');
      }),
    });
    await expect(
      signWithSelectorWallet(noAccountsWallet, 'meteor-wallet', challenge, 'http://127.0.0.1:5173/', BufferCtor),
    ).rejects.toThrow('No Meteor account found- try again after creating one');
    expect(noAccountsWallet.signIn).not.toHaveBeenCalled();

    // Pre-warmed wallet + preverifiedAccountId invokes wallet.signMessage with zero microtasks on the click stack:
    await getNearWalletSelector('testnet');
    await vi.waitFor(() => expect(getPrewarmedWallet('testnet', 'intear-wallet')).toBeDefined());
    let ranSynchronouslyBeforeAwait = false;
    const syncRetryWallet = makeFakeWallet({
      id: 'intear-wallet',
      name: 'Intear Wallet',
      signMessage: vi.fn(async () => {
        ranSynchronouslyBeforeAwait = inSyncFrame;
        return { accountId: 'commander.testnet', publicKey: SAMPLE_PUBKEY, signature: SAMPLE_SIG_B64 };
      }),
    });
    let inSyncFrame = true;
    const syncPromise = signWithSelectorWallet(
      syncRetryWallet,
      'intear-wallet',
      challenge,
      'http://127.0.0.1:5173/',
      BufferCtor,
      { preverifiedAccountId: 'commander.testnet' },
    );
    inSyncFrame = false;
    expect(ranSynchronouslyBeforeAwait).toBe(true);
    expect((await syncPromise).accountId).toBe('commander.testnet');
  });

  it('reschedules expiry refresh when restoring an unused challenge after popup block', async () => {
    vi.useFakeTimers();
    let seq = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        seq += 1;
        return new Response(JSON.stringify(makeChallenge(`ch_restore_00000_${seq}`, 18_000)), { status: 200 });
      }),
    );
    const store = createPrefetchedChallengeStore();
    const initial = await store.warm('signin');
    expect(initial?.challengeId).toBe('ch_restore_00000_1');
    const taken = store.takeReady('signin');
    expect(taken?.challengeId).toBe('ch_restore_00000_1');
    store.restoreUnused('signin', taken!);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(store.takeReady('signin')?.challengeId).toBe('ch_restore_00000_2');
    store.dispose();
    vi.useRealTimers();
  });
});

describe('Two-step popup-blocker 1-click Sign NEP-413 CTA', () => {
  it('throws WalletPopupBlockedError after Intear signIn and renders 1-click Sign NEP-413 CTA in modals', async () => {
    const BufferCtor = ensureBrowserPolyfills();
    let signedInAcct: string | null = null;
    const intearWallet = makeFakeWallet({
      id: 'intear-wallet',
      name: 'Intear Wallet',
      getAccounts: vi.fn(async () => (signedInAcct ? [{ accountId: signedInAcct }] : [])),
      signIn: vi.fn(async () => {
        signedInAcct = 'commander.testnet';
        return [{ accountId: 'commander.testnet', publicKey: SAMPLE_PUBKEY }];
      }),
      signMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error('Popup was blocked'))
        .mockResolvedValueOnce({
          accountId: 'commander.testnet',
          publicKey: SAMPLE_PUBKEY,
          signature: SAMPLE_SIG_B64,
        }),
    });

    const challenge = makeChallenge('ch_intear_000000001');
    await expect(
      signWithSelectorWallet(intearWallet, 'intear-wallet', challenge, 'http://127.0.0.1:5173/', BufferCtor),
    ).rejects.toMatchObject({
      name: 'WalletPopupBlockedError',
      connectedAccountId: 'commander.testnet',
    });

    // Second invocation (from fresh CTA click) skips signIn and signs directly:
    const secondTry = await signWithSelectorWallet(
      intearWallet,
      'intear-wallet',
      challenge,
      'http://127.0.0.1:5173/',
      BufferCtor,
    );
    expect(intearWallet.signIn).toHaveBeenCalledTimes(1);
    expect(secondTry.accountId).toBe('commander.testnet');

    // Verify modal UI CTA button text & zero-fetch retry:
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(makeChallenge('ch_cta_0000000000001')), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    let modalCalls = 0;
    setWalletSelectorDriverForTests({
      async signChallenge(_mod, ch) {
        modalCalls += 1;
        if (modalCalls === 1) throw new WalletPopupBlockedError('Intear Wallet', 'commander.testnet');
        return {
          challengeId: ch.challengeId,
          accountId: 'commander.testnet',
          publicKey: SAMPLE_PUBKEY,
          signature: SAMPLE_SIG_B64,
          walletId: 'intear-wallet',
        };
      },
      async signOutActiveWallet() {},
    });
    const onDirectToken = vi.fn();
    const dialog = openNearWalletSelectorModal({ onDirectToken });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    dialog.querySelector<HTMLButtonElement>('[data-testid="near-wallet-intear"]')!.click();

    await vi.waitFor(() =>
      expect(dialog.querySelector('[data-testid="near-wallet-pair-btn"]')?.textContent).toBe(
        'Account commander.testnet connected — Click to Sign NEP-413 Message',
      ),
    );
    dialog.querySelector<HTMLButtonElement>('[data-testid="near-wallet-pair-btn"]')!.click();
    await vi.waitFor(() => expect(onDirectToken).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Wrong-network auto-signOut & clear OKX error diagnostics', () => {
  it('calls wallet.signOut() when getAccounts() or signIn() returns a Mainnet .near account on Testnet', async () => {
    const cachedMainnetWallet = makeFakeWallet({
      getAccounts: vi.fn(async () => [{ accountId: 'alice.near' }]),
    });
    await expect(ensureWalletConnected(cachedMainnetWallet, 'okx-wallet', 'testnet')).rejects.toThrow(/Mainnet/);
    expect(cachedMainnetWallet.signOut).toHaveBeenCalledTimes(1);

    const freshSignInMainnetWallet = makeFakeWallet({
      getAccounts: vi.fn(async () => []),
      signIn: vi.fn(async () => [{ accountId: 'alice.near', publicKey: SAMPLE_PUBKEY }]),
    });
    await expect(ensureWalletConnected(freshSignInMainnetWallet, 'meteor-wallet', 'testnet')).rejects.toThrow(
      /Mainnet/,
    );
    expect(freshSignInMainnetWallet.signOut).toHaveBeenCalledTimes(1);

    // Meteor web mode: clears cached Meteor localStorage keys even when wallet.signOut() rejects due to popup blocker:
    localStorage.setItem('near_app_meteor_wallet_auth_key', '{"accountId":"alice.near"}');
    localStorage.setItem('default_meteor_wallet_auth_key', '{"accountId":"alice.near"}');
    const stuckMeteorWeb = makeFakeWallet({
      id: 'meteor-wallet',
      getAccounts: vi.fn(async () => [{ accountId: 'alice.near' }]),
      signOut: vi.fn(async () => {
        throw new Error("Couldn't open popup window to complete wallet action");
      }),
    });
    await expect(ensureWalletConnected(stuckMeteorWeb, 'meteor-wallet', 'testnet')).rejects.toThrow(/Mainnet/);
    expect(localStorage.getItem('near_app_meteor_wallet_auth_key')).toBeNull();
    expect(localStorage.getItem('default_meteor_wallet_auth_key')).toBeNull();
    expect(() => assertNetworkAccountId('alice.tg', 'testnet')).toThrow(/Mainnet/);
    expect(() => assertNetworkAccountId('.testnet', 'testnet')).toThrow(/not a NEAR Testnet/);
  });

  it('maps generic OKX "sign Error" and "Failed to sign in" to actionable network diagnostics', async () => {
    const expectedTestnetMsg =
      'Wallet extension rejected or could not sign on NEAR Testnet. Ensure your wallet is unlocked, switched to NEAR Testnet (.testnet), and try again.';
    expect(friendlyWalletError(new Error('sign Error'), 'testnet')).toBe(expectedTestnetMsg);
    expect(friendlyWalletError(new Error('Failed to sign in'), 'testnet')).toBe(expectedTestnetMsg);
    expect(friendlyWalletError(new Error('sign Error'), 'mainnet')).toContain('NEAR Mainnet (.near)');

    setRealSignerWalletDriverForTests(async () => {
      throw new Error('sign Error');
    });
    const signer = openRealNearSignerModal({
      network: 'testnet',
      accountId: 'alice.testnet',
      recipient: 'terraagent.testnet',
      message: 'claim:col_0',
      actionSummary: 'Claim Colony',
    });
    signer.root.querySelector<HTMLButtonElement>('[data-testid="real-signer-okx"]')!.click();
    await vi.waitFor(() =>
      expect(signer.root.querySelector('[data-testid="signer-status"]')?.textContent).toBe(expectedTestnetMsg),
    );
    signer.close();
  });
});
