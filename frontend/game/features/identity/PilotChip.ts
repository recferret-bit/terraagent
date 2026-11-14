import { isFastAuthPopupCancelled } from '../../../design/pilot/fastAuthSpa';
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
  const isMainnet = act.mode === 'mainnet';
  const netLabel = isMainnet ? 'Mainnet' : 'Testnet';
  const suffix = isMainnet ? 'near' : 'testnet';
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
    act.authIntent === 'signup' ? `Mint ${netLabel} Pilot (Email)` : 'Email / Passkey',
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
    makeBtn('btn btn-ghost btn-sm', 'continue-fastauth', `NEAR Auth (${netLabel} Wallet)`, act.fastAuth),
  );
  const hint = document.createElement('p');
  hint.className = 'ta-pilot__hint';
  hint.textContent =
    act.authIntent === 'signup'
      ? `Mints a gasless *.terraagent.${suffix} account or links a new NEAR ${netLabel} wallet.`
      : `Sign in via FastAuth (Google, X, Email) or NEP-413 ${netLabel} wallet.`;
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

function stripNearAccountSuffix(raw: string): string {
  return raw.trim().replace(/\.(?:(?:pilots\.)?terraagent\.(?:mock|testnet|near)|testnet|near)$/i, '');
}

function extractOpaquePilotCode(raw: string): string | null {
  const stem = stripNearAccountSuffix(raw);
  if (!stem) return null;

  const guestMatch = /^(?:guest|colonist)[|_-]+([a-z0-9]{4,})/i.exec(stem);
  if (guestMatch) {
    return guestMatch[1]!.slice(0, 4).toUpperCase();
  }

  const pilotCodeMatch = /^pilot[|_-]+([0-9a-f]{4,}|[a-z0-9]*\d[a-z0-9]*)(?:[|_-].*)?$/i.exec(stem);
  if (pilotCodeMatch) {
    return pilotCodeMatch[1]!.slice(0, 4).toUpperCase();
  }

  const oauthMatch =
    /^(?:(?:google[-_]?oauth2|twitter|oauth2|auth0|apple|windowslive|github|discord)[|_-]+|[a-z0-9_-]+\|)(.+)$/i.exec(
      stem,
    );
  if (oauthMatch) {
    const tokens = oauthMatch[1]!.split(/[^a-z0-9]+/i).filter(Boolean);
    const primary = tokens.find((t) => t.length >= 4) ?? tokens.join('');
    return (primary ? primary.slice(-4) : '0000').toUpperCase();
  }

  if (/^(?:pr[_-][a-z0-9]{6,}|[0-9a-f]{32,}|\d{10,})$/i.test(stem)) {
    return stem.slice(-4).toUpperCase();
  }

  return null;
}

/** Formats a clean, human-readable pilot display name from handle and NEAR accountId. */
export function formatPilotDisplayName(
  handleOrView: string | { readonly isGuest?: boolean; readonly handle?: string | null; readonly accountId?: string | null } | null | undefined,
  accountId?: string | null,
  isGuest = false,
): string {
  const rawHandle =
    typeof handleOrView === 'object' && handleOrView !== null ? handleOrView.handle : handleOrView;
  const rawAcct =
    typeof handleOrView === 'object' && handleOrView !== null ? handleOrView.accountId : accountId;
  const rawGuest =
    typeof handleOrView === 'object' && handleOrView !== null ? Boolean(handleOrView.isGuest) : isGuest;

  const cleanHandle = (rawHandle ?? '').trim();
  const cleanAcct = (rawAcct ?? '').trim();

  const handleCode = extractOpaquePilotCode(cleanHandle);
  const acctCode = extractOpaquePilotCode(cleanAcct);
  const acctStem = stripNearAccountSuffix(cleanAcct);
  const isGenericRoleHandle = /^(?:guest|colonist|pilot)$/i.test(cleanHandle);
  const hasHumanHandle =
    Boolean(cleanHandle) &&
    !handleCode &&
    !isGenericRoleHandle &&
    !/\.(?:(?:pilots\.)?terraagent\.(?:mock|testnet|near)|testnet|near)$/i.test(cleanHandle);
  const hasHumanAcct = Boolean(acctStem) && !acctCode && !/^(?:guest|colonist|pilot)$/i.test(acctStem);

  if (!hasHumanHandle && !hasHumanAcct) {
    const code = handleCode ?? acctCode;
    if (code) return `Pilot #${code}`;
    return rawGuest ? 'Guest Pilot' : 'Pilot';
  }

  const source = hasHumanHandle ? cleanHandle : acctStem;
  if (!source) return rawGuest ? 'Guest Pilot' : 'Pilot';
  if (source.includes(' ')) return source;
  return source
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Normalizes colony/neighbor labels that carry raw OAuth, guest, or NEAR account stems without altering custom colony names. */
export function formatColonyOrPilotName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return rawName;
  if (
    extractOpaquePilotCode(trimmed) !== null ||
    /\.(?:(?:pilots\.)?terraagent\.(?:mock|testnet|near)|testnet|near)$/i.test(trimmed)
  ) {
    return formatPilotDisplayName(trimmed);
  }
  return rawName;
}

