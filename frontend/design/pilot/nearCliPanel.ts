import type { NearAuthChallengeResponse, NearAuthVerifyRequest } from '@terra/contracts';
import { requestNearAuthChallenge } from './nearAuthApi';

const TESTNET_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/;
const IMPLICIT_ACCOUNT_RE = /^[0-9a-f]{64}$/;
const CLI_FAUCET_CREATE_CMD =
  'near account create-account sponsor-by-faucet-service <your-pilot>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create';

export interface NearCliPanelOptions {
  readonly mode: 'signin' | 'signup';
  readonly savedAccountId?: string;
  readonly onVerifiedPayload: (payload: NearAuthVerifyRequest) => void;
}

interface CliPanelDom {
  readonly box: HTMLDivElement;
  readonly cmdCode: HTMLElement;
  readonly acctInput: HTMLInputElement;
  readonly keyInput: HTMLInputElement;
  readonly sigInput: HTMLInputElement;
  readonly err: HTMLParagraphElement;
  readonly submit: HTMLButtonElement;
}

export function buildCliSignCommand(challenge: NearAuthChallengeResponse, accountPlaceholder: string): string {
  const singleQuotedMsg = `'${challenge.message.replace(/'/g, "'\\''")}'`;
  return [
    `near message sign-nep413 utf8 ${singleQuotedMsg}`,
    `  nonce "${challenge.nonce}"`,
    `  recipient "${challenge.recipient}"`,
    `  sign-as ${accountPlaceholder}`,
    `  sign-with-keychain network-config testnet`,
  ].join(' \\\n');
}

export function tryParseCliJsonPaste(rawText: string): {
  accountId?: string;
  publicKey?: string;
  signature?: string;
} | null {
  const trimmed = rawText.trim();
  const openBrace = trimmed.indexOf('{');
  const closeBrace = trimmed.lastIndexOf('}');
  if (openBrace < 0 || closeBrace <= openBrace) return null;
  try {
    const obj = JSON.parse(trimmed.slice(openBrace, closeBrace + 1)) as Record<string, unknown>;
    return {
      accountId: typeof obj.accountId === 'string' ? obj.accountId : typeof obj.account_id === 'string' ? obj.account_id : undefined,
      publicKey: typeof obj.publicKey === 'string' ? obj.publicKey : typeof obj.public_key === 'string' ? obj.public_key : undefined,
      signature: typeof obj.signature === 'string' ? obj.signature : undefined,
    };
  } catch {
    return null;
  }
}

function isValidTestnetCliAccount(acct: string): boolean {
  if (acct.length < 2 || acct.length > 64) return false;
  return TESTNET_ACCOUNT_RE.test(acct) || IMPLICIT_ACCOUNT_RE.test(acct);
}

function makeCliInput(placeholder: string, testId: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = placeholder;
  input.dataset.testid = testId;
  return input;
}

function buildCliPanelDom(opts: NearCliPanelOptions): CliPanelDom {
  const box = document.createElement('div');
  box.className = 'near-wallet-panel';
  box.dataset.testid = 'near-panel-near-cli';

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent =
    opts.mode === 'signup'
      ? 'NEAR-CLI-RS · CREATE & SIGN (TESTNET)'
      : 'NEAR-CLI-RS · NEP-413 CHALLENGE (TESTNET)';
  box.append(label);

  if (opts.mode === 'signup') {
    const stepCreate = document.createElement('div');
    stepCreate.className = 'near-cli-hint';
    stepCreate.textContent = 'Step 1 — Create a free NEAR Testnet account in your terminal:';
    const createCode = document.createElement('code');
    createCode.dataset.testid = 'near-cli-faucet-cmd';
    createCode.textContent = CLI_FAUCET_CREATE_CMD;
    box.append(stepCreate, createCode);
  }

  const stepSign = document.createElement('div');
  stepSign.className = 'near-cli-hint';
  stepSign.textContent =
    opts.mode === 'signup'
      ? 'Step 2 — Sign the single-use server challenge below & paste the output:'
      : 'Run this command in your terminal to sign the single-use Testnet challenge:';

  const cmdCode = document.createElement('code');
  cmdCode.dataset.testid = 'near-cli-command';
  cmdCode.textContent = 'Requesting single-use NEP-413 challenge from server…';

  const acctInput = makeCliInput('pilot.testnet', 'near-account-input');
  if (opts.savedAccountId && isValidTestnetCliAccount(opts.savedAccountId)) {
    acctInput.value = opts.savedAccountId;
  }
  const keyInput = makeCliInput('Public key (ed25519:...)', 'near-pubkey-input');
  const sigInput = makeCliInput('Signature (ed25519:... or base64, or paste full CLI JSON)', 'near-signature-input');

  const err = document.createElement('p');
  err.className = 'near-wallet-err';
  err.dataset.testid = 'near-cli-error';
  err.style.display = 'none';

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-primary btn-sm';
  submit.dataset.testid = 'near-account-submit';
  submit.textContent = 'Verify NEP-413 Signature & Sign In';

  box.append(stepSign, cmdCode, acctInput, keyInput, sigInput, err, submit);
  return { box, cmdCode, acctInput, keyInput, sigInput, err, submit };
}

