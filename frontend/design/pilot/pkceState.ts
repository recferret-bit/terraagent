export const PKCE_STATE_STORAGE_KEY = 'ta_fastauth_pkce';

export interface StoredPkceState {
  readonly stateId: string;
  readonly provider: 'google' | 'x' | 'email';
  readonly verifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

/** Generates a CSPRNG URL-safe token (`A-Za-z0-9_-`) using Web Crypto `crypto.getRandomValues`. */
export function randomCryptoToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Resolves the Auth0 / FastAuth whitelisted `redirect_uri`:
 * - On production (`terraagent.fun`), `/` serves `landing.html` (`apex.conf`) and is the whitelisted callback URL.
 * - On local Vite dev (`127.0.0.1` / `localhost`), `/` serves static `index.html`, so `/` upgrades to `/landing.html`.
 */
export function resolveFastAuthRedirectUri(origin: string, returnPath: string): string {
  const parsedOrigin = new URL(origin);
  const isLocalHost = parsedOrigin.hostname === '127.0.0.1' || parsedOrigin.hostname === 'localhost';
  if (!isLocalHost) {
    return new URL('/', parsedOrigin.origin).toString();
  }
  const cleanPath = (returnPath || '/').split(/[?#]/)[0] || '/';
  const targetPath = cleanPath === '/' ? '/landing.html' : cleanPath;
  return new URL(targetPath, parsedOrigin.origin).toString();
}

export function savePkceState(entry: StoredPkceState): void {
  try {
    const raw = localStorage.getItem(PKCE_STATE_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as StoredPkceState[]) : [];
    const now = Date.now();
    const active = Array.isArray(list) ? list.filter((it) => it && it.expiresAt > now).slice(-7) : [];
    active.push(entry);
    localStorage.setItem(PKCE_STATE_STORAGE_KEY, JSON.stringify(active));
  } catch {
    /* ignore storage unavailable */
  }
}

export function consumePkceState(stateId: string): StoredPkceState | null {
  try {
    const raw = localStorage.getItem(PKCE_STATE_STORAGE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as StoredPkceState[];
    if (!Array.isArray(list)) return null;
    const now = Date.now();
    const match = list.find((it) => it?.stateId === stateId && it.expiresAt > now) ?? null;
    const remaining = list.filter((it) => it && it.stateId !== stateId && it.expiresAt > now);
    if (remaining.length > 0) {
      localStorage.setItem(PKCE_STATE_STORAGE_KEY, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(PKCE_STATE_STORAGE_KEY);
    }
    return match;
  } catch {
    return null;
  }
}
