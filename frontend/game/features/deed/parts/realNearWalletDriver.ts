import type { SignedMessage, WalletSelector } from '@near-wallet-selector/core';
import { ensureBrowserPolyfills } from '../../../../design/pilot/browserPolyfills';
import {
  consumeRecentNep413PopupResult,
  savePendingNep413Redirect,
} from '../../../../design/pilot/nearAuthApi';
import { getTestnetWalletSelector } from '../../../../design/pilot/walletSelectorRuntime';

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
}

export interface RealSignerWalletResult {
  readonly accountId: string;
  readonly publicKey: string;
  readonly signature: string;
  readonly callbackUrl?: string;
}

export type RealSignerWalletDriver = (req: RealSignerWalletRequest) => Promise<RealSignerWalletResult>;

let mainnetSelectorPromise: Promise<WalletSelector> | null = null;
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

function assertAccountMatchesNetwork(accountId: string, network: RealNearNetwork): string {
  const clean = accountId.trim().toLowerCase();
  if (!clean) throw new Error('Wallet did not return a NEAR account ID.');
  if (network === 'testnet' && clean.endsWith('.near')) {
    throw new Error('Mainnet (.near) account detected. Switch your wallet network to NEAR Testnet (.testnet).');
  }
  if (network === 'mainnet' && clean.endsWith('.testnet')) {
    throw new Error('Testnet (.testnet) account detected. Switch your wallet network to NEAR Mainnet (.near).');
  }
  return clean;
}

export async function createRealSignerWalletSelector(network: RealNearNetwork): Promise<WalletSelector> {
  if (network === 'testnet') {
    return getTestnetWalletSelector();
  }
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
    return setupWalletSelector({
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
  })().catch((err) => {
    mainnetSelectorPromise = null;
    throw err;
  });
  return mainnetSelectorPromise;
}

export async function signWithBrowserWalletSelector(
  params: RealSignerWalletRequest,
): Promise<RealSignerWalletResult> {
  if (testDriverOverride) {
    const res = await testDriverOverride(params);
    return {
      accountId: assertAccountMatchesNetwork(res.accountId, params.network),
      publicKey: res.publicKey.trim(),
      signature: res.signature.trim(),
      ...(res.callbackUrl ? { callbackUrl: res.callbackUrl } : {}),
    };
  }
  if (params.moduleId === 'my-near-wallet' && params.network !== 'testnet') {
    throw new Error('MyNearWallet is only enabled for NEAR Testnet.');
  }
  const BufferCtor = ensureBrowserPolyfills();
  const selector = await createRealSignerWalletSelector(params.network);
  const wallet = await selector.wallet(params.moduleId);
  if (params.moduleId === 'okx-wallet' && !wallet.metadata.available) {
    throw new Error('OKX Wallet browser extension is not installed.');
  }
  if (wallet.type === 'hardware') {
    throw new Error('Hardware wallets are not supported in browser popup mode.');
  }
  if (params.moduleId !== 'near-mobile-wallet' && params.moduleId !== 'my-near-wallet') {
    const existing = await wallet.getAccounts().catch(() => []);
    if (!existing.length) await wallet.signIn({ contractId: '' });
  }
  if (typeof wallet.signMessage !== 'function') {
    throw new Error(`${wallet.metadata.name} does not support NEP-413 message signing.`);
  }
  const callbackUrl =
    typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://terraagent.fun/';
  const stateId = `signer-${params.nonceBase64.slice(0, 16)}`;
  const recoverFromPopup = (): RealSignerWalletResult | null => {
    if (params.moduleId !== 'my-near-wallet') return null;
    const recovered = consumeRecentNep413PopupResult(stateId);
    if (!recovered) return null;
    return {
      accountId: assertAccountMatchesNetwork(recovered.accountId, params.network),
      publicKey: recovered.publicKey.trim(),
      signature: recovered.signature.trim(),
      callbackUrl: recovered.callbackUrl ?? callbackUrl,
    };
  };
  if (params.moduleId === 'my-near-wallet') {
    savePendingNep413Redirect({ challengeId: stateId, callbackUrl, walletId: params.moduleId });
  }
  let signed: SignedMessage | void;
  try {
    signed = await wallet.signMessage({
      message: params.message,
      nonce: BufferCtor.from(params.nonceBytes),
      recipient: params.recipient,
      ...(params.moduleId === 'my-near-wallet' ? { callbackUrl, state: stateId } : {}),
    });
  } catch (err) {
    const recovered = recoverFromPopup();
    if (recovered) return recovered;
    throw err;
  }
  if (!signed || !signed.accountId || !signed.publicKey || !signed.signature) {
    const recovered = recoverFromPopup();
    if (recovered) return recovered;
    throw new Error('Wallet NEP-413 signature was cancelled.');
  }
  return {
    accountId: assertAccountMatchesNetwork(signed.accountId, params.network),
    publicKey: signed.publicKey.trim(),
    signature: signed.signature.trim(),
    ...(params.moduleId === 'my-near-wallet' ? { callbackUrl } : {}),
  };
}
