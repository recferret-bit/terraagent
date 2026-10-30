import type { AnalyticsDeps } from './client';

const DAY = 86_400;
const cookieAttrs = (maxAge: number) => `; Path=/; Max-Age=${maxAge}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
// Production shares the choice across subdomains (CLIENT §10.1); dev/localhost sets no Domain.
const domainAttr = () => (location.hostname.endsWith('terraagent.com') ? '; Domain=.terraagent.com' : '');

export function getCookie(name: string): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}
function setCookie(name: string, value: string, maxAge: number): void {
  document.cookie = `${name}=${value}${domainAttr()}${cookieAttrs(maxAge)}`;
}

export const browserDeps = (): AnalyticsDeps => ({
  readConsent: () => getCookie('ta_consent') === 'analytics:1',
  writeConsent: (allowed) => setCookie('ta_consent', allowed ? 'analytics:1' : 'analytics:0', 180 * DAY),
  anonId: () => {
    let id = getCookie('ta_aid');
    if (!id) {
      id = crypto.randomUUID();
      setCookie('ta_aid', id, 180 * DAY);
    }
    return id;
  },
  clearAnonId: () => setCookie('ta_aid', '', 0),
  newSessionId: () => crypto.randomUUID(),
  fetch: (url, init) => fetch(url, init),
  sendBeacon: (url, body) => navigator.sendBeacon(url, body),
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as number),
});
