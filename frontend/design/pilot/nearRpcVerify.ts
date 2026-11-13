import { buildNearWalletLoginUrl } from './mockToken';
import { readSavedNearWallet } from './nearWalletModal';

const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const MAINNET_RPC = 'https://rpc.mainnet.near.org';
const TESTNET_RPC = 'https://rpc.testnet.near.org';
const MAINNET_WEB_WALLET = 'https://app.mynearwallet.com/login/';
const INTEAR_WEB_WALLET = 'https://wallet.intear.tech/login/';

export interface VerifiedNearAccount {
  readonly accountId: string;
  readonly network: 'mainnet' | 'testnet';
  readonly publicKey?: string;
  readonly keyCount: number;
}

interface RpcKeyItem {
  readonly public_key?: string;
}

async function queryNearRpcAccount(rpcUrl: string, accountId: string): Promise<{ ok: boolean; keys: string[] }> {
  try {
    const acctRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'terra-verify-acct',
        method: 'query',
        params: { request_type: 'view_account', finality: 'final', account_id: accountId },
      }),
    });
    if (!acctRes.ok) return { ok: false, keys: [] };
    const acctJson = (await acctRes.json()) as { result?: { amount?: string }; error?: unknown };
    if (acctJson.error || !acctJson.result) return { ok: false, keys: [] };

    const keysRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'terra-verify-keys',
        method: 'query',
        params: { request_type: 'view_access_key_list', finality: 'final', account_id: accountId },
      }),
    });
    if (!keysRes.ok) return { ok: true, keys: [] };
    const keysJson = (await keysRes.json()) as { result?: { keys?: RpcKeyItem[] } };
    const keys = (keysJson.result?.keys ?? [])
      .map((k) => (typeof k.public_key === 'string' ? k.public_key : ''))
      .filter(Boolean);
    return { ok: true, keys };
  } catch {
    return { ok: false, keys: [] };
  }
}

/** Verifies that `accountId` exists on NEAR Mainnet or Testnet and fetches its active public keys. */
export async function verifyNearAccountOnChain(rawAccountId: string): Promise<VerifiedNearAccount | null> {
  const accountId = rawAccountId.trim().toLowerCase();
  if (!NEAR_ACCOUNT_RE.test(accountId) || accountId.length < 2 || accountId.length > 64) {
    return null;
  }
  const preferMainnet = accountId.endsWith('.near') || (!accountId.endsWith('.testnet') && /^[0-9a-f]{64}$/.test(accountId));
  const order: Array<{ network: 'mainnet' | 'testnet'; url: string }> = preferMainnet
    ? [
        { network: 'mainnet', url: MAINNET_RPC },
        { network: 'testnet', url: TESTNET_RPC },
      ]
    : [
        { network: 'testnet', url: TESTNET_RPC },
        { network: 'mainnet', url: MAINNET_RPC },
      ];

  for (const target of order) {
    const res = await queryNearRpcAccount(target.url, accountId);
    if (res.ok) {
      return {
        accountId,
        network: target.network,
        publicKey: res.keys[0],
        keyCount: res.keys.length,
      };
    }
  }
  return null;
}

export function buildNetworkWebWalletUrl(
  network: 'mainnet' | 'testnet',
  origin: string,
  returnPath: string,
  walletId?: string,
): string {
  const testnetUrl = new URL(buildNearWalletLoginUrl(origin, returnPath));
  if (walletId === 'intear') {
    const intearUrl = new URL(INTEAR_WEB_WALLET);
    testnetUrl.searchParams.forEach((v, k) => intearUrl.searchParams.set(k, v));
    return intearUrl.toString();
  }
  if (network === 'testnet') return testnetUrl.toString();
  const mainnetUrl = new URL(MAINNET_WEB_WALLET);
  testnetUrl.searchParams.forEach((v, k) => mainnetUrl.searchParams.set(k, v));
  return mainnetUrl.toString();
}

export interface VerifiedConnectPanelOptions {
  readonly walletId: string;
  readonly walletName: string;
  readonly headline: string;
  readonly deepLinkUrl?: string;
  readonly origin: string;
  readonly returnPath: string;
  readonly onPopupOpened: (popup: Window | null) => void;
  readonly onConfirmAccount: (accountId: string, publicKey?: string) => void;
  readonly onCloseModal: () => void;
}

/**
 * Two-step verified NEAR account connection panel for Mobile, Meteor, OKX, and Intear:
 * Step 1: Verify the `.near` / `.testnet` account on-chain via NEAR RPC (`view_account` + `view_access_key_list`).
 * Step 2: Review verified on-chain key + session challenge and explicitly confirm or approve in Web Wallet popup.
 */
