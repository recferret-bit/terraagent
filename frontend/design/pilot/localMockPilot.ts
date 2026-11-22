import {
  LOCAL_MOCK_PLAYER_NAME_MAX,
  LOCAL_MOCK_PLAYER_NAME_MIN,
  SocialAuthResponseSchema,
  validateLocalMockPlayerName,
  type SocialAuthResponse,
} from '@terra/contracts';
import { isProductionBuild } from '@terra/render/ui/buildEnv';
import { extractAuthApiErrorMessage } from './nearAuthApi';

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
let nextFieldSeq = 0;

const LOCAL_MOCK_CSS = `
.pilot-local-mock{display:flex;flex-direction:column;gap:6px;margin-top:var(--ta-s3);padding:var(--ta-s2);background:var(--ta-plate-2);border:1px dashed var(--ta-seam-3)}
.pilot-local-mock__eyebrow{font-family:var(--ta-font-mono);font-size:10px;letter-spacing:.1em;color:var(--ta-orange);text-transform:uppercase}
.pilot-local-mock label{display:block;font-size:var(--ta-fs-label);color:var(--ta-text-2)}
.pilot-local-mock input{width:100%;box-sizing:border-box}
.pilot-local-mock input[aria-invalid="true"],.pilot-local-mock input:user-invalid{border-color:var(--ta-fault);outline:1px solid var(--ta-fault)}
.pilot-local-mock input:focus-visible{outline:2px solid var(--ta-orange);outline-offset:2px}
.pilot-local-mock__hint{font-family:var(--ta-font-mono);font-size:10px;color:var(--ta-text-3);line-height:1.35}
.pilot-local-mock__err{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-fault-text);line-height:1.35}
.pilot-local-mock .btn{width:100%;justify-content:center}
`;

function ensureLocalMockStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('local-mock-pilot-css')) return;
  const style = document.createElement('style');
  style.id = 'local-mock-pilot-css';
  style.textContent = LOCAL_MOCK_CSS;
  document.head.appendChild(style);
}

/** True only for `localhost`, `127.0.0.1`, or `::1` (stripping optional `[...]` IPv6 brackets). */
export function isLocalhostHostname(hostname: string | undefined): boolean {
  if (typeof hostname !== 'string') return false;
  let clean = hostname.trim().toLowerCase();
  if (clean.startsWith('[') && clean.endsWith(']')) clean = clean.slice(1, -1);
  return LOCALHOST_NAMES.has(clean);
}

export interface LocalMockAuthEnvOptions {
  readonly location?: Pick<Location, 'hostname' | 'protocol' | 'search'>;
  readonly mode?: string;
  readonly prod?: boolean;
  readonly appEnv?: string;
  readonly localMockFlag?: string;
  readonly nearMode?: string;
}

/**
 * Fail-closed gate for the localhost mocked player-name field:
 * - Rejects production/staging builds (`isProductionBuild`)
 * - Rejects `VITE_LOCAL_MOCK_AUTH=false|0`
 * - Rejects `VITE_NEAR_MODE=mainnet`
 * - Requires `http:` or `https:` on `localhost`, `127.0.0.1`, or `::1`
 * - Rejects `?host=local` (no backend server)
 */
export function isLocalMockAuthEnabled(opts?: LocalMockAuthEnvOptions): boolean {
  if (isProductionBuild(opts?.mode, opts?.prod, opts?.appEnv)) return false;
  const metaEnv = (typeof import.meta !== 'undefined'
    ? (import.meta as { env?: Record<string, unknown> }).env
    : undefined) as Record<string, unknown> | undefined;
  const rawToggle = opts?.localMockFlag ?? metaEnv?.VITE_LOCAL_MOCK_AUTH;
  if (typeof rawToggle === 'string') {
    const t = rawToggle.trim().toLowerCase();
    if (t === 'false' || t === '0') return false;
  }
  const rawNearMode = opts?.nearMode ?? metaEnv?.VITE_NEAR_MODE;
  if (typeof rawNearMode === 'string' && rawNearMode.trim().toLowerCase() === 'mainnet') {
    return false;
  }
  const loc = opts?.location ?? (typeof location !== 'undefined' ? location : undefined);
  if (!loc) return false;
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return false;
  if (!isLocalhostHostname(loc.hostname)) return false;
  if (new URLSearchParams(loc.search).get('host') === 'local') return false;
  return true;
}

