import type { NearAuthVerifyRequest } from '@terra/contracts';
import type { MockToken } from './mockToken';
import { encodeNep413SocialToken, requestNearAuthChallenge } from './nearAuthApi';
import { renderNearCliPanel } from './nearCliPanel';
import {
  signChallengeWithNearWallet,
  WalletNotInstalledError,
  type WalletSelectorModuleId,
} from './walletSelectorRuntime';

export interface SavedNearWallet {
  readonly walletId: string;
  readonly walletName: string;
  readonly accountId: string;
  readonly publicKey?: string;
  readonly connectedAt: number;
}

const STORAGE_KEY = 'ta_near_wallet';
const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

const MODAL_CSS = `
.near-modal{margin:auto;padding:var(--ta-s5);width:min(460px,92vw);background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-seam-2);overscroll-behavior:contain}
.near-modal::backdrop{background:color-mix(in srgb,var(--ta-black-hole) 78%,transparent);backdrop-filter:blur(4px)}
.near-modal-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s3);margin-bottom:var(--ta-s3)}
.near-modal-tabs{display:grid;grid-template-columns:1fr 1fr;gap:var(--ta-s2);margin-bottom:var(--ta-s3)}
.near-modal-sub{font-size:var(--ta-fs-eyebrow);color:var(--ta-text-3);margin:0 0 var(--ta-s3);line-height:1.45}
.near-wallet-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--ta-s2);margin-bottom:var(--ta-s3)}
.near-wallet-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;text-align:left;background:var(--ta-plate-2);border:1px solid var(--ta-seam);color:var(--ta-text);cursor:pointer;font-family:var(--ta-font-display)}
.near-wallet-opt:hover:not(:disabled){border-color:var(--ta-orange);background:color-mix(in srgb,var(--ta-orange) 8%,var(--ta-plate-2))}
.near-wallet-opt:disabled{opacity:.55;cursor:wait}
.near-wallet-opt b{font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.near-wallet-opt span{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-text-3)}
.near-wallet-panel{padding:var(--ta-s3);background:var(--ta-plate-2);border:1px solid var(--ta-seam-2);display:flex;flex-direction:column;gap:var(--ta-s2);margin-top:var(--ta-s2)}
.near-wallet-panel code{display:block;padding:var(--ta-s2) 10px;background:var(--ta-void);border:1px solid var(--ta-seam);font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-orange-hi);word-break:break-all;white-space:pre-wrap;user-select:all}
.near-wallet-panel input{width:100%;box-sizing:border-box}
.near-cli-hint{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-text-2)}
.near-wallet-saved{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s2);padding:10px 12px;margin-bottom:var(--ta-s3);background:color-mix(in srgb,var(--ta-orange) 10%,var(--ta-plate-2));border:1px solid var(--ta-orange)}
.near-wallet-saved span{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-text)}
.near-wallet-step{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-blue-hi);margin:0}
.near-wallet-err{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-fault-text);margin:0}
.near-signup-links{display:flex;flex-wrap:wrap;gap:var(--ta-s2)}
`;

interface SelectorWalletDef {
  readonly testId: string;
  readonly moduleId: WalletSelectorModuleId;
  readonly name: string;
  readonly subtitle: string;
  readonly signupUrl: string;
  readonly signupActionLabel: string;
}

const SELECTOR_WALLETS: readonly SelectorWalletDef[] = [
  {
    testId: 'near-wallet-meteor',
    moduleId: 'meteor-wallet',
    name: 'Meteor Wallet',
    subtitle: 'EXTENSION / WEB · TESTNET',
    signupUrl: 'https://wallet.meteorwallet.app',
    signupActionLabel: 'Create Meteor Testnet Wallet ↗',
  },
  {
    testId: 'near-wallet-okx',
    moduleId: 'okx-wallet',
    name: 'OKX Wallet',
    subtitle: 'EXTENSION · TESTNET',
    signupUrl: 'https://web3.okx.com/download',
    signupActionLabel: 'Install OKX Extension ↗',
  },
  {
    testId: 'near-wallet-mobile',
    moduleId: 'near-mobile-wallet',
    name: 'NEAR Mobile',
    subtitle: 'QR / APP PAIR · TESTNET',
    signupUrl: 'https://nearmobile.app',
    signupActionLabel: 'Get NEAR Mobile (iOS / Android) ↗',
  },
  {
    testId: 'near-wallet-intear',
    moduleId: 'intear-wallet',
    name: 'Intear Wallet',
    subtitle: 'WEB / DESKTOP · TESTNET',
    signupUrl: 'https://wallet.intear.tech',
    signupActionLabel: 'Create Intear Testnet Wallet ↗',
  },
  {
    testId: 'near-wallet-mynearwallet',
    moduleId: 'my-near-wallet',
    name: 'MyNearWallet',
    subtitle: 'TESTNET WEB WALLET',
    signupUrl: 'https://testnet.mynearwallet.com/create',
    signupActionLabel: 'Create MyNearWallet (.testnet) ↗',
  },
];

