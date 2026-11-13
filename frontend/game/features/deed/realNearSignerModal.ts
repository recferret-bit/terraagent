import type { Nep413Signature } from '@terra/contracts';
import { tryParseCliJsonPaste } from '../../../design/pilot/nearCliPanel';
import {
  signWithBrowserWalletSelector,
  type RealNearNetwork,
  type RealSignerWalletModuleId,
} from './parts/realNearWalletDriver';
import type { OpenSignerModalHandle, SignerModalOutcome, SignerModalRequest } from './signerModal';
import './signerModal.css';

export type { RealNearNetwork } from './parts/realNearWalletDriver';

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

function buildInputField(placeholder: string, testId: string, initialValue = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = placeholder;
  input.dataset.testid = testId;
  input.value = initialValue;
  return input;
}

function buildWalletBtn(label: string, testId: string, primary = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = primary ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  btn.dataset.testid = testId;
  btn.textContent = label;
  return btn;
}

interface RealSignerDom {
  readonly root: HTMLDivElement;
  readonly walletBtns: ReadonlyArray<{ readonly btn: HTMLButtonElement; readonly moduleId: RealSignerWalletModuleId }>;
  readonly cliCode: HTMLElement;
  readonly acctInput: HTMLInputElement;
  readonly pubKeyInput: HTMLInputElement;
  readonly sigInput: HTMLInputElement;
  readonly statusEl: HTMLDivElement;
  readonly rejectBtn: HTMLButtonElement;
  readonly approveBtn: HTMLButtonElement;
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
  walletRow.className = 'ta-signer-modal__wallets';
  const walletBtns: Array<{ readonly btn: HTMLButtonElement; readonly moduleId: RealSignerWalletModuleId }> = [
    { btn: buildWalletBtn('Sign with Meteor', 'real-signer-meteor', true), moduleId: 'meteor-wallet' },
    { btn: buildWalletBtn('OKX', 'real-signer-okx'), moduleId: 'okx-wallet' },
    { btn: buildWalletBtn('NEAR Mobile', 'real-signer-mobile'), moduleId: 'near-mobile-wallet' },
    { btn: buildWalletBtn('Intear', 'real-signer-intear'), moduleId: 'intear-wallet' },
    ...(req.network === 'testnet'
      ? [{ btn: buildWalletBtn('MyNearWallet', 'real-signer-mynearwallet'), moduleId: 'my-near-wallet' as const }]
      : []),
  ];
  walletRow.append(...walletBtns.map((w) => w.btn));

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
  const sigInput = buildInputField(
    'NEP-413 signature (ed25519:..., base64, or paste CLI JSON)',
    'real-signer-signature',
  );

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
  return { root, walletBtns, cliCode, acctInput, pubKeyInput, sigInput, statusEl, rejectBtn, approveBtn };
}

function wireCliInputs(
  dom: RealSignerDom,
  req: SignerModalRequest & { readonly network: RealNearNetwork },
  nonceBase64: string,
  onApprove: () => void,
): void {
  const syncCliCmd = (): void => {
    dom.cliCode.textContent = buildCliCommand(req, nonceBase64, req.network, dom.acctInput.value.trim().toLowerCase());
  };
  dom.acctInput.addEventListener('input', syncCliCmd);
  dom.sigInput.addEventListener('input', () => {
    const parsed = tryParseCliJsonPaste(dom.sigInput.value);
    if (!parsed) return;
    if (parsed.accountId) dom.acctInput.value = parsed.accountId;
    if (parsed.publicKey) dom.pubKeyInput.value = parsed.publicKey;
    if (parsed.signature) dom.sigInput.value = parsed.signature;
    syncCliCmd();
  });
  dom.sigInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onApprove();
  });
}

const TESTNET_NAMED_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/;
const MAINNET_NAMED_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)+(near|tg|sweat)$/;
const IMPLICIT_HEX_RE = /^[0-9a-f]{64}$/;