function linkedLine(
  handle: string | undefined,
  accountId: string,
  clipboard: TextClipboard | undefined,
): HTMLElement {
  const line = makeDiv('ta-pilot__line');
  const displayName = formatPilotDisplayName(handle, accountId, false);
  const nameEl = makeSpan('ta-pilot__name', 'pilot-display-name', displayName);
  const id = makeSpan('ta-pilot__id', 'pilot-id', `Pilot ID ${accountId}`);
  id.title = accountId;
  const copy = makeBtn('btn btn-ghost btn-sm', 'pilot-copy', 'Copy', () => {
    void copyText(accountId, clipboard).then((result) => {
      copy.setAttribute('data-copied', result);
      if (result === 'fail') selectContents(id);
    });
  });
  line.append(nameEl, id, copy);
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

function buildPilotGuestActions(ctx: {
  getMode: () => 'mock' | 'testnet' | 'mainnet';
  getIntent: () => 'signin' | 'signup';
  setIntent: (intent: 'signin' | 'signup') => void;
  isBusy: () => boolean;
  setOpen: (v: boolean) => void;
  setFault: (msg: string) => void;
  setPopup: (pop: Window | null) => void;
  render: () => void;
  runLogin: (provider: AuthProviderKind, token: string, options?: { readonly mode?: 'signin' | 'signup' }) => void;
}): GuestActions {
  return {
    mode: ctx.getMode(),
    authIntent: ctx.getIntent(),
    setAuthIntent: (intent) => { ctx.setIntent(intent); ctx.render(); },
    save: () => { ctx.setOpen(true); ctx.render(); },
    google: () => {
      if (!ctx.isBusy()) ctx.setPopup(ctx.getMode() === 'mock' ? openMockProvider('google') : openFastAuthProvider('google', ctx.getIntent()));
    },
    x: () => {
      if (!ctx.isBusy()) ctx.setPopup(ctx.getMode() === 'mock' ? openMockProvider('x') : openFastAuthProvider('x', ctx.getIntent()));
    },
    fastAuth: () => {
      if (ctx.isBusy()) return;
      openNearWalletSelectorModal({
        initialMode: ctx.getIntent(),
        network: ctx.getMode() === 'mainnet' ? 'mainnet' : 'testnet',
        onPopupOpened: (pop) => { ctx.setPopup(pop); },
        onDirectToken: (hit) => { ctx.runLogin(hit.provider, hit.token); },
      });
    },
    email: (addr) => {
      const clean = addr.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
        ctx.setFault('Enter a valid email address.');
        ctx.setOpen(true);
        ctx.render();
        return;
      }
      ctx.runLogin('email', clean, ctx.getIntent() === 'signup' ? { mode: 'signup' } : undefined);
    },
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

  const runLogin = (
    provider: AuthProviderKind,
    token: string,
    options?: { readonly mode?: 'signin' | 'signup' },
  ): void => {
    if (!pilot || busy) return;
    busy = true;
    const call = options ? pilot.loginSocial(provider, token, options) : pilot.loginSocial(provider, token);
    void call
      .then(
        () => { fault = ''; },
        (err: unknown) => {
          if (isFastAuthPopupCancelled(err)) {
            fault = '';
          } else {
            fault = extractChipFault(err);
            open = true;
          }
        },
      )
      .finally(() => { busy = false; if (!disposed) render(); });
  };

  const render = (): void => {
    const view = pilot?.view();
    root.replaceChildren();
    if (view?.accountId && !view.isGuest) {
      root.append(linkedLine(view.handle, view.accountId, clipboard));
      return;
    }
    root.append(...guestNodes(open, fault, buildPilotGuestActions({
      getMode: () => mode,
      getIntent: () => authIntent,
      setIntent: (intent) => { authIntent = intent; },
      isBusy: () => busy,
      setOpen: (v) => { open = v; },
      setFault: (msg) => { fault = msg; },
      setPopup: (pop) => { popup = pop; },
      render,
      runLogin,
    })));
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
