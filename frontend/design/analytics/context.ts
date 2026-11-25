import { getCookie } from '../../game/core/analytics/browser';

export const ANALYTICS_SURFACES = ['landing', 'play', 'trade', 'me', 'whitepaper', 'pitchdeck', 'deed', 'hub', 'playground', 'design', 'not_found', 'probe'] as const;
export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];

const PATH_GROUPS = ['landing', 'play', 'trade', 'me', 'whitepaper', 'pitchdeck', 'deed', 'hub', 'playground', 'design', 'not_found'] as const;
const UTM_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

let bootedSurface: AnalyticsSurface | undefined;

export function rememberSurface(surface: AnalyticsSurface): void {
  bootedSurface = surface;
}

export function currentSurface(): AnalyticsSurface | undefined {
  return bootedSurface;
}

export function readConsentCookie(): 'allow' | 'decline' | 'unknown' {
  const value = getCookie('ta_consent');
  if (value === 'analytics:0') return 'decline';
  return 'allow';
}

export function globalPrivacyControl(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Cookieless ping label. Active by default; GPC or a legacy opt-out cookie forces decline. */
export function pingConsent(): 'allow' | 'decline' | 'unknown' {
  if (globalPrivacyControl()) return 'decline';
  return readConsentCookie();
}

export function runtimeLabel(): 'local' | 'prod' {
  if (typeof location === 'undefined') return 'prod';
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'local';
  if (new URLSearchParams(location.search).get('host') === 'local') return 'local';
  return 'prod';
}

export function viewportClass(): 'mobile' | 'desktop' {
  if (typeof matchMedia !== 'function') return 'desktop';
  return matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop';
}

export function referrerClass(referrer = typeof document !== 'undefined' ? document.referrer : ''): 'direct' | 'terraagent' | 'search' | 'social' | 'other' {
  if (!referrer) return 'direct';
  let host = '';
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { return 'other'; }
  if (host === 'terraagent.fun' || host.endsWith('.terraagent.fun') || host === 'terraagent.com' || host.endsWith('.terraagent.com')) return 'terraagent';
  if (isBrandHost(host, ['google', 'bing', 'duckduckgo', 'yahoo'])) return 'search';
  if (['x.com', 'twitter.com', 't.co', 'facebook.com', 'reddit.com', 'discord.com', 't.me'].some((d) => host === d || host.endsWith(`.${d}`))) return 'social';
  return 'other';
}

function isBrandHost(host: string, brands: readonly string[]): boolean {
  return brands.some((brand) => host === brand || host.startsWith(`${brand}.`) || host.includes(`.${brand}.`));
}

export function pathGroup(pathname: string, surface: string): string {
  const path = pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const knownSurface = (PATH_GROUPS as readonly string[]).includes(surface) ? surface : 'hub';
  if (path === '/') return knownSurface;
  if (surface === 'not_found') return 'not_found';
  for (const group of PATH_GROUPS) {
    if (path === `/${group}` || path.startsWith(`/${group}/`)) return group;
  }
  if (surface === 'design' && (path === '/foundations' || path === '/storybook' || path === '/motion')) return 'design';
  return 'other';
}

export function utmProps(search = typeof location !== 'undefined' ? location.search : ''): Record<string, string> {
  const q = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
    const value = q.get(key);
    if (value && UTM_TOKEN.test(value)) out[key] = value;
  }
  return out;
}

/** No-op in cookieless mode (never writes cookies or sessionStorage). */
export function noteFirstTouchSession(): void {
  // intentionally empty
}

/** `'1'` for direct/external entry onto TerraAgent, `'0'` for intra-site navigation (cookieless). */
export function firstTouchBit(referrer?: string): '0' | '1' {
  return referrerClass(referrer) === 'terraagent' ? '0' : '1';
}