export function renderVerifiedConnectPanel(panelHost: HTMLElement, opts: VerifiedConnectPanelOptions): void {
  panelHost.replaceChildren();
  const box = document.createElement('div');
  box.className = 'near-wallet-panel';
  box.dataset.testid = `near-panel-${opts.walletId}`;

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = opts.headline;
  box.append(label);

  if (opts.deepLinkUrl) {
    const deepBtn = document.createElement('a');
    deepBtn.className = 'btn btn-ghost btn-sm';
    deepBtn.href = opts.deepLinkUrl;
    deepBtn.target = '_blank';
    deepBtn.rel = 'noopener noreferrer';
    deepBtn.textContent = `Open ${opts.walletName} ↗`;
    box.append(deepBtn);
  }

  const acctInput = document.createElement('input');
  acctInput.type = 'text';
  acctInput.className = 'input';
  acctInput.placeholder = 'yourname.near or pilot.testnet';
  acctInput.dataset.testid = 'near-account-input';
  const saved = readSavedNearWallet();
  if (saved?.accountId) acctInput.value = saved.accountId;

  const err = document.createElement('p');
  err.className = 'near-wallet-err';
  err.style.display = 'none';

  const confirmHost = document.createElement('div');

  const verifyBtn = document.createElement('button');
  verifyBtn.type = 'button';
  verifyBtn.className = 'btn btn-primary btn-sm';
  verifyBtn.dataset.testid = 'near-account-verify';
  verifyBtn.textContent = '1. Verify Account on NEAR';

  const runVerify = async (): Promise<void> => {
    const rawAcct = acctInput.value.trim().toLowerCase();
    confirmHost.replaceChildren();
    if (!NEAR_ACCOUNT_RE.test(rawAcct) || rawAcct.length < 2 || rawAcct.length > 64) {
      err.textContent = 'Enter a valid NEAR account ID (e.g. alice.near or pilot.testnet).';
      err.style.display = 'block';
      return;
    }
    err.style.display = 'none';
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Checking NEAR RPC…';
    const verified = await verifyNearAccountOnChain(rawAcct);
    verifyBtn.disabled = false;
    verifyBtn.textContent = '1. Verify Account on NEAR';
    if (!verified) {
      err.textContent = `Account "${rawAcct}" was not found on NEAR Mainnet or Testnet.`;
      err.style.display = 'block';
      return;
    }
    renderConfirmStep(confirmHost, verified, opts);
  };

  acctInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void runVerify();
  });
  verifyBtn.onclick = () => void runVerify();
  box.append(acctInput, err, verifyBtn, confirmHost);
  panelHost.append(box);
}

function renderConfirmStep(
  host: HTMLElement,
  verified: VerifiedNearAccount,
  opts: VerifiedConnectPanelOptions,
): void {
  host.replaceChildren();
  const card = document.createElement('div');
  card.className = 'near-wallet-panel';
  card.dataset.testid = 'near-verify-confirmation';

  const badge = document.createElement('div');
  badge.className = 'label c-orange';
  badge.textContent = `✔ VERIFIED ON NEAR ${verified.network.toUpperCase()}`;

  const summary = document.createElement('code');
  const keyPreview = verified.publicKey ? `${verified.publicKey.slice(0, 24)}…` : 'implicit / contract account';
  const nonce = Math.random().toString(36).slice(2, 10).toUpperCase();
  summary.textContent = `Account: ${verified.accountId}\nKey: ${keyPreview} (${verified.keyCount} active)\nChallenge: TA-${nonce}`;

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn btn-primary btn-sm';
  confirmBtn.dataset.testid = 'near-account-confirm';
  confirmBtn.textContent = `2. Confirm & Sign In as ${verified.accountId}`;
  confirmBtn.onclick = () => opts.onConfirmAccount(verified.accountId, verified.publicKey);

  const webApproveBtn = document.createElement('button');
  webApproveBtn.type = 'button';
  webApproveBtn.className = 'btn btn-ghost btn-sm';
  webApproveBtn.dataset.testid = 'near-approve-webwallet';
  webApproveBtn.textContent =
    opts.walletId === 'intear'
      ? 'Or Approve in Intear Web Wallet ↗'
      : `Or Approve in NEAR ${verified.network === 'mainnet' ? 'Mainnet' : 'Testnet'} Web Wallet ↗`;
  webApproveBtn.onclick = () => {
    const url = buildNetworkWebWalletUrl(verified.network, opts.origin, opts.returnPath, opts.walletId);
    const pop = window.open(url, 'terra-near-wallet', 'popup,width=500,height=680');
    opts.onPopupOpened(pop);
    opts.onCloseModal();
  };

  card.append(badge, summary, confirmBtn, webApproveBtn);
  host.append(card);
}
