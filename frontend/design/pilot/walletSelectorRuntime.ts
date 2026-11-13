import type { NearAuthChallengeResponse, NearAuthVerifyRequest } from '@terra/contracts';
import type { SignedMessage, Wallet, WalletSelector } from '@near-wallet-selector/core';
import { consumeRecentNep413PopupResult, savePendingNep413Redirect } from './nearAuthApi';

export type WalletSelectorModuleId =
  | 'meteor-wallet'
  | 'okx-wallet'
  | 'near-mobile-wallet'
  | 'intear-wallet'
  | 'my-near-wallet';

export interface WalletSignProgress {
  onStep?: (stepText: string) => void;
}

export class WalletNotInstalledError extends Error {
  constructor(
    readonly walletName: string,
    readonly downloadUrl: string,
  ) {
    super(`${walletName} browser extension is not installed.`);
    this.name = 'WalletNotInstalledError';
  }
}

export interface WalletSelectorDriver {
  signChallenge(
    moduleId: WalletSelectorModuleId,
    challenge: NearAuthChallengeResponse,
    callbackUrl: string,
    progress?: WalletSignProgress,
  ): Promise<NearAuthVerifyRequest>;
  signOutActiveWallet(): Promise<void>;
}

let selectorPromise: Promise<WalletSelector> | null = null;
let testDriverOverride: WalletSelectorDriver | null = null;

/** Test seam allowing jsdom unit specs to exercise every wallet-selector flow deterministically. */
export function setWalletSelectorDriverForTests(driver: WalletSelectorDriver | null): void {
  testDriverOverride = driver;
}

