import type { FeatureContext, HudPanelInstance } from '../../core/registry/types';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';
import { copyText, type TextClipboard } from './copyText';
import {
  type AuthProviderKind,
  buildFastAuthLoginUrl,
  consumeNearWalletCallback,
  consumePendingOAuthError,
  openNearWalletSelectorModal,
  readMockToken,
  readOAuthError,
  readOAuthErrorStorageEvent,
  readOAuthStorageEvent,
} from './mockToken';
import { probeIdentityAdapterMode } from './real/fastAuthClient';

const FAULT = 'That sign-in could not be confirmed.';

/** Opens the dev mock screen in a popup. The return path is this page, so a direct visit can still redirect. */
export function openMockProvider(provider: 'google' | 'x'): Window | null {
  const ret = encodeURIComponent(location.pathname + location.search);
  return window.open(`/dev/mock-oauth?provider=${provider}&return=` + ret, 'terra-mock-oauth', 'popup,width=480,height=640');
}

/** Opens the real NEAR FastAuth (Auth0 OIDC + PKCE) popup for Google or X. */
export function openFastAuthProvider(provider: 'google' | 'x', authMode: 'signin' | 'signup' = 'signin'): Window | null {
  const url = buildFastAuthLoginUrl(location.origin, location.pathname + location.search, provider, { mode: authMode });
  return window.open(url, 'terra-fastauth-oauth', 'popup,width=500,height=680');
}

function extractChipFault(err: unknown): string {
  if (!(err instanceof Error) || !err.message) return FAULT;
  const dashIdx = err.message.indexOf(' — ');
  if (dashIdx >= 0) {
    const detail = err.message.slice(dashIdx + 3).trim();
    if (detail) return detail;
  }
  if (err.message.startsWith('POST /v1/auth/')) return FAULT;
  return err.message;
}

function guestLine(onSave: () => void): HTMLElement {
  const line = makeDiv('ta-pilot__line');
  const dot = makeSpan('ta-pilot__dot', undefined, '·');
  dot.setAttribute('aria-hidden', 'true');
  line.append(
    makeSpan('ta-pilot__label', undefined, 'Guest pilot'),
    dot,
    makeBtn('btn btn-primary btn-sm', 'save-progress', 'Save progress', onSave),
  );
  return line;
}

interface GuestActions {
  readonly mode: 'mock' | 'testnet' | 'mainnet';
  readonly authIntent: 'signin' | 'signup';
  setAuthIntent(intent: 'signin' | 'signup'): void;
  save(): void;
  google(): void;
  x(): void;
  fastAuth(): void;
  email(addr: string): void;
}

function buildTestnetPlate(plate: HTMLElement, act: GuestActions): void {
  const tabs = makeDiv('ta-pilot__line');
  const signInBtn = makeBtn(
    act.authIntent === 'signin' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm',
    'chip-mode-signin',
    'Sign In',
    () => act.setAuthIntent('signin'),
  );
  const signUpBtn = makeBtn(
    act.authIntent === 'signup' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm',
    'chip-mode-signup',
    'Sign Up',
    () => act.setAuthIntent('signup'),
  );
  tabs.append(signInBtn, signUpBtn);

  const row = makeDiv('ta-pilot__email-row');
  const input = document.createElement('input');
  input.type = 'email';
  input.className = 'input';
  input.placeholder = 'pilot@terraagent.fun';
  input.setAttribute('data-testid', 'pilot-email-input');
  const submitEmail = makeBtn(
    'btn btn-primary btn-sm',
    'continue-email',
    act.authIntent === 'signup' ? 'Mint Testnet Pilot (Email)' : 'Email / Passkey',
    () => {
      act.email(input.value);
    },
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') act.email(input.value);
  });
  row.append(input, submitEmail);
  plate.append(
    tabs,
    row,
    makeBtn('btn btn-ghost btn-sm', 'continue-google', 'Google', act.google),
    makeBtn('btn btn-ghost btn-sm', 'continue-x', 'X', act.x),
    makeBtn('btn btn-ghost btn-sm', 'continue-fastauth', 'NEAR Auth (Testnet Wallet)', act.fastAuth),
  );
  const hint = document.createElement('p');
  hint.className = 'ta-pilot__hint';
  hint.textContent =
    act.authIntent === 'signup'
      ? 'Mints a gasless *.terraagent.testnet account or links a new NEAR Testnet wallet.'
      : 'Sign in via FastAuth (Google, X, Email) or NEP-413 Testnet wallet.';
  plate.append(hint);
}

function guestNodes(open: boolean, fault: string, act: GuestActions): HTMLElement[] {
  const nodes: HTMLElement[] = [guestLine(act.save)];
  if (!open) return nodes;
  const plate = makeDiv('ta-pilot__plate plate');
  if (act.mode === 'mock') {
    plate.append(
      makeBtn('btn btn-primary btn-sm', 'continue-google', 'Continue with Google (mock)', act.google),
      makeBtn('btn btn-ghost btn-sm', 'continue-x', 'Continue with X (mock)', act.x),
    );
  } else {
    buildTestnetPlate(plate, act);
  }
  if (fault) {
    const note = document.createElement('p');
    note.className = 'ta-pilot__fault';
    note.textContent = fault;
    plate.append(note);
  }
  nodes.push(plate);
  return nodes;
}

