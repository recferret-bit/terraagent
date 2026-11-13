import { ensureBrowserPolyfills } from '../../../design/pilot/browserPolyfills';
import type { Nep413Signature } from '@terra/contracts';
import type { OpenSignerModalHandle, SignerModalOutcome, SignerModalRequest } from './signerModal';
import './signerModal.css';

export type RealNearNetwork = 'testnet' | 'mainnet';

interface SavedWalletHint {
  readonly walletId?: string;
  readonly accountId?: string;
  readonly publicKey?: string;
}

function generateBase64Nonce32(): { base64: string; bytes: Uint8Array } {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return { base64: btoa(bin), bytes };
}

function readSavedWalletHint(): SavedWalletHint {
  try {
    const raw = localStorage.getItem('ta_near_wallet');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedWalletHint;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function buildCliCommand(req: SignerModalRequest, nonceBase64: string, network: RealNearNetwork, acctHint: string): string {
  const singleQuotedMsg = `'${req.message.replace(/'/g, "'\\''")}'`;
  const acct = acctHint || (network === 'mainnet' ? '<pilot>.near' : '<pilot>.testnet');
  return [
    `near message sign-nep413 utf8 ${singleQuotedMsg}`,
    `  nonce "${nonceBase64}"`,
    `  recipient "${req.recipient}"`,
    `  sign-as ${acct}`,
    `  sign-with-keychain network-config ${network}`,
  ].join(' \\\n');
}

async function signWithBrowserWalletSelector(params: {
  readonly network: RealNearNetwork;
  readonly moduleId: 'meteor-wallet' | 'okx-wallet' | 'intear-wallet';
  readonly message: string;
  readonly nonceBytes: Uint8Array;
  readonly recipient: string;
}): Promise<{ accountId: string; publicKey: string; signature: string }> {
  const [
    { setupWalletSelector },
    { setupMeteorWallet },
    { setupOKXWallet },
    { setupIntearWallet },
  ] = await Promise.all([
    import('@near-wallet-selector/core'),
    import('@near-wallet-selector/meteor-wallet'),
    import('@near-wallet-selector/okx-wallet'),
    import('@near-wallet-selector/intear-wallet'),
  ]);
  const isMainnet = params.network === 'mainnet';
  const selector = await setupWalletSelector({
    network: {
      networkId: params.network,
      nodeUrl: isMainnet ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com',
      helperUrl: isMainnet ? 'https://helper.mainnet.near.org' : 'https://helper.testnet.near.org',
      explorerUrl: isMainnet ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io',
      indexerUrl: isMainnet ? 'https://api.kitwallet.app' : 'https://testnet-api.kitwallet.app',
    },
    modules: [setupMeteorWallet(), setupOKXWallet(), setupIntearWallet()],
  });
  const BufferCtor = ensureBrowserPolyfills();
  const wallet = await selector.wallet(params.moduleId);
  if (wallet.type === 'hardware') {
    throw new Error('Hardware wallets are not supported in browser popup mode.');
  }
  const existing = await wallet.getAccounts().catch(() => []);
  if (!existing.length) {
    await wallet.signIn({ contractId: '' });
  }
  if (typeof wallet.signMessage !== 'function') {
    throw new Error(`${wallet.metadata.name} does not support NEP-413 message signing.`);
  }
  const signed = await wallet.signMessage({
    message: params.message,
    nonce: BufferCtor.from(params.nonceBytes),
    recipient: params.recipient,
  });
  if (!signed || !signed.accountId || !signed.publicKey || !signed.signature) {
    throw new Error('Wallet NEP-413 signature was cancelled.');
  }
  return {
    accountId: signed.accountId.trim().toLowerCase(),
    publicKey: signed.publicKey.trim(),
    signature: signed.signature.trim(),
  };
}

function buildInputField(placeholder: string, testId: string, initialValue = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = placeholder;
  input.dataset.testid = testId;
  input.value = initialValue;
  return input;
}

interface RealSignerDom {
  readonly root: HTMLDivElement;
  readonly meteorBtn: HTMLButtonElement;
  readonly okxBtn: HTMLButtonElement;
  readonly intearBtn: HTMLButtonElement;
  readonly cliCode: HTMLElement;
  readonly acctInput: HTMLInputElement;
  readonly pubKeyInput: HTMLInputElement;
  readonly sigInput: HTMLInputElement;
  readonly statusEl: HTMLDivElement;
  readonly rejectBtn: HTMLButtonElement;
  readonly approveBtn: HTMLButtonElement;
}

function buildWalletBtn(label: string, testId: string, primary = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = primary ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  btn.dataset.testid = testId;
  btn.textContent = label;
  return btn;
}

function buildRealSignerDom(
  req: SignerModalRequest & { readonly network: RealNearNetwork },
  nonceBase64: string,
  defaultAcct: string,
  savedPubKey: string,
): RealSignerDom {
  const root = document.createElement('div');
  root.className = 'ta-signer-overlay';
  root.dataset.testid = 'real-wallet-signer-modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'ta-signer-modal plate';

  const title = document.createElement('h2');
  title.className = 'ta-signer-modal__title';
  title.textContent = req.title ?? `NEAR WALLET SIGNER (${req.network.toUpperCase()})`;

  const summary = document.createElement('div');
  summary.className = 'ta-signer-modal__summary';
  summary.dataset.testid = 'signer-action-summary';
  summary.textContent = req.actionSummary;

  const walletRow = document.createElement('div');
  walletRow.className = 'ta-signer-modal__actions';
  const meteorBtn = buildWalletBtn('Sign with Meteor', 'real-signer-meteor', true);
  const okxBtn = buildWalletBtn('OKX', 'real-signer-okx');
  const intearBtn = buildWalletBtn('Intear', 'real-signer-intear');
  walletRow.append(meteorBtn, okxBtn, intearBtn);

  const cliCode = document.createElement('code');
  cliCode.className = 'ta-signer-modal__field-value';
  cliCode.dataset.testid = 'real-signer-cli-cmd';
  cliCode.textContent = buildCliCommand(req, nonceBase64, req.network, defaultAcct);

  const acctInput = buildInputField(
    req.network === 'mainnet' ? 'pilot.near' : 'pilot.testnet',
    'real-signer-account',
    defaultAcct,
  );
  const pubKeyInput = buildInputField('FullAccess public key (ed25519:...)', 'real-signer-pubkey', savedPubKey);
  const sigInput = buildInputField('NEP-413 signature (ed25519:... or base64)', 'real-signer-signature');

  const statusEl = document.createElement('div');
  statusEl.className = 'ta-signer-modal__status';
  statusEl.dataset.testid = 'signer-status';

  const actions = document.createElement('div');
  actions.className = 'ta-signer-modal__actions';
  const rejectBtn = buildWalletBtn('Cancel', 'signer-reject-btn');
  const approveBtn = buildWalletBtn('Submit CLI Signature', 'signer-approve-btn', true);
  actions.append(rejectBtn, approveBtn);

  card.append(title, summary, walletRow, cliCode, acctInput, pubKeyInput, sigInput, statusEl, actions);
  root.appendChild(card);
  return {
    root,
    meteorBtn,
    okxBtn,
    intearBtn,
    cliCode,
    acctInput,
    pubKeyInput,
    sigInput,
    statusEl,
    rejectBtn,
    approveBtn,
  };
}

/**
 * Network-aware (`testnet` & `mainnet`) NEP-413 wallet signer modal for real self-custody claiming & staking.
 * Uses Faction Plate CSS tokens and `createElement` + `textContent` only (zero `innerHTML`).
 */
export function openRealNearSignerModal(
  req: SignerModalRequest & { readonly network: RealNearNetwork },
): OpenSignerModalHandle {
  const { base64: nonceBase64, bytes: nonceBytes } = generateBase64Nonce32();
  const saved = readSavedWalletHint();
  const container = req.container ?? document.body;
  const defaultAcct =
    saved.accountId && !saved.accountId.endsWith('.mock')
      ? saved.accountId
      : req.accountId.endsWith('.mock')
        ? ''
        : req.accountId;

  const dom = buildRealSignerDom(req, nonceBase64, defaultAcct, saved.publicKey ?? '');
  container.appendChild(dom.root);

  let settled = false;
  let resolveOutcome!: (val: SignerModalOutcome) => void;
  const promise = new Promise<SignerModalOutcome>((res) => {
    resolveOutcome = res;
  });

  const finishApproved = (sig: Nep413Signature): void => {
    if (settled) return;
    settled = true;
    dom.root.remove();
    resolveOutcome({ status: 'approved', signature: sig });
  };

  const reject = (): void => {
    if (settled) return;
    settled = true;
    dom.root.remove();
    resolveOutcome({ status: 'rejected', reason: 'Cancelled in wallet' });
  };

  const approve = (): void => {
    const accountId = dom.acctInput.value.trim().toLowerCase();
    const publicKey = dom.pubKeyInput.value.trim();
    const signature = dom.sigInput.value.trim();
    if (!accountId || !publicKey || !signature) {
      dom.statusEl.textContent = 'Enter account ID, FullAccess public key, and NEP-413 signature (or click a wallet above).';
      return;
    }
    finishApproved({
      accountId,
      publicKey,
      signature,
      message: req.message,
      nonce: nonceBase64,
      recipient: req.recipient,
    });
  };

  const triggerWallet = (moduleId: 'meteor-wallet' | 'okx-wallet' | 'intear-wallet'): void => {
    dom.statusEl.textContent = 'Waiting for wallet NEP-413 signature…';
    dom.root.style.display = 'none';
    void signWithBrowserWalletSelector({
      network: req.network,
      moduleId,
      message: req.message,
      nonceBytes,
      recipient: req.recipient,
    })
      .then((res) => {
        finishApproved({
          accountId: res.accountId,
          publicKey: res.publicKey,
          signature: res.signature,
          message: req.message,
          nonce: nonceBase64,
          recipient: req.recipient,
        });
      })
      .catch((err: unknown) => {
        dom.root.style.display = '';
        dom.statusEl.textContent = err instanceof Error ? err.message : 'Wallet signing failed.';
      });
  };

  dom.acctInput.addEventListener('input', () => {
    dom.cliCode.textContent = buildCliCommand(req, nonceBase64, req.network, dom.acctInput.value.trim().toLowerCase());
  });
  dom.meteorBtn.onclick = () => triggerWallet('meteor-wallet');
  dom.okxBtn.onclick = () => triggerWallet('okx-wallet');
  dom.intearBtn.onclick = () => triggerWallet('intear-wallet');
  dom.approveBtn.onclick = approve;
  dom.rejectBtn.onclick = reject;
  dom.root.onclick = (e) => {
    if (e.target === dom.root) reject();
  };

  return { promise, approve, reject, close: reject, root: dom.root };
}
