import type { NearAuthChallengeResponse, NearAuthVerifyRequest } from '@terra/contracts';
import { requestNearAuthChallenge } from './nearAuthApi';

const TESTNET_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/;
const MAINNET_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)+(near|tg|sweat)$/;
const IMPLICIT_ACCOUNT_RE = /^[0-9a-f]{64}$/;
const CLI_FAUCET_CREATE_CMD =
  'near account create-account sponsor-by-faucet-service <your-pilot>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create';

export interface NearCliPanelOptions {
  readonly mode: 'signin' | 'signup';
  readonly network?: 'testnet' | 'mainnet';
  readonly savedAccountId?: string;
  readonly onVerifiedPayload: (payload: NearAuthVerifyRequest) => void;
}

interface CliPanelDom {
  readonly box: HTMLDivElement;
  readonly label: HTMLDivElement;
  readonly faucetStep?: HTMLDivElement;
  readonly faucetCode?: HTMLElement;
  readonly stepSign: HTMLDivElement;
  readonly cmdCode: HTMLElement;
  readonly acctInput: HTMLInputElement;
  readonly keyInput: HTMLInputElement;
  readonly sigInput: HTMLInputElement;
  readonly err: HTMLParagraphElement;
  readonly submit: HTMLButtonElement;
}

export function buildCliSignCommand(challenge: NearAuthChallengeResponse, accountPlaceholder: string): string {
  const singleQuotedMsg = `'${challenge.message.replace(/'/g, "'\\''")}'`;
  const net = challenge.network === 'mainnet' ? 'mainnet' : 'testnet';
  return [
    `near message sign-nep413 utf8 ${singleQuotedMsg}`,
    `  nonce "${challenge.nonce}"`,
    `  recipient "${challenge.recipient}"`,
    `  sign-as ${accountPlaceholder}`,
    `  sign-with-keychain network-config ${net}`,
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

export function isValidCliAccountForNetwork(acct: string, network: 'testnet' | 'mainnet' = 'testnet'): boolean {
  if (acct.length < 2 || acct.length > 64) return false;
  if (IMPLICIT_ACCOUNT_RE.test(acct)) return true;
  if (network === 'mainnet') {
    return acct === 'aurora' || MAINNET_ACCOUNT_RE.test(acct);
  }
  return TESTNET_ACCOUNT_RE.test(acct);
}

function makeCliInput(placeholder: string, testId: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = placeholder;
  input.dataset.testid = testId;
  return input;
}

function syncCliNetworkLabels(dom: CliPanelDom, mode: 'signin' | 'signup', network: 'testnet' | 'mainnet'): void {
  const upper = network.toUpperCase();
  const titleCase = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  dom.label.textContent =
    mode === 'signup'
      ? `NEAR-CLI-RS · CREATE & SIGN (${upper})`
      : `NEAR-CLI-RS · NEP-413 CHALLENGE (${upper})`;
  if (dom.faucetStep && dom.faucetCode) {
    const showFaucet = network === 'testnet';
    dom.faucetStep.style.display = showFaucet ? '' : 'none';
    dom.faucetCode.style.display = showFaucet ? '' : 'none';
  }
  dom.stepSign.textContent =
    mode === 'signup'
      ? network === 'mainnet'
        ? 'Sign the single-use NEAR Mainnet challenge below & paste the output:'
        : 'Step 2 — Sign the single-use server challenge below & paste the output:'
      : `Run this command in your terminal to sign the single-use ${titleCase} challenge:`;
  dom.acctInput.placeholder = network === 'mainnet' ? 'pilot.near' : 'pilot.testnet';
}

function buildCliPanelDom(opts: NearCliPanelOptions): CliPanelDom {
  const initialNet = opts.network ?? 'testnet';
  const box = document.createElement('div');
  box.className = 'near-wallet-panel';
  box.dataset.testid = 'near-panel-near-cli';

  const label = document.createElement('div');
  label.className = 'label';
  box.append(label);

  let faucetStep: HTMLDivElement | undefined;
  let faucetCode: HTMLElement | undefined;
  if (opts.mode === 'signup') {
    faucetStep = document.createElement('div');
    faucetStep.className = 'near-cli-hint';
    faucetStep.textContent = 'Step 1 — Create a free NEAR Testnet account in your terminal:';
    faucetCode = document.createElement('code');
    faucetCode.dataset.testid = 'near-cli-faucet-cmd';
    faucetCode.textContent = CLI_FAUCET_CREATE_CMD;
    box.append(faucetStep, faucetCode);
  }

  const stepSign = document.createElement('div');
  stepSign.className = 'near-cli-hint';

  const cmdCode = document.createElement('code');
  cmdCode.dataset.testid = 'near-cli-command';
  cmdCode.textContent = 'Requesting single-use NEP-413 challenge from server…';

  const acctInput = makeCliInput(initialNet === 'mainnet' ? 'pilot.near' : 'pilot.testnet', 'near-account-input');
  if (opts.savedAccountId && isValidCliAccountForNetwork(opts.savedAccountId, initialNet)) {
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
  const dom: CliPanelDom = { box, label, faucetStep, faucetCode, stepSign, cmdCode, acctInput, keyInput, sigInput, err, submit };
  syncCliNetworkLabels(dom, opts.mode, initialNet);
  return dom;
}

/** Renders the cryptographic NEP-413 `near-cli-rs` challenge & signature verification panel (`testnet` or `mainnet`). */
export function renderNearCliPanel(panelHost: HTMLElement, opts: NearCliPanelOptions): void {
  panelHost.replaceChildren();
  const dom = buildCliPanelDom(opts);
  let activeChallenge: NearAuthChallengeResponse | null = null;

  const activeNet = (): 'testnet' | 'mainnet' =>
    activeChallenge?.network === 'mainnet' ? 'mainnet' : (opts.network ?? 'testnet');

  const showError = (msg: string): void => {
    dom.err.textContent = msg;
    dom.err.style.display = 'block';
  };

  const updateCmdText = (): void => {
    if (!activeChallenge) return;
    const net = activeNet();
    const fallbackPlaceholder = net === 'mainnet' ? '<your-account>.near' : '<your-account>.testnet';
    const acct = dom.acctInput.value.trim().toLowerCase() || fallbackPlaceholder;
    dom.cmdCode.textContent = buildCliSignCommand(activeChallenge, acct);
  };

  void requestNearAuthChallenge({ walletId: 'near-cli', intent: opts.mode })
    .then((ch) => {
      activeChallenge = ch;
      syncCliNetworkLabels(dom, opts.mode, activeNet());
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
    const net = activeNet();
    if (net === 'testnet' && rawAcct.endsWith('.near')) {
      showError('Mainnet (.near) accounts cannot sign a NEAR Testnet challenge. Enter a NEAR Testnet (.testnet) account.');
      return;
    }
    if (net === 'mainnet' && rawAcct.endsWith('.testnet')) {
      showError('Testnet (.testnet) accounts cannot sign a NEAR Mainnet challenge. Enter a NEAR Mainnet (.near) account.');
      return;
    }
    if (!isValidCliAccountForNetwork(rawAcct, net)) {
      showError(
        net === 'mainnet'
          ? 'Enter a valid NEAR Mainnet account ID (e.g. alice.near).'
          : 'Enter a valid NEAR Testnet account ID (e.g. alice.testnet).',
      );
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