export type LocalMockFetchFn = (
  input: string,
  init?: RequestInit,
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export async function submitLocalMockLogin(params: {
  readonly playerName: string;
  readonly mode: 'signin' | 'signup';
  readonly upgradeBearer?: string;
  readonly fetchImpl?: LocalMockFetchFn;
  readonly allowOfflineLocalAuth?: boolean;
}): Promise<SocialAuthResponse> {
  const offlineOk = Boolean(params.allowOfflineLocalAuth && params.fetchImpl);
  if (!offlineOk && !isLocalMockAuthEnabled()) {
    throw new Error('Local mock sign-in is only available on localhost in development mode.');
  }
  const checked = validateLocalMockPlayerName(params.playerName);
  if (!checked.ok) {
    throw new Error(checked.message);
  }
  const doFetch: LocalMockFetchFn = params.fetchImpl ?? ((input, init) => fetch(input, init));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = params.upgradeBearer?.trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await doFetch('/v1/dev/mock-oauth/login', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ playerName: checked.value, mode: params.mode }),
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(extractAuthApiErrorMessage(errBody, 'Local mock sign-in failed. Please try again.'));
  }
  return SocialAuthResponseSchema.parse(await response.json());
}

export interface LocalMockPilotBoxOptions {
  readonly initialMode: 'signin' | 'signup';
  readonly getMode: () => 'signin' | 'signup';
  readonly getUpgradeBearer?: () => string;
  readonly isBusy?: () => boolean;
  readonly fetchImpl?: LocalMockFetchFn;
  readonly allowOfflineLocalAuth?: boolean;
  readonly onAuthenticated: (session: SocialAuthResponse) => void;
}

export interface LocalMockPilotBoxHandle {
  readonly el: HTMLFormElement;
  syncMode(mode: 'signin' | 'signup'): void;
}

function submitLabel(mode: 'signin' | 'signup'): string {
  return mode === 'signup' ? 'Mock Sign Up (Localhost)' : 'Mock Sign In (Localhost)';
}

function createLocalMockDom(initialMode: 'signin' | 'signup') {
  const seq = (nextFieldSeq += 1);
  const inputId = `local-mock-player-${seq}`;
  const hintId = `local-mock-hint-${seq}`;
  const errId = `local-mock-err-${seq}`;

  const form = document.createElement('form');
  form.className = 'pilot-local-mock';
  form.method = 'POST';
  form.action = '/v1/dev/mock-oauth/login';
  form.noValidate = true;
  form.dataset.testid = 'local-mock-pilot-form';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'pilot-local-mock__eyebrow';
  eyebrow.textContent = 'LOCALHOST MOCK · DEV ONLY';

  const label = document.createElement('label');
  label.className = 'label';
  label.htmlFor = inputId;
  label.append('Player name ', Object.assign(document.createElement('span'), { textContent: '*' }));
  label.lastElementChild?.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.id = inputId;
  input.name = 'playerName';
  input.type = 'text';
  input.className = 'input';
  input.required = true;
  input.minLength = LOCAL_MOCK_PLAYER_NAME_MIN;
  input.maxLength = LOCAL_MOCK_PLAYER_NAME_MAX;
  input.autocomplete = 'username';
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'none');
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.placeholder = 'Commander Nova';
  input.setAttribute('aria-describedby', `${hintId} ${errId}`);
  input.dataset.testid = 'local-mock-player-input';

  const hint = document.createElement('span');
  hint.id = hintId;
  hint.className = 'pilot-local-mock__hint';
  hint.textContent = `${LOCAL_MOCK_PLAYER_NAME_MIN}–${LOCAL_MOCK_PLAYER_NAME_MAX} chars · letters, digits, space, _ . -`;

  const errEl = document.createElement('span');
  errEl.id = errId;
  errEl.className = 'pilot-local-mock__err';
  errEl.setAttribute('role', 'status');
  errEl.setAttribute('aria-live', 'polite');
  errEl.dataset.testid = 'local-mock-player-error';
  errEl.hidden = true;

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-ghost btn-sm';
  submitBtn.dataset.testid = 'local-mock-player-submit';
  submitBtn.textContent = submitLabel(initialMode);

  form.append(eyebrow, label, input, hint, errEl, submitBtn);
  return { form, input, errEl, submitBtn };
}