function ensureModalCss(): void {
  if (typeof document === 'undefined' || document.getElementById('near-wallet-modal-css')) return;
  const style = document.createElement('style');
  style.id = 'near-wallet-modal-css';
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

export function readSavedNearWallet(): SavedNearWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedNearWallet>;
    if (typeof parsed.accountId === 'string' && NEAR_ACCOUNT_RE.test(parsed.accountId)) {
      return {
        walletId: parsed.walletId ?? 'near-cli',
        walletName: parsed.walletName ?? 'NEAR Wallet',
        accountId: parsed.accountId,
        publicKey: typeof parsed.publicKey === 'string' ? parsed.publicKey : undefined,
        connectedAt: typeof parsed.connectedAt === 'number' ? parsed.connectedAt : Date.now(),
      };
    }
  } catch {
    /* ignore storage errors */
  }
  return null;
}

export function saveNearWallet(entry: SavedNearWallet): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore storage errors */
  }
}

export interface NearWalletSelectorCallbacks {
  readonly initialMode?: 'signin' | 'signup';
  onPopupOpened?(popup: Window | null): void;
  onDirectToken(hit: MockToken): void;
}

function createOptionButton(testId: string, title: string, subtitle: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'near-wallet-opt';
  btn.dataset.testid = testId;
  const b = document.createElement('b');
  b.textContent = title;
  const s = document.createElement('span');
  s.textContent = subtitle;
  btn.append(b, s);
  btn.onclick = onClick;
  return btn;
}

function renderStatusBox(
  panelHost: HTMLElement,
  opts: {
    readonly headline: string;
    readonly stepText?: string;
    readonly errorText?: string;
    readonly actionLink?: { readonly label: string; readonly href: string };
    readonly retryAction?: { readonly label: string; readonly onClick: () => void };
  },
): HTMLElement {
  panelHost.replaceChildren();
  const box = document.createElement('div');
  box.className = 'near-wallet-panel';
  box.dataset.testid = 'near-wallet-status-panel';

  const head = document.createElement('div');
  head.className = 'label';
  head.textContent = opts.headline;
  box.append(head);

  if (opts.stepText) {
    const p = document.createElement('p');
    p.className = 'near-wallet-step';
    p.dataset.testid = 'near-wallet-step';
    p.textContent = opts.stepText;
    box.append(p);
  }
  if (opts.errorText) {
    const err = document.createElement('p');
    err.className = 'near-wallet-err';
    err.dataset.testid = 'near-wallet-error';
    err.textContent = opts.errorText;
    box.append(err);
  }
  if (opts.actionLink || opts.retryAction) {
    const actions = document.createElement('div');
    actions.className = 'near-signup-links';
    if (opts.actionLink) {
      const a = document.createElement('a');
      a.className = 'btn btn-ghost btn-sm';
      a.href = opts.actionLink.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.dataset.testid = 'near-wallet-external-link';
      a.textContent = opts.actionLink.label;
      actions.append(a);
    }
    if (opts.retryAction) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-primary btn-sm';
      retry.dataset.testid = 'near-wallet-pair-btn';
      retry.textContent = opts.retryAction.label;
      retry.onclick = opts.retryAction.onClick;
      actions.append(retry);
    }
    box.append(actions);
  }
  panelHost.append(box);
  return box;
}