function base64ToBytes(base64Str: string): Uint8Array {
  const std = base64Str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  const bin = atob(std + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function getTestnetWalletSelector(): Promise<WalletSelector> {
  if (selectorPromise) return selectorPromise;
  selectorPromise = (async () => {
    const { ensureBrowserPolyfills } = await import('./browserPolyfills');
    ensureBrowserPolyfills();
    const [
      { setupWalletSelector },
      { setupMeteorWallet },
      { setupOKXWallet },
      { setupNearMobileWallet },
      { setupIntearWallet },
      { setupMyNearWallet },
    ] = await Promise.all([
      import('@near-wallet-selector/core'),
      import('@near-wallet-selector/meteor-wallet'),
      import('@near-wallet-selector/okx-wallet'),
      import('@near-wallet-selector/near-mobile-wallet'),
      import('@near-wallet-selector/intear-wallet'),
      import('@near-wallet-selector/my-near-wallet'),
    ]);
    const origin = typeof location !== 'undefined' ? location.origin : 'https://terraagent.fun';
    return setupWalletSelector({
      network: {
        networkId: 'testnet',
        nodeUrl: 'https://test.rpc.fastnear.com',
        helperUrl: 'https://helper.testnet.near.org',
        explorerUrl: 'https://testnet.nearblocks.io',
        indexerUrl: 'https://testnet-api.kitwallet.app',
      },
      modules: [
        setupMeteorWallet(),
        setupOKXWallet(),
        setupNearMobileWallet({
          dAppMetadata: {
            name: 'TerraAgent',
            logoUrl: `${origin}/favicon.svg`,
            url: origin,
          },
        }),
        setupIntearWallet(),
        setupMyNearWallet({ walletUrl: 'https://testnet.mynearwallet.com' }),
      ],
    });
  })().catch((err) => {
    selectorPromise = null;
    throw err;
  });
  return selectorPromise;
}

function assertTestnetAccountId(accountId: string): string {
  const clean = accountId.trim().toLowerCase();
  if (!clean) {
    throw new Error('Wallet did not return a NEAR account ID.');
  }
  if (clean.endsWith('.near')) {
    throw new Error('Mainnet (.near) account detected. Switch your wallet network to NEAR Testnet (.testnet) and try again.');
  }
  if (!clean.endsWith('.testnet') && !/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`Account "${clean}" is not a NEAR Testnet account (.testnet).`);
  }
  return clean;
}

async function ensureWalletConnected(
  wallet: Wallet,
  moduleId: WalletSelectorModuleId,
  progress?: WalletSignProgress,
): Promise<void> {
  // NEAR Mobile & MyNearWallet perform off-chain NEP-413 pairing/popup directly inside `signMessage` without gas-paid AddKey!
  if (moduleId === 'near-mobile-wallet' || moduleId === 'my-near-wallet') return;

  if (moduleId === 'okx-wallet' && !wallet.metadata.available) {
    const downloadUrl =
      'downloadUrl' in wallet.metadata && typeof wallet.metadata.downloadUrl === 'string'
        ? wallet.metadata.downloadUrl
        : 'https://web3.okx.com/download';
    throw new WalletNotInstalledError('OKX Wallet', downloadUrl);
  }

  const existing = await wallet.getAccounts().catch(() => []);
  if (existing.length > 0 && existing[0]?.accountId) return;

  if (wallet.type === 'hardware') {
    throw new Error(`${wallet.metadata.name} hardware wallet requires account derivation.`);
  }
  progress?.onStep?.(`2/3 · Connect your Testnet account in ${wallet.metadata.name}…`);
  // Empty `contractId` connects the wallet off-chain without broadcasting a gas-paid `AddKey` transaction.
  const signedIn = await wallet.signIn({ contractId: '' });
  if (!Array.isArray(signedIn) || !signedIn.length || !signedIn[0]?.accountId) {
    throw new Error(`${wallet.metadata.name} connection was cancelled.`);
  }
}

async function executeWalletSignMessage(
  moduleId: WalletSelectorModuleId,
  challenge: NearAuthChallengeResponse,
  callbackUrl: string,
  progress?: WalletSignProgress,
): Promise<NearAuthVerifyRequest> {
  const { ensureBrowserPolyfills } = await import('./browserPolyfills');
  const BufferCtor = ensureBrowserPolyfills();
  const selector = await getTestnetWalletSelector();
  let wallet: Wallet;
  try {
    wallet = await selector.wallet(moduleId);
  } catch {
    if (moduleId === 'okx-wallet') {
      throw new WalletNotInstalledError('OKX Wallet', 'https://web3.okx.com/download');
    }
    throw new Error(`Selected wallet (${moduleId}) is not supported in this browser.`);
  }

  await ensureWalletConnected(wallet, moduleId, progress);

  if (typeof wallet.signMessage !== 'function') {
    throw new Error(`${wallet.metadata.name} does not support NEP-413 message signing.`);
  }

  if (moduleId === 'my-near-wallet') {
    savePendingNep413Redirect({
      challengeId: challenge.challengeId,
      callbackUrl,
      walletId: moduleId,
      expiresAt: challenge.expiresAt,
    });
  }

  const promptHint =
    moduleId === 'near-mobile-wallet'
      ? '2/3 · Scan the QR code (or tap Open App) in NEAR Mobile (Testnet) and approve the signature…'
      : `3/3 · Confirm the NEP-413 sign-in message in ${wallet.metadata.name}…`;
  progress?.onStep?.(promptHint);

  const nonceBuffer = BufferCtor.from(base64ToBytes(challenge.nonce));
  let signed: SignedMessage | void;
  try {
    signed = await wallet.signMessage({
      message: challenge.message,
      nonce: nonceBuffer,
      recipient: challenge.recipient,
      ...(moduleId === 'my-near-wallet' ? { callbackUrl } : {}),
      state: challenge.challengeId,
    });
  } catch (err) {
    if (moduleId === 'my-near-wallet') {
      const recovered = consumeRecentNep413PopupResult(challenge.challengeId);
      if (recovered) {
        return { ...recovered, accountId: assertTestnetAccountId(recovered.accountId) };
      }
    }
    throw err;
  }

  if (!signed || !signed.accountId || !signed.publicKey || !signed.signature) {
    if (moduleId === 'my-near-wallet') {
      const recovered = consumeRecentNep413PopupResult(challenge.challengeId);
      if (recovered) {
        return { ...recovered, accountId: assertTestnetAccountId(recovered.accountId) };
      }
    }
    throw new Error('Signature confirmation was cancelled or incomplete.');
  }

  const verifiedAccountId = assertTestnetAccountId(signed.accountId);
  return {
    challengeId: challenge.challengeId,
    accountId: verifiedAccountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
    ...(moduleId === 'my-near-wallet' ? { callbackUrl } : {}),
    walletId: moduleId,
  };
}

/** Connects the selected `@near-wallet-selector` Testnet wallet and signs the server NEP-413 challenge. */
export async function signChallengeWithNearWallet(
  moduleId: WalletSelectorModuleId,
  challenge: NearAuthChallengeResponse,
  callbackUrl: string,
  progress?: WalletSignProgress,
): Promise<NearAuthVerifyRequest> {
  if (testDriverOverride) {
    return testDriverOverride.signChallenge(moduleId, challenge, callbackUrl, progress);
  }
  return executeWalletSignMessage(moduleId, challenge, callbackUrl, progress);
}

/** Signs out any active `@near-wallet-selector` wallet session on user logout. */
export async function signOutNearWalletSelector(): Promise<void> {
  if (testDriverOverride) {
    await testDriverOverride.signOutActiveWallet();
    return;
  }
  if (!selectorPromise) return;
  try {
    const selector = await selectorPromise;
    if (selector.isSignedIn()) {
      const wallet = await selector.wallet();
      await wallet.signOut();
    }
  } catch {
    /* ignore wallet sign-out cleanup errors */
  }
}
