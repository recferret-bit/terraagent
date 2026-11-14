import {
  NearAuthChallengeResponseSchema,
  NearAuthVerifyRequestSchema,
  type NearAuthChallengeRequest,
  type NearAuthChallengeResponse,
  type NearAuthVerifyRequest,
} from '@terra/contracts';

export const PENDING_NEP413_STORAGE_KEY = 'ta_nep413_pending';
export const RECENT_NEP413_POPUP_KEY = 'ta_nep413_popup_result';
const PENDING_TTL_MS = 5 * 60_000;
const POPUP_RESULT_TTL_MS = 60_000;
const JWT_EXPIRY_BUFFER_MS = 5_000;

/** Extracts the human-readable message from NestJS `{ error: { message } }` or `{ message }` JSON envelopes. */
export function extractAuthApiErrorMessage(errBody: unknown, fallback: string): string {
  if (errBody && typeof errBody === 'object') {
    const rec = errBody as { error?: { message?: unknown }; message?: unknown };
    if (rec.error && typeof rec.error === 'object' && typeof rec.error.message === 'string' && rec.error.message.trim()) {
      return rec.error.message.trim();
    }
    if (typeof rec.message === 'string' && rec.message.trim()) {
      return rec.message.trim();
    }
  }
  return fallback;
}

export interface PendingNep413Redirect {
  readonly challengeId: string;
  readonly callbackUrl: string;
  readonly walletId: string;
  readonly expiresAt: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToString(raw: string): string {
  const std = raw.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  const binary = atob(std + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Returns true when `token` is a 3-segment JWT with a numeric `exp` claim still in the future. */
export function jwtStillValid(token: string, nowMs = Date.now()): boolean {
  if (!token) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return false;
  try {
    const payload = JSON.parse(base64UrlToString(parts[1])) as { exp?: unknown };
    return (
      typeof payload.exp === 'number' &&
      Number.isFinite(payload.exp) &&
      payload.exp * 1000 > nowMs + JWT_EXPIRY_BUFFER_MS
    );
  } catch {
    return false;
  }
}

/** Reads a non-expired guest `accessToken` from `localStorage.getItem('ta_active_pilot')` for colony upgrade. */
export function readStoredGuestUpgradeBearer(nowMs = Date.now()): string {
  try {
    const raw = localStorage.getItem('ta_active_pilot');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { accessToken?: unknown; isGuest?: unknown; accountId?: unknown };
    const hasLinkedAccount = typeof parsed.accountId === 'string' && parsed.accountId.trim().length > 0;
    if (parsed.isGuest === false || hasLinkedAccount || typeof parsed.accessToken !== 'string') return '';
    const trimmed = parsed.accessToken.trim();
    return jwtStillValid(trimmed, nowMs) ? trimmed : '';
  } catch {
    return '';
  }
}

/** Encodes a verified NEP-413 payload into a `nep413:<base64url>` social token. */
export function encodeNep413SocialToken(payload: NearAuthVerifyRequest): string {
  const validated = NearAuthVerifyRequestSchema.parse(payload);
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(validated)));
  return `nep413:${encoded}`;
}

/** Decodes a `nep413:<base64url>` token back into a `NearAuthVerifyRequest` when valid. */
export function decodeNep413SocialToken(rawToken: string): NearAuthVerifyRequest | null {
  if (!rawToken.startsWith('nep413:')) return null;
  try {
    const parsed = JSON.parse(base64UrlToString(rawToken.slice('nep413:'.length))) as unknown;
    const res = NearAuthVerifyRequestSchema.safeParse(parsed);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

/** Requests a single-use 32-byte NEP-413 challenge from `POST /v1/auth/near/challenge`. */
export async function requestNearAuthChallenge(
  opts?: NearAuthChallengeRequest,
  doFetch: typeof fetch = fetch,
): Promise<NearAuthChallengeResponse> {
  const res = await doFetch('/v1/auth/near/challenge', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      extractAuthApiErrorMessage(errBody, 'Could not request NEAR Testnet sign-in challenge from server.'),
    );
  }
  return NearAuthChallengeResponseSchema.parse(await res.json());
}

function readPendingStore(): { get(key: string): string | null; set(key: string, val: string): void; remove(key: string): void } {
  return {
    get(key) {
      try {
        const fromLocal = localStorage.getItem(key);
        if (fromLocal !== null) return fromLocal;
      } catch { /* ignore */ }
      try { return sessionStorage.getItem(key); } catch { return null; }
    },
    set(key, val) {
      try { localStorage.setItem(key, val); return; } catch { /* fallback */ }
      try { sessionStorage.setItem(key, val); } catch { /* ignore */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

/** Saves the active NEP-413 challenge metadata in `localStorage` so popup/cross-window redirects (MyNearWallet) can verify `state`. */
export function savePendingNep413Redirect(entry: {
  readonly challengeId: string;
  readonly callbackUrl: string;
  readonly walletId: string;
  readonly expiresAt?: number;
}): void {
  const payload: PendingNep413Redirect = {
    challengeId: entry.challengeId,
    callbackUrl: entry.callbackUrl,
    walletId: entry.walletId,
    expiresAt: entry.expiresAt ?? Date.now() + PENDING_TTL_MS,
  };
  readPendingStore().set(PENDING_NEP413_STORAGE_KEY, JSON.stringify(payload));
}

/** Consumes a pending NEP-413 redirect record matching `stateId` (single-use). */
export function consumePendingNep413Redirect(stateId?: string): PendingNep413Redirect | null {
  const store = readPendingStore();
  try {
    const raw = store.get(PENDING_NEP413_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingNep413Redirect>;
    if (!parsed.challengeId || !parsed.callbackUrl || typeof parsed.expiresAt !== 'number') {
      store.remove(PENDING_NEP413_STORAGE_KEY);
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      store.remove(PENDING_NEP413_STORAGE_KEY);
      return null;
    }
    if (stateId && parsed.challengeId !== stateId) {
      return null;
    }
    store.remove(PENDING_NEP413_STORAGE_KEY);
    return {
      challengeId: parsed.challengeId,
      callbackUrl: parsed.callbackUrl,
      walletId: parsed.walletId ?? 'my-near-wallet',
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

/** Records a NEP-413 redirect result captured inside a MyNearWallet popup right before `window.close()`. */
export function saveRecentNep413PopupResult(payload: NearAuthVerifyRequest): void {
  readPendingStore().set(
    RECENT_NEP413_POPUP_KEY,
    JSON.stringify({ payload, expiresAt: Date.now() + POPUP_RESULT_TTL_MS }),
  );
}

/** Consumes a MyNearWallet popup redirect result matching `challengeId` if the popup closed via redirect instead of `postMessage`. */
export function consumeRecentNep413PopupResult(challengeId: string): NearAuthVerifyRequest | null {
  const store = readPendingStore();
  try {
    const raw = store.get(RECENT_NEP413_POPUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload?: unknown; expiresAt?: unknown };
    store.remove(RECENT_NEP413_POPUP_KEY);
    if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) return null;
    const checked = NearAuthVerifyRequestSchema.safeParse(parsed.payload);
    if (!checked.success || checked.data.challengeId !== challengeId) return null;
    return checked.data;
  } catch {
    return null;
  }
}
