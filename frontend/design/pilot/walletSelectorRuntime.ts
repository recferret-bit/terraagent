import type { NearAuthChallengeResponse, NearAuthVerifyRequest } from '@terra/contracts';
import type { SignedMessage, Wallet, WalletSelector } from '@near-wallet-selector/core';
import type { Buffer as BufferPolyfill } from 'buffer';
import { consumeRecentNep413PopupResult, savePendingNep413Redirect } from './nearAuthApi';

export type WalletSelectorModuleId =
  | 'meteor-wallet'
  | 'okx-wallet'
  | 'near-mobile-wallet'
  | 'intear-wallet'
  | 'my-near-wallet';

export interface WalletSignProgress {
  onStep?: (stepText: string) => void;
  /** Account ID already verified in a prior step (enables 0-await synchronous retry on popup block). */
  preverifiedAccountId?: string;
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

export class WalletPopupBlockedError extends Error {
  constructor(
    readonly walletName: string,
    readonly connectedAccountId: string,
  ) {
    super(
      `Account ${connectedAccountId} connected in ${walletName}, but the browser blocked the NEP-413 signature popup. Click below to sign.`,
    );
    this.name = 'WalletPopupBlockedError';
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

const POPUP_BLOCKED_RE =
  /popup.*blocked|couldn['’]?t open popup|unable to open popup|popup window failed to open|popup.*refused|refused.*popup/i;
const REQUIRES_CONNECTED_ACCOUNT_RE =
  /no\s+(?:current\s+|active\s+)?account\s+(?:connected|selected|signed\s*in)|not\s+signed\s*in|not\s+logged\s*in|account\s*(?:id\s*)?(?:is\s+)?required|connect\s+(?:an?\s+|your\s+)?account/i;
const TESTNET_NAMED_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/;
const MAINNET_NAMED_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)+(near|tg|sweat)$/;
const METEOR_WEB_AUTH_KEYS = ['near_app_meteor_wallet_auth_key', 'default_meteor_wallet_auth_key'] as const;
const INTEAR_SESSION_KEY = '_intear_wallet_connected_account';

const selectorPromises = new Map<'testnet' | 'mainnet', Promise<WalletSelector>>();
const resolvedSelectors = new Map<'testnet' | 'mainnet', WalletSelector>();
const resolvedWallets = new Map<string, Wallet>();
let resolvedBufferCtor: typeof BufferPolyfill | null = null;
let testDriverOverride: WalletSelectorDriver | null = null;

/** Test seam allowing jsdom unit specs to exercise every wallet-selector flow deterministically. */
export function setWalletSelectorDriverForTests(driver: WalletSelectorDriver | null): void {
  testDriverOverride = driver;
}

export function isPopupBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return POPUP_BLOCKED_RE.test(msg);
}

export function requiresConnectedAccountError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const endTags = (err as { _reason?: { endTags?: unknown } })._reason?.endTags;
    if (Array.isArray(endTags) && endTags.includes('NO_ACCOUNTS')) return false;
  }
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return REQUIRES_CONNECTED_ACCOUNT_RE.test(msg);
}

export function isMeteorWebPopupMode(moduleId: string): boolean {
  return (
    moduleId === 'meteor-wallet' &&
    typeof window !== 'undefined' &&
    (window as { meteorCom?: unknown }).meteorCom == null
  );
}

export function getPrewarmedWallet(
  network: 'testnet' | 'mainnet',
  moduleId: WalletSelectorModuleId,
): Wallet | undefined {
  return resolvedWallets.get(`${network}:${moduleId}`);
}

export function warmSelectorWallets(network: 'testnet' | 'mainnet', selector: WalletSelector): void {
  let hasIntearSaved = false;
  try {
    hasIntearSaved = typeof localStorage !== 'undefined' && localStorage.getItem(INTEAR_SESSION_KEY) !== null;
  } catch { /* ignore storage errors */ }
  for (const mod of selector.store.getState().modules) {
    if (!mod.metadata.available) continue;
    void selector
      .wallet(mod.id)
      .then((wallet) => {
        resolvedWallets.set(`${network}:${mod.id}`, wallet);
        // Pre-settle Intear's cross-origin logout-bridge fetch so clicking Intear does not await network before window.open.
        if (mod.id === 'intear-wallet' && hasIntearSaved) {
          void wallet.getAccounts().catch(() => []);
        }
      })
      .catch(() => undefined);
  }
}

