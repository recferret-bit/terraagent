import type { NearAuthChallengeResponse, NearAuthVerifyRequest } from '@terra/contracts';
import type { MockToken } from './mockToken';
import { encodeNep413SocialToken } from './nearAuthApi';
import { renderNearCliPanel } from './nearCliPanel';
import {
  createPrefetchedChallengeStore,
  ensureModalCss,
  extractPopupBlockedAccountId,
  friendlyWalletError,
  MIN_PREWARMED_CHALLENGE_TTL_MS,
  readSavedNearWallet,
  renderStatusBox,
  saveNearWallet,
  SELECTOR_WALLETS,
  type PrefetchedChallengeStore,
  type SavedNearWallet,
  type SelectorWalletDef,
} from './nearWalletModalParts';
import {
  getNearWalletSelector,
  isPopupBlockedError,
  signChallengeWithNearWallet,
  WalletNotInstalledError,
} from './walletSelectorRuntime';

export { friendlyWalletError, readSavedNearWallet, saveNearWallet, type SavedNearWallet };

export interface NearWalletSelectorCallbacks {
  readonly initialMode?: 'signin' | 'signup';
  readonly network?: 'testnet' | 'mainnet';
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

function renderFlowFailure(params: {
  readonly def: SelectorWalletDef;
  readonly mode: 'signin' | 'signup';
  readonly activeNet: 'testnet' | 'mainnet';
  readonly panelHost: HTMLElement;
  readonly challenge: NearAuthChallengeResponse | null;
  readonly challengeStore: PrefetchedChallengeStore;
  readonly err: unknown;
  readonly onRetry: (preverifiedAccountId?: string) => void;
}): void {
  const { def, mode, activeNet, panelHost, challenge, challengeStore, err, onRetry } = params;
  const preserveUnusedChallenge = (): void => {
    if (challenge && challenge.expiresAt - Date.now() > MIN_PREWARMED_CHALLENGE_TTL_MS) {
      challengeStore.restoreUnused(mode, challenge);
    } else {
      void challengeStore.warm(mode);
    }
  };
  const popupBlockedAccount = extractPopupBlockedAccountId(err);
  if (popupBlockedAccount) {
    preserveUnusedChallenge();
    renderStatusBox(panelHost, {
      headline: `${def.name.toUpperCase()} · SIGNATURE POPUP BLOCKED`,
      stepText: `Account ${popupBlockedAccount} is connected. Click below to open the NEP-413 signature window directly.`,
      errorText: friendlyWalletError(err, activeNet),
      retryAction: {
        label: `Account ${popupBlockedAccount} connected — Click to Sign NEP-413 Message`,
        onClick: () => onRetry(popupBlockedAccount),
      },
    });
    return;
  }

  if (isPopupBlockedError(err) || err instanceof WalletNotInstalledError) {
    preserveUnusedChallenge();
  } else {
    void challengeStore.warm(mode);
  }
  const acctHint = activeNet === 'mainnet' ? 'NEAR Mainnet (.near)' : 'NEAR Testnet (.testnet)';
  if (err instanceof WalletNotInstalledError) {
    renderStatusBox(panelHost, {
      headline: `${def.name.toUpperCase()} · EXTENSION REQUIRED`,
      errorText: `${err.message} Install the extension, create or import a ${acctHint} account, then retry.`,
      actionLink: { label: def.signupActionLabel, href: err.downloadUrl },
      retryAction: { label: 'Retry Connection', onClick: () => onRetry() },
    });
    return;
  }
  renderStatusBox(panelHost, {
    headline: `${def.name.toUpperCase()} · SIGN-IN INCOMPLETE`,
    errorText: friendlyWalletError(err, activeNet),
    actionLink: { label: def.signupActionLabel, href: def.signupUrl },
    retryAction: { label: `Pair & Sign with ${def.name}`, onClick: () => onRetry() },
  });
}

async function executeSelectorWalletFlow(params: {
  readonly def: SelectorWalletDef;
  readonly mode: 'signin' | 'signup';
  readonly initialNetwork: 'testnet' | 'mainnet';
  readonly panelHost: HTMLElement;
  readonly challengeStore: PrefetchedChallengeStore;
  readonly setBusy: (busy: boolean) => void;
  readonly suspendTopLayer: () => () => void;
  readonly onSigned: (walletName: string, payload: NearAuthVerifyRequest) => void;
  readonly preverifiedAccountId?: string;
}): Promise<void> {
  const {
    def,
    mode,
    initialNetwork,
    panelHost,
    challengeStore,
    setBusy,
    suspendTopLayer,
    onSigned,
    preverifiedAccountId,
  } = params;
  setBusy(true);
  const origin = typeof location !== 'undefined' ? location.origin : 'https://terraagent.fun';
  const pathname = typeof location !== 'undefined' ? location.pathname : '/';
  const callbackUrl = `${origin}${pathname}`;

  let activeNet: 'testnet' | 'mainnet' = initialNetwork;
  let challenge: NearAuthChallengeResponse | null = challengeStore.takeReady(mode);
  let restoreTopLayer: (() => void) | null = null;
  try {
    if (!challenge) {
      renderStatusBox(panelHost, {
        headline: `${def.name.toUpperCase()} · NEP-413 ${activeNet.toUpperCase()} AUTH`,
        stepText: '1/3 · Requesting single-use 32-byte NEP-413 challenge from backend…',
      });
      challenge = await challengeStore.awaitOrFetch(def.moduleId, mode);
    }
    activeNet = challenge.network === 'mainnet' ? 'mainnet' : 'testnet';
    renderStatusBox(panelHost, {
      headline: `${def.name.toUpperCase()} · NEP-413 ${activeNet.toUpperCase()} AUTH`,
      stepText: `2/3 · Opening ${def.name} (${activeNet === 'mainnet' ? 'Mainnet' : 'Testnet'})…`,
    });
    // Exit `<dialog>` modal `#top-layer` before invoking external wallet SDKs so `document.body`
    // overlays (NEAR Mobile QR widget, Intear, Meteor web) render above `.near-modal.is-signing` and are not `inert`,
    // while keeping the dialog non-modally open so extension/popup users see live `2/3` and `3/3` step status.
    restoreTopLayer = suspendTopLayer();
    const signedPayload = await signChallengeWithNearWallet(def.moduleId, challenge, callbackUrl, {
      ...(preverifiedAccountId ? { preverifiedAccountId } : {}),
      onStep: (stepText) => {
        renderStatusBox(panelHost, {
          headline: `${def.name.toUpperCase()} · NEP-413 ${activeNet.toUpperCase()} AUTH`,
          stepText,
          ...(def.moduleId === 'near-mobile-wallet'
            ? { actionLink: { label: 'Need NEAR Mobile App? ↗', href: def.signupUrl } }
            : {}),
        });
      },
    });
    if (!panelHost.isConnected) return;
    onSigned(def.name, signedPayload);
  } catch (err) {
    restoreTopLayer?.();
    if (!panelHost.isConnected) return;
    setBusy(false);
    renderFlowFailure({
      def,
      mode,
      activeNet,
      panelHost,
      challenge,
      challengeStore,
      err,
      onRetry: (retryAcct) => void executeSelectorWalletFlow({ ...params, preverifiedAccountId: retryAcct }),
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

interface ModalChrome {
  readonly head: HTMLDivElement;
  readonly title: HTMLSpanElement;
  readonly tabs: HTMLDivElement;
  readonly signInTab: HTMLButtonElement;
  readonly signUpTab: HTMLButtonElement;
  readonly sub: HTMLParagraphElement;
}

function createModalChrome(onClose: () => void): ModalChrome {
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

function syncModalModeChrome(
  chrome: ModalChrome,
  mode: 'signin' | 'signup',
  initialNetwork: 'testnet' | 'mainnet',
  panelHost: HTMLElement,
): void {
  const netLabel = initialNetwork === 'mainnet' ? 'Mainnet' : 'Testnet';
  const netUpper = initialNetwork.toUpperCase();
  chrome.signInTab.textContent = `Sign In (${netLabel})`;
  chrome.title.textContent =
    mode === 'signup' ? `CREATE & LINK NEAR ${netUpper} WALLET` : `CONNECT NEAR ${netUpper} WALLET`;
  chrome.signInTab.className = mode === 'signin' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  chrome.signUpTab.className = mode === 'signup' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  chrome.sub.textContent =
    mode === 'signup'
      ? initialNetwork === 'mainnet'
        ? 'Connect or create a NEAR Mainnet (.near) wallet or CLI keypair, then sign a gasless NEP-413 challenge to link your Pilot.'
        : 'Create a free NEAR Testnet (.testnet) wallet or CLI keypair, then sign a gasless NEP-413 challenge to link your Pilot.'
      : `Select your NEAR ${netLabel} wallet. Every login verifies a single-use 32-byte NEP-413 signature & FullAccess key on-chain.`;
  panelHost.replaceChildren();
}

function createTopLayerSuspender(dialog: HTMLDialogElement): () => () => void {
  return () => {
    if (!dialog.isConnected) return () => undefined;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    dialog.setAttribute('closedby', 'none');
    dialog.classList.add('is-signing');
    if (typeof dialog.show === 'function') dialog.show();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.isConnected) return;
      dialog.classList.remove('is-signing');
      dialog.setAttribute('closedby', 'any');
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };
  };
}

function wireModalModeTabs(params: {
  readonly chrome: ModalChrome;
  readonly initialNetwork: 'testnet' | 'mainnet';
  readonly panelHost: HTMLElement;
  readonly challengeStore: PrefetchedChallengeStore;
  readonly isBusy: () => boolean;
  readonly getMode: () => 'signin' | 'signup';
  readonly setMode: (next: 'signin' | 'signup') => void;
}): void {
  const { chrome, initialNetwork, panelHost, challengeStore, isBusy, getMode, setMode } = params;
  const switchTo = (target: 'signin' | 'signup'): void => {
    if (isBusy() || getMode() === target) return;
    setMode(target);
    syncModalModeChrome(chrome, target, initialNetwork, panelHost);
    void challengeStore.warm(target);
  };
  chrome.signInTab.onclick = () => switchTo('signin');
  chrome.signUpTab.onclick = () => switchTo('signup');
  syncModalModeChrome(chrome, getMode(), initialNetwork, panelHost);
}

function createDialogShell(challengeStore: PrefetchedChallengeStore): {
  readonly dialog: HTMLDialogElement;
  readonly close: () => void;
} {
  const dialog = document.createElement('dialog');
  dialog.className = 'plate near-modal';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('aria-labelledby', 'near-modal-title');
  dialog.dataset.testid = 'near-wallet-modal';
  const close = (): void => {
    challengeStore.dispose();
    dialog.classList.remove('is-signing');
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    dialog.remove();
  };
  return { dialog, close };
}

/**
 * Opens the NEAR Wallet Selector dialog (Meteor, OKX, NEAR Mobile, NEAR CLI, Intear, MyNearWallet)
 * enforcing server-issued NEP-413 32-byte cryptographic challenge signing + FullAccess key verification.
 */
export function openNearWalletSelectorModal(callbacks: NearWalletSelectorCallbacks): HTMLDialogElement {
  ensureModalCss();
  document.querySelector<HTMLDialogElement>('dialog[data-testid="near-wallet-modal"]')?.remove();

  let mode: 'signin' | 'signup' = callbacks.initialMode ?? 'signin';
  let signingBusy = false;
  const initialNetwork: 'testnet' | 'mainnet' = callbacks.network === 'mainnet' ? 'mainnet' : 'testnet';

  // Pre-warm `@near-wallet-selector/*` modules & server NEP-413 challenge immediately so wallet clicks
  // open browser popups synchronously inside transient user activation (avoiding Safari/Firefox popup blockers).
  void getNearWalletSelector(initialNetwork).catch(() => undefined);
  const challengeStore = createPrefetchedChallengeStore();
  void challengeStore.warm(mode);
  const { dialog, close } = createDialogShell(challengeStore);

  const chrome = createModalChrome(close);
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

  const suspendTopLayer = createTopLayerSuspender(dialog);
  const startFlow = (def: SelectorWalletDef): void => {
    if (signingBusy) return;
    void executeSelectorWalletFlow({
      def,
      mode,
      initialNetwork,
      panelHost,
      challengeStore,
      setBusy,
      suspendTopLayer,
      onSigned: finishVerified,
    });
  };
  const openCli = (): void => {
    if (signingBusy) return;
    renderNearCliPanel(panelHost, { mode, network: initialNetwork, savedAccountId: saved?.accountId, onVerifiedPayload: (p) => finishVerified('NEAR CLI', p) });
  };

  grid = buildWalletGrid((def) => {
    if (signingBusy) return;
    if (mode === 'signup' && (def.moduleId === 'near-mobile-wallet' || def.moduleId === 'my-near-wallet' || def.moduleId === 'okx-wallet')) {
      renderWalletSignUpGuide(def, panelHost, () => startFlow(def));
      return;
    }
    startFlow(def);
  }, openCli);

  wireModalModeTabs({
    chrome,
    initialNetwork,
    panelHost,
    challengeStore,
    isBusy: () => signingBusy,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
  });

  dialog.addEventListener('pointerenter', () => {
    if (!signingBusy) challengeStore.ensureFresh(mode);
  });
  dialog.onclick = (e) => { if (e.target === dialog && !signingBusy) close(); };
  dialog.append(chrome.head, chrome.tabs, chrome.sub, ...(saved ? [buildSavedWalletBanner(saved, startFlow, openCli)] : []), grid, panelHost);
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return dialog;
}