async function executeSelectorWalletFlow(params: {
  readonly def: SelectorWalletDef;
  readonly mode: 'signin' | 'signup';
  readonly panelHost: HTMLElement;
  readonly setBusy: (busy: boolean) => void;
  readonly suspendTopLayer: () => () => void;
  readonly onSigned: (walletName: string, payload: NearAuthVerifyRequest) => void;
}): Promise<void> {
  const { def, mode, panelHost, setBusy, suspendTopLayer, onSigned } = params;
  setBusy(true);
  const origin = typeof location !== 'undefined' ? location.origin : 'https://terraagent.fun';
  const pathname = typeof location !== 'undefined' ? location.pathname : '/';
  const callbackUrl = `${origin}${pathname}`;

  renderStatusBox(panelHost, {
    headline: `${def.name.toUpperCase()} · NEP-413 TESTNET AUTH`,
    stepText: '1/3 · Requesting single-use 32-byte NEP-413 challenge from backend…',
  });

  let restoreTopLayer: (() => void) | null = null;
  try {
    const challenge = await requestNearAuthChallenge({ walletId: def.moduleId, intent: mode });
    // Exit `<dialog>` modal `#top-layer` before invoking external wallet SDKs so `document.body`
    // iframes (NEAR Mobile QR widget, Intear, Meteor web) render unobstructed and are not `inert`.
    restoreTopLayer = suspendTopLayer();
    const signedPayload = await signChallengeWithNearWallet(def.moduleId, challenge, callbackUrl, {
      onStep: (stepText) => {
        renderStatusBox(panelHost, {
          headline: `${def.name.toUpperCase()} · NEP-413 TESTNET AUTH`,
          stepText,
          ...(def.moduleId === 'near-mobile-wallet'
            ? { actionLink: { label: 'Need NEAR Mobile App? ↗', href: def.signupUrl } }
            : {}),
        });
      },
    });
    onSigned(def.name, signedPayload);
  } catch (err) {
    restoreTopLayer?.();
    setBusy(false);
    const retry = () => void executeSelectorWalletFlow(params);
    if (err instanceof WalletNotInstalledError) {
      renderStatusBox(panelHost, {
        headline: `${def.name.toUpperCase()} · EXTENSION REQUIRED`,
        errorText: `${err.message} Install the extension, create or import a NEAR Testnet (.testnet) account, then retry.`,
        actionLink: { label: def.signupActionLabel, href: err.downloadUrl },
        retryAction: { label: 'Retry Connection', onClick: retry },
      });
      return;
    }
    renderStatusBox(panelHost, {
      headline: `${def.name.toUpperCase()} · SIGN-IN INCOMPLETE`,
      errorText: err instanceof Error ? err.message : 'Wallet signature could not be completed.',
      actionLink: { label: def.signupActionLabel, href: def.signupUrl },
      retryAction: { label: `Pair & Sign with ${def.name}`, onClick: retry },
    });
  }
}

function renderWalletSignUpGuide(
  def: SelectorWalletDef,
  panelHost: HTMLElement,
  onPairAndSign: () => void,
): void {
  renderStatusBox(panelHost, {
    headline: `${def.name.toUpperCase()} · CREATE TESTNET ACCOUNT`,
    stepText:
      def.moduleId === 'near-mobile-wallet'
        ? 'Step 1: Install NEAR Mobile, switch network to Testnet in Settings, and create a .testnet account. Step 2: Click Pair & Sign below to scan the QR code and confirm.'
        : `Step 1: Create a free .testnet account in ${def.name}. Step 2: Click Pair & Sign below to sign the NEP-413 challenge.`,
    actionLink: { label: def.signupActionLabel, href: def.signupUrl },
    retryAction: { label: `Pair & Sign with ${def.name}`, onClick: onPairAndSign },
  });
}

function buildSavedWalletBanner(
  saved: SavedNearWallet,
  onRunDef: (def: SelectorWalletDef) => void,
  onOpenCli: () => void,
): HTMLDivElement {
  const matched = SELECTOR_WALLETS.find((w) => w.moduleId === saved.walletId || w.testId.endsWith(saved.walletId));
  const row = document.createElement('div');
  row.className = 'near-wallet-saved';
  const info = document.createElement('span');
  info.textContent = `${saved.walletName}: ${saved.accountId}`;
  const resumeBtn = document.createElement('button');
  resumeBtn.type = 'button';
  resumeBtn.className = 'btn btn-primary btn-sm';
  resumeBtn.dataset.testid = 'near-wallet-resume';
  resumeBtn.textContent = 'Sign & Reconnect';
  resumeBtn.onclick = () => {
    if (matched) onRunDef(matched);
    else onOpenCli();
  };
  row.append(info, resumeBtn);
  return row;
}

function buildWalletGrid(
  onSelectWallet: (def: SelectorWalletDef) => void,
  onSelectCli: () => void,
): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'near-wallet-grid';
  const [meteor, okx, mobile, intear, mnw] = SELECTOR_WALLETS;
  grid.append(
    createOptionButton(meteor!.testId, meteor!.name, meteor!.subtitle, () => onSelectWallet(meteor!)),
    createOptionButton(okx!.testId, okx!.name, okx!.subtitle, () => onSelectWallet(okx!)),
    createOptionButton(mobile!.testId, mobile!.name, mobile!.subtitle, () => onSelectWallet(mobile!)),
    createOptionButton('near-wallet-cli', 'NEAR CLI (rs)', 'NEP-413 TERMINAL · TESTNET', onSelectCli),
    createOptionButton(intear!.testId, intear!.name, intear!.subtitle, () => onSelectWallet(intear!)),
    createOptionButton(mnw!.testId, mnw!.name, mnw!.subtitle, () => onSelectWallet(mnw!)),
  );
  return grid;
}

