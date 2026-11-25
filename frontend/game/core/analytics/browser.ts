import type { AnalyticsDeps } from './client';

let memAnonId: string | undefined;
let optedOut: boolean | undefined;

function isGpc(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return undefined;
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** Test-only reset for in-memory cookieless state across cases. */
export function resetBrowserAnalyticsForTest(): void {
  memAnonId = undefined;
  optedOut = undefined;
}

/** Cookieless by default: writes zero cookies/storage, honors GPC and legacy `ta_consent=analytics:0` opt-out. */
export const browserDeps = (): AnalyticsDeps => ({
  readConsent: () => !isGpc() && optedOut !== true && getCookie('ta_consent') !== 'analytics:0',
  writeConsent: (allowed) => {
    optedOut = !allowed;
    if (!allowed) memAnonId = undefined;
  },
  anonId: () => {
    memAnonId ??= crypto.randomUUID();
    return memAnonId;
  },
  clearAnonId: () => {
    memAnonId = undefined;
  },
  newSessionId: () => crypto.randomUUID(),
  fetch: (url, init) => fetch(url, init),
  sendBeacon: (url, body) => navigator.sendBeacon(url, body),
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as number),
});
