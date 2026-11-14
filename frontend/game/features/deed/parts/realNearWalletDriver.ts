import type { NearAuthChallengeResponse } from '@terra/contracts';
import type { WalletSelector } from '@near-wallet-selector/core';
import { ensureBrowserPolyfills } from '../../../../design/pilot/browserPolyfills';
import {
  assertNetworkAccountId,
  getPrewarmedWallet,
  getTestnetWalletSelector,
  signWithSelectorWallet,
  warmSelectorWallets,
} from '../../../../design/pilot/walletSelectorRuntime';

export type RealNearNetwork = 'testnet' | 'mainnet';

export type RealSignerWalletModuleId =
  | 'meteor-wallet'
  | 'okx-wallet'
  | 'near-mobile-wallet'
  | 'intear-wallet'
  | 'my-near-wallet';

export interface RealSignerWalletRequest {
  readonly network: RealNearNetwork;
  readonly moduleId: RealSignerWalletModuleId;
  readonly message: string;
  readonly nonceBase64: string;
  readonly nonceBytes: Uint8Array;
  readonly recipient: string;
  readonly preverifiedAccountId?: string;
}

export interface RealSignerWalletResult {
  readonly accountId: string;
  readonly publicKey: string;
  readonly signature: string;
  readonly callbackUrl?: string;
}

export type RealSignerWalletDriver = (req: RealSignerWalletRequest) => Promise<RealSignerWalletResult>;

let mainnetSelectorPromise: Promise<WalletSelector> | null = null;
let resolvedMainnetSelector: WalletSelector | null = null;
let testDriverOverride: RealSignerWalletDriver | null = null;

/** Test seam allowing jsdom unit specs to exercise real signer wallet buttons deterministically. */
export function setRealSignerWalletDriverForTests(driver: RealSignerWalletDriver | null): void {
  testDriverOverride = driver;
}

export function getRealSignerModuleIds(network: RealNearNetwork): readonly RealSignerWalletModuleId[] {
  return network === 'testnet'
    ? ['meteor-wallet', 'okx-wallet', 'near-mobile-wallet', 'intear-wallet', 'my-near-wallet']
    : ['meteor-wallet', 'okx-wallet', 'near-mobile-wallet', 'intear-wallet'];
}

export async function createRealSignerWalletSelector(network: RealNearNetwork): Promise<WalletSelector> {
  if (network === 'testnet') {
    return getTestnetWalletSelector();
  }
  if (resolvedMainnetSelector) return resolvedMainnetSelector;
  if (mainnetSelectorPromise) return mainnetSelectorPromise;
  mainnetSelectorPromise = (async () => {
    ensureBrowserPolyfills();
    const [
      { setupWalletSelector },
      { setupMeteorWallet },
      { setupOKXWallet },
      { setupNearMobileWallet },
      { setupIntearWallet },
    ] = await Promise.all([
      import('@near-wallet-selector/core'),
      import('@near-wallet-selector/meteor-wallet'),
      import('@near-wallet-selector/okx-wallet'),
      import('@near-wallet-selector/near-mobile-wallet'),
      import('@near-wallet-selector/intear-wallet'),
    ]);
    const origin = typeof location !== 'undefined' ? location.origin : 'https://terraagent.fun';
    const selector = await setupWalletSelector({
      allowMultipleSelectors: true,
      network: {
        networkId: 'mainnet',
        nodeUrl: 'https://free.rpc.fastnear.com',
        helperUrl: 'https://helper.mainnet.near.org',
        explorerUrl: 'https://nearblocks.io',
        indexerUrl: 'https://api.kitwallet.app',
      },
      modules: [
        setupMeteorWallet(),
        setupOKXWallet(),
        setupNearMobileWallet({
          dAppMetadata: { name: 'TerraAgent', logoUrl: `${origin}/favicon.svg`, url: origin },
        }),
        setupIntearWallet(),
      ],
    });
    resolvedMainnetSelector = selector;
    warmSelectorWallets('mainnet', selector);
    return selector;
  })().catch((err) => {
    mainnetSelectorPromise = null;
    resolvedMainnetSelector = null;
    throw err;
  });
  return mainnetSelectorPromise;
}

function toSignerResult(verified: {
  readonly accountId: string;
  readonly publicKey: string;
  readonly signature: string;
  readonly callbackUrl?: string;
}): RealSignerWalletResult {
  return {
    accountId: verified.accountId,
    publicKey: verified.publicKey.trim(),
    signature: verified.signature.trim(),
    ...(verified.callbackUrl ? { callbackUrl: verified.callbackUrl } : {}),
  };
}

export function signWithBrowserWalletSelector(
  params: RealSignerWalletRequest,
): Promise<RealSignerWalletResult> {
  if (testDriverOverride) {
    return testDriverOverride(params).then((res) => ({
      accountId: assertNetworkAccountId(res.accountId, params.network),
      publicKey: res.publicKey.trim(),
      signature: res.signature.trim(),
      ...(res.callbackUrl ? { callbackUrl: res.callbackUrl } : {}),
    }));
  }
  if (params.moduleId === 'my-near-wallet' && params.network !== 'testnet') {
    return Promise.reject(new Error('MyNearWallet is only enabled for NEAR Testnet.'));
  }
  const BufferCtor = ensureBrowserPolyfills();
  const callbackUrl =
    typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://terraagent.fun/';
  const stateId = `signer-${params.nonceBase64.slice(0, 16)}`;
  const signerChallenge: NearAuthChallengeResponse = {
    challengeId: stateId,
    message: params.message,
    nonce: params.nonceBase64,
    recipient: params.recipient,
    network: params.network,
    expiresAt: Date.now() + 5 * 60_000,
  };
  const progress = params.preverifiedAccountId ? { preverifiedAccountId: params.preverifiedAccountId } : undefined;
  const prewarmedWallet = getPrewarmedWallet(params.network, params.moduleId);
  if (prewarmedWallet) {
    if (prewarmedWallet.type === 'hardware') {
      return Promise.reject(new Error('Hardware wallets are not supported in browser popup mode.'));
    }
    return signWithSelectorWallet(
      prewarmedWallet,
      params.moduleId,
      signerChallenge,
      callbackUrl,
      BufferCtor,
      progress,
    ).then(toSignerResult);
  }
  return (async () => {
    const selector = await createRealSignerWalletSelector(params.network);
    const wallet = await selector.wallet(params.moduleId);
    if (wallet.type === 'hardware') {
      throw new Error('Hardware wallets are not supported in browser popup mode.');
    }
    const verified = await signWithSelectorWallet(
      wallet,
      params.moduleId,
      signerChallenge,
      callbackUrl,
      BufferCtor,
      progress,
    );
    return toSignerResult(verified);
  })();
}