function createModalChrome(onClose: () => void): {
  head: HTMLDivElement;
  title: HTMLSpanElement;
  tabs: HTMLDivElement;
  signInTab: HTMLButtonElement;
  signUpTab: HTMLButtonElement;
  sub: HTMLParagraphElement;
} {
  const head = document.createElement('div');
  head.className = 'near-modal-head';
  const title = document.createElement('span');
  title.id = 'near-modal-title';
  title.className = 'label';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.textContent = '✕';
  closeBtn.onclick = onClose;
  head.append(title, closeBtn);

  const tabs = document.createElement('div');
  tabs.className = 'near-modal-tabs';
  const signInTab = document.createElement('button');
  signInTab.type = 'button';
  signInTab.dataset.testid = 'near-mode-signin';
  signInTab.textContent = 'Sign In (Testnet)';
  const signUpTab = document.createElement('button');
  signUpTab.type = 'button';
  signUpTab.dataset.testid = 'near-mode-signup';
  signUpTab.textContent = 'Sign Up · New Wallet';
  tabs.append(signInTab, signUpTab);

  const sub = document.createElement('p');
  sub.className = 'near-modal-sub';
  return { head, title, tabs, signInTab, signUpTab, sub };
}

/**
 * Opens the NEAR Testnet Wallet Selector dialog (Meteor, OKX, NEAR Mobile, NEAR CLI, Intear, MyNearWallet)
 * enforcing server-issued NEP-413 32-byte cryptographic challenge signing + FullAccess key verification.
 */
export function openNearWalletSelectorModal(callbacks: NearWalletSelectorCallbacks): HTMLDialogElement {
  ensureModalCss();
  document.querySelector<HTMLDialogElement>('dialog[data-testid="near-wallet-modal"]')?.remove();

  let mode: 'signin' | 'signup' = callbacks.initialMode ?? 'signin';
  let signingBusy = false;

  const dialog = document.createElement('dialog');
  dialog.className = 'plate near-modal';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('aria-labelledby', 'near-modal-title');
  dialog.dataset.testid = 'near-wallet-modal';

  const close = (): void => {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    dialog.remove();
  };

  const { head, title, tabs, signInTab, signUpTab, sub } = createModalChrome(close);
  const panelHost = document.createElement('div');
  const saved = readSavedNearWallet();

  const finishVerified = (walletName: string, payload: NearAuthVerifyRequest): void => {
    saveNearWallet({
      walletId: payload.walletId ?? 'near-wallet',
      walletName,
      accountId: payload.accountId,
      publicKey: payload.publicKey,
      connectedAt: Date.now(),
    });
    close();
    callbacks.onDirectToken({ provider: 'near-wallet', token: encodeNep413SocialToken(payload) });
  };

  let grid!: HTMLDivElement;
  const setBusy = (disabled: boolean): void => {
    signingBusy = disabled;
    grid.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.disabled = disabled;
    });
  };

  const suspendTopLayer = (): (() => void) => {
    if (!dialog.isConnected) return () => undefined;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    dialog.style.display = 'none';
    return () => {
      if (!dialog.isConnected) return;
      dialog.style.display = '';
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };
  };

  const startFlow = (def: SelectorWalletDef): void => {
    if (signingBusy) return;
    void executeSelectorWalletFlow({ def, mode, panelHost, setBusy, suspendTopLayer, onSigned: finishVerified });
  };

  const openCli = (): void => {
    if (signingBusy) return;
    renderNearCliPanel(panelHost, { mode, savedAccountId: saved?.accountId, onVerifiedPayload: (p) => finishVerified('NEAR CLI', p) });
  };

  grid = buildWalletGrid((def) => {
    if (signingBusy) return;
    if (mode === 'signup' && (def.moduleId === 'near-mobile-wallet' || def.moduleId === 'my-near-wallet' || def.moduleId === 'okx-wallet')) {
      renderWalletSignUpGuide(def, panelHost, () => startFlow(def));
      return;
    }
    startFlow(def);
  }, openCli);

  const syncModeUi = (): void => {
    title.textContent = mode === 'signup' ? 'CREATE & LINK NEAR TESTNET WALLET' : 'CONNECT NEAR TESTNET WALLET';
    signInTab.className = mode === 'signin' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
    signUpTab.className = mode === 'signup' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
    sub.textContent =
      mode === 'signup'
        ? 'Create a free NEAR Testnet (.testnet) wallet or CLI keypair, then sign a gasless NEP-413 challenge to link your Pilot.'
        : 'Select your NEAR Testnet wallet. Every login verifies a single-use 32-byte NEP-413 signature & FullAccess key on-chain.';
    panelHost.replaceChildren();
  };

  signInTab.onclick = () => { if (!signingBusy) { mode = 'signin'; syncModeUi(); } };
  signUpTab.onclick = () => { if (!signingBusy) { mode = 'signup'; syncModeUi(); } };
  syncModeUi();

  dialog.onclick = (e) => { if (e.target === dialog && !signingBusy) close(); };
  dialog.append(head, tabs, sub, ...(saved ? [buildSavedWalletBanner(saved, startFlow, openCli)] : []), grid, panelHost);
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return dialog;
}