/** Persists a `SocialAuthResponse` to `localStorage` when a dialog has no parent session handler. */
export function persistLocalMockSessionFallback(body: SocialAuthResponse): void {
  if (body.accessToken === 'local-mode-token') return;
  try {
    localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({
        playerId: body.player.id,
        accessToken: body.accessToken,
        updatedAt: Date.now(),
        isGuest: body.player.isGuest,
        handle: body.player.handle,
        accountId: body.accountId,
      }),
    );
    if (body.player.isGuest === false) {
      localStorage.setItem('ta_trade_token', body.accessToken);
    }
  } catch {
    /* ignore storage errors */
  }
}

/** Completes offline `?host=local` wallet-tile sign-in without hitting live NEP-413 challenge endpoints. */
export async function completeOfflineWalletLogin(params: {
  readonly walletLabel: string;
  readonly mode: 'signin' | 'signup';
  readonly fetchImpl: LocalMockFetchFn;
  readonly upgradeBearer?: string;
  readonly setBusy: (busy: boolean) => void;
  readonly onDone: (session: SocialAuthResponse) => void;
}): Promise<void> {
  const checked = validateLocalMockPlayerName(params.walletLabel);
  const playerName = checked.ok ? checked.value : 'Local Wallet';
  params.setBusy(true);
  try {
    const session = await submitLocalMockLogin({
      playerName,
      mode: params.mode,
      upgradeBearer: params.upgradeBearer,
      fetchImpl: params.fetchImpl,
      allowOfflineLocalAuth: true,
    });
    params.onDone(session);
  } finally {
    params.setBusy(false);
  }
}

/** Builds an accessible Faction-Plate form for localhost-only mocked player-name sign-in/up. */
export function buildLocalMockPilotBox(opts: LocalMockPilotBoxOptions): LocalMockPilotBoxHandle {
  ensureLocalMockStyles();
  const { form, input, errEl, submitBtn } = createLocalMockDom(opts.initialMode);
  let submitting = false;
  let touched = false;

  const showError = (message: string): void => {
    input.setAttribute('aria-invalid', 'true');
    errEl.textContent = message;
    errEl.hidden = false;
  };
  const clearError = (): void => {
    input.removeAttribute('aria-invalid');
    errEl.textContent = '';
    errEl.hidden = true;
  };

  input.addEventListener('input', () => {
    touched = true;
    clearError();
  });
  input.addEventListener('blur', () => {
    if (!touched && input.value.length === 0) return;
    const checked = validateLocalMockPlayerName(input.value);
    if (!checked.ok) showError(checked.message);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitting || opts.isBusy?.()) return;
    const checked = validateLocalMockPlayerName(input.value);
    if (!checked.ok) {
      showError(checked.message);
      input.focus();
      return;
    }
    clearError();
    submitting = true;
    submitBtn.disabled = true;
    void submitLocalMockLogin({
      playerName: checked.value,
      mode: opts.getMode(),
      upgradeBearer: opts.getUpgradeBearer?.(),
      fetchImpl: opts.fetchImpl,
      allowOfflineLocalAuth: opts.allowOfflineLocalAuth,
    })
      .then((session) => {
        clearError();
        opts.onAuthenticated(session);
      })
      .catch((err: unknown) => {
        showError(err instanceof Error && err.message ? err.message : 'Local mock sign-in failed.');
      })
      .finally(() => {
        submitting = false;
        submitBtn.disabled = false;
      });
  });

  return {
    el: form,
    syncMode(mode) {
      submitBtn.textContent = submitLabel(mode);
    },
  };
}