function validateManualSignature(
  dom: RealSignerDom,
  req: SignerModalRequest & { readonly network: RealNearNetwork },
  nonceBase64: string,
): Nep413Signature | null {
  const accountId = dom.acctInput.value.trim().toLowerCase();
  const publicKey = dom.pubKeyInput.value.trim();
  const signature = dom.sigInput.value.trim();
  if (!accountId || !publicKey || !signature) {
    dom.statusEl.textContent = 'Enter account ID, FullAccess public key, and NEP-413 signature (or click a wallet above).';
    return null;
  }
  const isImplicit = IMPLICIT_HEX_RE.test(accountId);
  if (req.network === 'testnet') {
    if (accountId.endsWith('.near')) {
      dom.statusEl.textContent = 'Mainnet (.near) account entered for a Testnet action. Enter a .testnet account.';
      return null;
    }
    if (!isImplicit && !TESTNET_NAMED_RE.test(accountId)) {
      dom.statusEl.textContent = 'Enter a valid NEAR Testnet account ID (e.g. alice.testnet).';
      return null;
    }
  } else {
    if (accountId.endsWith('.testnet')) {
      dom.statusEl.textContent = 'Testnet (.testnet) account entered for a Mainnet action. Enter a .near account.';
      return null;
    }
    if (!isImplicit && accountId !== 'aurora' && !MAINNET_NAMED_RE.test(accountId)) {
      dom.statusEl.textContent = 'Enter a valid NEAR Mainnet account ID (e.g. alice.near).';
      return null;
    }
  }
  return { accountId, publicKey, signature, message: req.message, nonce: nonceBase64, recipient: req.recipient };
}

function runRealWalletButtonSign(params: {
  readonly dom: RealSignerDom;
  readonly req: SignerModalRequest & { readonly network: RealNearNetwork };
  readonly moduleId: RealSignerWalletModuleId;
  readonly nonceBase64: string;
  readonly nonceBytes: Uint8Array;
  readonly setWalletBusy: (busy: boolean) => void;
  readonly finishApproved: (sig: Nep413Signature) => void;
}): void {
  const { dom, req, moduleId, nonceBase64, nonceBytes, setWalletBusy, finishApproved } = params;
  setWalletBusy(true);
  dom.statusEl.textContent =
    moduleId === 'near-mobile-wallet'
      ? 'Scan the QR code in NEAR Mobile and approve the NEP-413 signature…'
      : 'Waiting for wallet NEP-413 signature…';
  dom.root.style.zIndex = '900';
  void signWithBrowserWalletSelector({
    network: req.network,
    moduleId,
    message: req.message,
    nonceBase64,
    nonceBytes,
    recipient: req.recipient,
  })
    .then((res) =>
      finishApproved({
        accountId: res.accountId,
        publicKey: res.publicKey,
        signature: res.signature,
        message: req.message,
        nonce: nonceBase64,
        recipient: req.recipient,
        ...(res.callbackUrl ? { callbackUrl: res.callbackUrl } : {}),
      }),
    )
    .catch((err: unknown) => {
      dom.root.style.zIndex = '';
      setWalletBusy(false);
      dom.statusEl.textContent = err instanceof Error ? err.message : 'Wallet signing failed.';
    });
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
  let walletBusy = false;
  let resolveOutcome!: (val: SignerModalOutcome) => void;
  const promise = new Promise<SignerModalOutcome>((res) => {
    resolveOutcome = res;
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !walletBusy) {
      e.preventDefault();
      reject();
    }
  };

  const finishApproved = (sig: Nep413Signature): void => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown);
    dom.root.remove();
    resolveOutcome({ status: 'approved', signature: sig });
  };

  const reject = (): void => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown);
    dom.root.remove();
    resolveOutcome({ status: 'rejected', reason: 'Cancelled in wallet' });
  };

  document.addEventListener('keydown', onKeyDown);

  const approve = (): void => {
    const validated = validateManualSignature(dom, req, nonceBase64);
    if (validated) finishApproved(validated);
  };

  const setWalletBusy = (busy: boolean): void => {
    walletBusy = busy;
    dom.walletBtns.forEach(({ btn }) => {
      btn.disabled = busy;
    });
  };

  wireCliInputs(dom, req, nonceBase64, approve);
  dom.walletBtns.forEach(({ btn, moduleId }) => {
    btn.onclick = () => {
      if (!walletBusy && !settled) {
        runRealWalletButtonSign({ dom, req, moduleId, nonceBase64, nonceBytes, setWalletBusy, finishApproved });
      }
    };
  });
  dom.approveBtn.onclick = approve;
  dom.rejectBtn.onclick = reject;
  dom.root.onclick = (e) => {
    if (e.target === dom.root && !walletBusy) reject();
  };

  return { promise, approve, reject, close: reject, root: dom.root };
}