/** Renders the cryptographic NEP-413 `near-cli-rs` Testnet challenge & signature verification panel. */
export function renderNearCliPanel(panelHost: HTMLElement, opts: NearCliPanelOptions): void {
  panelHost.replaceChildren();
  const dom = buildCliPanelDom(opts);
  let activeChallenge: NearAuthChallengeResponse | null = null;

  const showError = (msg: string): void => {
    dom.err.textContent = msg;
    dom.err.style.display = 'block';
  };

  const updateCmdText = (): void => {
    if (!activeChallenge) return;
    const acct = dom.acctInput.value.trim().toLowerCase() || '<your-account>.testnet';
    dom.cmdCode.textContent = buildCliSignCommand(activeChallenge, acct);
  };

  void requestNearAuthChallenge({ walletId: 'near-cli', intent: opts.mode })
    .then((ch) => {
      activeChallenge = ch;
      updateCmdText();
    })
    .catch((e: unknown) => {
      dom.cmdCode.textContent = 'Challenge unavailable.';
      showError(e instanceof Error ? e.message : 'Could not fetch NEP-413 challenge.');
    });

  dom.acctInput.addEventListener('input', updateCmdText);
  dom.sigInput.addEventListener('input', () => {
    const parsedJson = tryParseCliJsonPaste(dom.sigInput.value);
    if (!parsedJson) return;
    if (parsedJson.accountId) dom.acctInput.value = parsedJson.accountId;
    if (parsedJson.publicKey) dom.keyInput.value = parsedJson.publicKey;
    if (parsedJson.signature) dom.sigInput.value = parsedJson.signature;
    updateCmdText();
  });

  const handleSubmit = (): void => {
    const rawAcct = dom.acctInput.value.trim().toLowerCase();
    const rawKey = dom.keyInput.value.trim();
    const rawSig = dom.sigInput.value.trim();
    if (rawAcct.endsWith('.near')) {
      showError('Mainnet (.near) accounts are disabled right now. Enter a NEAR Testnet (.testnet) account.');
      return;
    }
    if (!isValidTestnetCliAccount(rawAcct)) {
      showError('Enter a valid NEAR Testnet account ID (e.g. alice.testnet).');
      return;
    }
    if (!rawKey || !rawSig) {
      showError('Both your FullAccess public key (ed25519:...) and NEP-413 signature are required.');
      return;
    }
    if (!activeChallenge) {
      showError('Waiting for server NEP-413 challenge. Please retry in a moment.');
      return;
    }
    dom.err.style.display = 'none';
    opts.onVerifiedPayload({
      challengeId: activeChallenge.challengeId,
      accountId: rawAcct,
      publicKey: rawKey,
      signature: rawSig,
      walletId: 'near-cli',
    });
  };

  dom.sigInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });
  dom.submit.onclick = handleSubmit;
  panelHost.append(dom.box);
}