function clearStaleMeteorWebSession(network: 'testnet' | 'mainnet'): void {
  try {
    if (typeof localStorage !== 'undefined') {
      for (const k of METEOR_WEB_AUTH_KEYS) localStorage.removeItem(k);
    }
  } catch { /* ignore storage errors */ }
  resolvedWallets.delete(`${network}:meteor-wallet`);
  resolvedSelectors.delete(network);
  selectorPromises.delete(network);
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

export async function getNearWalletSelector(network: 'testnet' | 'mainnet' = 'testnet'): Promise<WalletSelector> {
  const ready = resolvedSelectors.get(network);
  if (ready) return ready;
  const cached = selectorPromises.get(network);
  if (cached) return cached;
  const promise = (async () => {
    const { ensureBrowserPolyfills } = await import('./browserPolyfills');
    resolvedBufferCtor = ensureBrowserPolyfills();
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
    const netCfg =
      network === 'mainnet'
        ? {
            networkId: 'mainnet',
            nodeUrl: 'https://free.rpc.fastnear.com',
            helperUrl: 'https://helper.mainnet.near.org',
            explorerUrl: 'https://nearblocks.io',
            indexerUrl: 'https://api.kitwallet.app',
          }
        : {
            networkId: 'testnet',
            nodeUrl: 'https://test.rpc.fastnear.com',
            helperUrl: 'https://helper.testnet.near.org',
            explorerUrl: 'https://testnet.nearblocks.io',
            indexerUrl: 'https://testnet-api.kitwallet.app',
          };
    const mnwUrl = network === 'mainnet' ? 'https://app.mynearwallet.com' : 'https://testnet.mynearwallet.com';
    const selector = await setupWalletSelector({
      network: netCfg,
      allowMultipleSelectors: true,
      modules: [
        setupMeteorWallet(),
        setupOKXWallet(),
        setupNearMobileWallet({
          dAppMetadata: { name: 'TerraAgent', logoUrl: `${origin}/favicon.svg`, url: origin },
        }),
        setupIntearWallet(),
        setupMyNearWallet({ walletUrl: mnwUrl }),
      ],
    });
    resolvedSelectors.set(network, selector);
    warmSelectorWallets(network, selector);
    return selector;
  })().catch((err) => {
    selectorPromises.delete(network);
    resolvedSelectors.delete(network);
    throw err;
  });
  selectorPromises.set(network, promise);
  return promise;
}

export async function getTestnetWalletSelector(): Promise<WalletSelector> {
  return getNearWalletSelector('testnet');
}

export function assertNetworkAccountId(accountId: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  const clean = accountId.trim().toLowerCase();
  if (!clean) {
    throw new Error('Wallet did not return a NEAR account ID.');
  }
  const isImplicit = /^[0-9a-f]{64}$/.test(clean);
  if (network === 'mainnet') {
    if (clean.endsWith('.testnet') || clean.endsWith('.mock')) {
      throw new Error('Testnet (.testnet) account detected. Switch your wallet network to NEAR Mainnet (.near) and try again.');
    }
    if (!isImplicit && clean !== 'aurora' && !MAINNET_NAMED_RE.test(clean)) {
      throw new Error(`Account "${clean}" is not a valid NEAR Mainnet account.`);
    }
    return clean;
  }
  if (clean.endsWith('.near') || clean === 'aurora' || MAINNET_NAMED_RE.test(clean)) {
    throw new Error('Mainnet (.near) account detected. Switch your wallet network to NEAR Testnet (.testnet) and try again.');
  }
  if (!isImplicit && !TESTNET_NAMED_RE.test(clean)) {
    throw new Error(`Account "${clean}" is not a NEAR Testnet account (.testnet).`);
  }
  return clean;
}

export async function verifyWalletAccountOrSignOut(
  wallet: Pick<Wallet, 'signOut'> & { readonly id?: string },
  accountId: string,
  network: 'testnet' | 'mainnet',
): Promise<string> {
  try {
    return assertNetworkAccountId(accountId, network);
  } catch (err) {
    await wallet.signOut().catch(() => undefined);
    if (wallet.id === 'meteor-wallet' && isMeteorWebPopupMode('meteor-wallet')) {
      clearStaleMeteorWebSession(network);
    }
    throw err;
  }
}

export async function ensureWalletConnected(
  wallet: Wallet,
  moduleId: WalletSelectorModuleId,
  network: 'testnet' | 'mainnet',
  progress?: WalletSignProgress,
): Promise<string | null> {
  // NEAR Mobile & MyNearWallet perform off-chain NEP-413 pairing/popup directly inside `signMessage` without gas-paid AddKey!
  if (moduleId === 'near-mobile-wallet' || moduleId === 'my-near-wallet') return null;

  if (moduleId === 'okx-wallet' && !wallet.metadata.available) {
    const downloadUrl =
      'downloadUrl' in wallet.metadata && typeof wallet.metadata.downloadUrl === 'string'
        ? wallet.metadata.downloadUrl
        : 'https://web3.okx.com/download';
    throw new WalletNotInstalledError('OKX Wallet', downloadUrl);
  }

  const existing = await wallet.getAccounts().catch(() => []);
  if (existing.length > 0 && existing[0]?.accountId) {
    return verifyWalletAccountOrSignOut(wallet, existing[0].accountId, network);
  }

  if (wallet.type === 'hardware') {
    throw new Error(`${wallet.metadata.name} hardware wallet requires account derivation.`);
  }
  const netLabel = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  progress?.onStep?.(`2/3 · Connect your ${netLabel} account in ${wallet.metadata.name}…`);
  // Empty `contractId` connects the wallet off-chain without broadcasting a gas-paid `AddKey` transaction.
  const signedIn = await wallet.signIn({ contractId: '' });
  if (!Array.isArray(signedIn) || !signedIn.length || !signedIn[0]?.accountId) {
    throw new Error(`${wallet.metadata.name} connection was cancelled.`);
  }
  return verifyWalletAccountOrSignOut(wallet, signedIn[0].accountId, network);
}

async function resolveConnectedAccountForPopupBlock(
  wallet: Wallet,
  fallbackAccountId: string | null,
  network: 'testnet' | 'mainnet',
): Promise<string | null> {
  const accounts = await wallet.getAccounts().catch(() => []);
  const raw = accounts[0]?.accountId || fallbackAccountId;
  if (!raw) return null;
  return verifyWalletAccountOrSignOut(wallet, raw, network);
}

async function finalizeSignedNep413Payload(
  wallet: Wallet,
  moduleId: WalletSelectorModuleId,
  challenge: NearAuthChallengeResponse,
  callbackUrl: string,
  network: 'testnet' | 'mainnet',
  signed: SignedMessage | void,
): Promise<NearAuthVerifyRequest> {
  if (!signed || !signed.accountId || !signed.publicKey || !signed.signature) {
    if (moduleId === 'my-near-wallet') {
      const recovered = consumeRecentNep413PopupResult(challenge.challengeId);
      if (recovered) {
        return { ...recovered, accountId: assertNetworkAccountId(recovered.accountId, network) };
      }
    }
    throw new Error('Signature confirmation was cancelled or incomplete.');
  }
  const verifiedAccountId = await verifyWalletAccountOrSignOut(wallet, signed.accountId, network);
  return {
    challengeId: challenge.challengeId,
    accountId: verifiedAccountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
    ...(moduleId === 'my-near-wallet' ? { callbackUrl } : {}),
    walletId: moduleId,
  };
}

/** Signs a NEP-413 challenge on an already-resolved `@near-wallet-selector` `Wallet` instance. */
export async function signWithSelectorWallet(
  wallet: Wallet,
  moduleId: WalletSelectorModuleId,
  challenge: NearAuthChallengeResponse,
  callbackUrl: string,
  BufferCtor: typeof BufferPolyfill,
  progress?: WalletSignProgress,
): Promise<NearAuthVerifyRequest> {
  if (typeof wallet.signMessage !== 'function') {
    throw new Error(`${wallet.metadata.name} does not support NEP-413 message signing.`);
  }
  const network = challenge.network === 'mainnet' ? 'mainnet' : 'testnet';
  const netLabel = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  const signParams = {
    message: challenge.message,
    nonce: BufferCtor.from(base64ToBytes(challenge.nonce)),
    recipient: challenge.recipient,
    ...(moduleId === 'my-near-wallet' ? { callbackUrl } : {}),
    state: challenge.challengeId,
  };

  let connectedAccountId: string | null = progress?.preverifiedAccountId
    ? assertNetworkAccountId(progress.preverifiedAccountId, network)
    : null;
  let signed: SignedMessage | void = undefined;
  let needStandardSign = true;

  if (!connectedAccountId && isMeteorWebPopupMode(moduleId)) {
    const existing = await wallet.getAccounts().catch(() => []);
    if (existing.length > 0 && existing[0]?.accountId) {
      connectedAccountId = await verifyWalletAccountOrSignOut(wallet, existing[0].accountId, network);
    } else {
      progress?.onStep?.(`2/3 · Confirm the NEP-413 sign-in message in ${wallet.metadata.name}…`);
      try {
        signed = await wallet.signMessage(signParams);
        needStandardSign = false;
      } catch (directErr) {
        if (!requiresConnectedAccountError(directErr)) throw directErr;
      }
    }
  }

  if (needStandardSign) {
    if (!connectedAccountId && moduleId !== 'near-mobile-wallet' && moduleId !== 'my-near-wallet') {
      connectedAccountId = await ensureWalletConnected(wallet, moduleId, network, progress);
    }
    if (moduleId === 'my-near-wallet') {
      savePendingNep413Redirect({
        challengeId: challenge.challengeId,
        callbackUrl,
        walletId: moduleId,
        expiresAt: challenge.expiresAt,
      });
    }
    progress?.onStep?.(
      moduleId === 'near-mobile-wallet'
        ? `2/3 · Scan the QR code (or tap Open App) in NEAR Mobile (${netLabel}) and approve the signature…`
        : `3/3 · Confirm the NEP-413 sign-in message in ${wallet.metadata.name}…`,
    );
    try {
      signed = await wallet.signMessage(signParams);
    } catch (err) {
      if (moduleId === 'my-near-wallet') {
        const recovered = consumeRecentNep413PopupResult(challenge.challengeId);
        if (recovered) {
          return { ...recovered, accountId: assertNetworkAccountId(recovered.accountId, network) };
        }
      }
      if (isPopupBlockedError(err)) {
        const acct = await resolveConnectedAccountForPopupBlock(wallet, connectedAccountId, network);
        if (acct) throw new WalletPopupBlockedError(wallet.metadata.name, acct);
      }
      throw err;
    }
  }

  return finalizeSignedNep413Payload(wallet, moduleId, challenge, callbackUrl, network, signed);
}

async function resolveAndSignWalletMessage(
  moduleId: WalletSelectorModuleId,
  challenge: NearAuthChallengeResponse,
  callbackUrl: string,
  progress?: WalletSignProgress,
): Promise<NearAuthVerifyRequest> {
  const network = challenge.network === 'mainnet' ? 'mainnet' : 'testnet';
  let BufferCtor = resolvedBufferCtor;
  let selector = resolvedSelectors.get(network);
  if (!BufferCtor || !selector) {
    const { ensureBrowserPolyfills } = await import('./browserPolyfills');
    BufferCtor = ensureBrowserPolyfills();
    resolvedBufferCtor = BufferCtor;
    selector = await getNearWalletSelector(network);
  }
  let wallet: Wallet;
  try {
    wallet = await selector.wallet(moduleId);
    resolvedWallets.set(`${network}:${moduleId}`, wallet);
  } catch {
    if (moduleId === 'okx-wallet') {
      throw new WalletNotInstalledError('OKX Wallet', 'https://web3.okx.com/download');
    }
    throw new Error(`Selected wallet (${moduleId}) is not supported in this browser.`);
  }
  return signWithSelectorWallet(wallet, moduleId, challenge, callbackUrl, BufferCtor, progress);
}

/** Connects the selected `@near-wallet-selector` wallet and signs the server NEP-413 challenge (`testnet` or `mainnet`). */
export function signChallengeWithNearWallet(
  moduleId: WalletSelectorModuleId,
  challenge: NearAuthChallengeResponse,
  callbackUrl: string,
  progress?: WalletSignProgress,
): Promise<NearAuthVerifyRequest> {
  if (testDriverOverride) {
    return testDriverOverride.signChallenge(moduleId, challenge, callbackUrl, progress);
  }
  const network = challenge.network === 'mainnet' ? 'mainnet' : 'testnet';
  const prewarmedWallet = resolvedWallets.get(`${network}:${moduleId}`);
  if (resolvedBufferCtor && prewarmedWallet) {
    return signWithSelectorWallet(prewarmedWallet, moduleId, challenge, callbackUrl, resolvedBufferCtor, progress);
  }
  return resolveAndSignWalletMessage(moduleId, challenge, callbackUrl, progress);
}

/** Signs out any active `@near-wallet-selector` wallet session on user logout. */
export async function signOutNearWalletSelector(): Promise<void> {
  if (testDriverOverride) {
    await testDriverOverride.signOutActiveWallet();
    return;
  }
  for (const pending of selectorPromises.values()) {
    try {
      const selector = await pending;
      if (selector.isSignedIn()) {
        const wallet = await selector.wallet();
        await wallet.signOut();
      }
    } catch {
      /* ignore wallet sign-out cleanup errors */
    }
  }
}