/** Selection is only a fallback when the write is refused. A thrown selection must not escape the click. */
function selectContents(node: HTMLElement): void {
  try {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* the data-copied attribute already records the miss */
  }
}

function linkedLine(accountId: string, clipboard: TextClipboard | undefined, onSignOut: () => void): HTMLElement {
  const line = makeDiv('ta-pilot__line');
  const id = makeSpan('ta-pilot__id', 'pilot-id', `Pilot ID ${accountId}`);
  const copy = makeBtn('btn btn-ghost btn-sm', 'pilot-copy', 'Copy', () => {
    void copyText(accountId, clipboard).then((result) => {
      copy.setAttribute('data-copied', result);
      if (result === 'fail') selectContents(id);
    });
  });
  const signOut = makeBtn('btn btn-ghost btn-sm', 'pilot-sign-out', 'Sign out', onSignOut);
  line.append(id, copy, signOut);
  return line;
}

function bindPopupChannelListeners(handlers: {
  getPopup: () => Window | null;
  clearPopup: () => void;
  onToken: (provider: AuthProviderKind, token: string) => void;
  onError: (msg: string) => void;
}): () => void {
  const onMessage = (event: MessageEvent): void => {
    const popup = handlers.getPopup();
    const hit = readMockToken(event, popup, location.origin);
    if (hit) {
      handlers.onToken(hit.provider, hit.token);
      return;
    }
    const err = readOAuthError(event, popup, location.origin);
    if (err) {
      handlers.clearPopup();
      handlers.onError(err.message);
    }
  };
  const onStorage = (event: StorageEvent): void => {
    const hasPopup = Boolean(handlers.getPopup());
    const hit = readOAuthStorageEvent(event, hasPopup);
    if (hit) {
      handlers.clearPopup();
      handlers.onToken(hit.provider, hit.token);
      return;
    }
    const err = readOAuthErrorStorageEvent(event, hasPopup);
    if (err) {
      handlers.clearPopup();
      handlers.onError(err.message);
    }
  };
  window.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
  };
}

/** Top-left pilot chip. Subscribes to `services.pilot` and re-renders; no page reload. */
export function mountPilotChip(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  const pilot = ctx.services.pilot;
  const clipboard = ctx.services.clipboard;
  const root = makeDiv('ta-pilot plate-sm', 'pilot-chip');
  el.appendChild(root);
  let open = false;
  let fault = '';
  let busy = false;
  let disposed = false;
  let mode: 'mock' | 'testnet' | 'mainnet' = ctx.services.identityMode ?? 'mock';
  let authIntent: 'signin' | 'signup' = 'signin';
  let popup: Window | null = null;

  const runLogin = (provider: AuthProviderKind, token: string): void => {
    if (!pilot || busy) return;
    busy = true;
    void pilot.loginSocial(provider, token)
      .then(() => { fault = ''; }, (err: unknown) => { fault = extractChipFault(err); open = true; })
      .finally(() => { busy = false; if (!disposed) render(); });
  };

  const render = (): void => {
    const view = pilot?.view();
    root.replaceChildren();
    if (view?.accountId && !view.isGuest) {
      root.append(linkedLine(view.accountId, clipboard, () => {
        if (busy) return;
        busy = true;
        open = false;
        void Promise.resolve(pilot?.logout?.()).finally(() => {
          busy = false;
          if (!disposed) render();
        });
      }));
      return;
    }
    root.append(...guestNodes(open, fault, {
      mode,
      authIntent,
      setAuthIntent: (intent) => { authIntent = intent; render(); },
      save: () => { open = true; render(); },
      google: () => {
        if (!busy) popup = mode === 'mock' ? openMockProvider('google') : openFastAuthProvider('google', authIntent);
      },
      x: () => {
        if (!busy) popup = mode === 'mock' ? openMockProvider('x') : openFastAuthProvider('x', authIntent);
      },
      fastAuth: () => {
        if (busy) return;
        openNearWalletSelectorModal({
          initialMode: authIntent,
          onPopupOpened: (pop) => { popup = pop; },
          onDirectToken: (hit) => { runLogin(hit.provider, hit.token); },
        });
      },
      email: (addr) => {
        const clean = addr.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
          fault = 'Enter a valid email address.';
          open = true;
          render();
          return;
        }
        runLogin('email', clean);
      },
    }));
  };

  if (!ctx.services.identityMode) {
    void probeIdentityAdapterMode().then((detected) => {
      if (!disposed && detected !== mode) { mode = detected; render(); }
    });
  }

  const nearCallback = consumeNearWalletCallback();
  const redirectErr = consumePendingOAuthError();
  if (nearCallback) runLogin(nearCallback.provider, nearCallback.token);
  else if (redirectErr) { fault = redirectErr.message; open = true; }
  const unbindChannels = bindPopupChannelListeners({
    getPopup: () => popup,
    clearPopup: () => { popup = null; },
    onToken: runLogin,
    onError: (msg) => { if (!disposed) { fault = msg; open = true; render(); } },
  });
  const off = pilot?.subscribe(() => render());
  render();
  return {
    dispose() {
      disposed = true;
      off?.();
      unbindChannels();
      root.remove();
    },
  };
}
