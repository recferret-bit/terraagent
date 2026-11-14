const STANDALONE_DOC_HOSTS = new Set([
  'whitepaper.terraagent.fun',
  'pitchdeck.terraagent.fun',
  'design.terraagent.fun',
]);

/**
 * Resolves root-relative TerraAgent surface hrefs when rendered on a standalone
 * docs subdomain (`whitepaper`, `pitchdeck`, or `design`), while leaving local dev,
 * apex, same-subdomain paths, hash links, and external URLs untouched (`null`).
 */
export function resolveSubdomainHref(raw: string, hostname: string): string | null {
  if (!STANDALONE_DOC_HOSTS.has(hostname)) return null;

  if (raw === '/' || raw === '/landing.html') return 'https://terraagent.fun/';
  if (raw.startsWith('/landing.html#') || raw.startsWith('/landing.html?')) {
    return `https://terraagent.fun/${raw.slice('/landing.html'.length)}`;
  }

  if (raw === '/play.html') return 'https://play.terraagent.fun/';
  if (raw === '/me' || raw === '/me/') return 'https://play.terraagent.fun/me.html';
  if (raw.startsWith('/me?') || raw.startsWith('/me#')) {
    return `https://play.terraagent.fun/me.html${raw.slice('/me'.length)}`;
  }
  if (raw === '/deed' || raw === '/deed/') return 'https://play.terraagent.fun/deed.html';
  if (raw.startsWith('/deed?') || raw.startsWith('/deed#')) {
    return `https://play.terraagent.fun/deed.html${raw.slice('/deed'.length)}`;
  }
  if (raw === '/dev/economy-sim') return 'https://play.terraagent.fun/dev/economy-sim/';
  if (raw.startsWith('/dev/economy-sim?') || raw.startsWith('/dev/economy-sim#')) {
    return `https://play.terraagent.fun/dev/economy-sim/${raw.slice('/dev/economy-sim'.length)}`;
  }
  if (
    raw.startsWith('/play.html?') ||
    raw.startsWith('/play.html#') ||
    raw.startsWith('/trade.html') ||
    raw.startsWith('/me.html') ||
    raw.startsWith('/deed.html') ||
    raw.startsWith('/deed/') ||
    raw.startsWith('/dev/economy-sim/')
  ) {
    return `https://play.terraagent.fun${raw}`;
  }

  if (raw === '/dev/chain' || raw === '/dev/chain/' || raw === '/dev/chain/index.html') {
    return 'https://devchain.terraagent.fun/';
  }
  if (raw.startsWith('/dev/chain/')) {
    return `https://devchain.terraagent.fun${raw}`;
  }

  if (raw === '/playground.html') return 'https://playground.terraagent.fun/';
  if (raw.startsWith('/playground.html?') || raw.startsWith('/playground.html#')) {
    return `https://playground.terraagent.fun${raw}`;
  }

  if (raw === '/whitepaper' || raw === '/whitepaper/' || raw === '/whitepaper/index.html') {
    return hostname === 'whitepaper.terraagent.fun' ? null : 'https://whitepaper.terraagent.fun/';
  }
  if (raw.startsWith('/whitepaper/')) {
    return hostname === 'whitepaper.terraagent.fun'
      ? null
      : `https://whitepaper.terraagent.fun/${raw.slice('/whitepaper/'.length)}`;
  }

  if (raw === '/pitchdeck' || raw === '/pitchdeck/' || raw === '/pitchdeck/index.html') {
    return hostname === 'pitchdeck.terraagent.fun' ? null : 'https://pitchdeck.terraagent.fun/';
  }
  if (raw.startsWith('/pitchdeck/')) {
    return hostname === 'pitchdeck.terraagent.fun'
      ? null
      : `https://pitchdeck.terraagent.fun/${raw.slice('/pitchdeck/'.length)}`;
  }

  if (raw === '/design' || raw === '/design/' || raw === '/design/index.html') {
    return hostname === 'design.terraagent.fun' ? null : 'https://design.terraagent.fun/';
  }
  if (raw.startsWith('/design/')) {
    return hostname === 'design.terraagent.fun' ? null : `https://design.terraagent.fun${raw}`;
  }

  if (raw === '/v1/signature' || raw.startsWith('/v1/signature/')) {
    return `https://cloud-api.near.ai${raw}`;
  }
  if (raw.startsWith('/v1/')) return `https://api.terraagent.fun${raw}`;

  return null;
}

export function rewriteSubdomainLinks(
  root: ParentNode = document,
  hostname: string = typeof location !== 'undefined' ? location.hostname : '',
): void {
  if (!STANDALONE_DOC_HOSTS.has(hostname)) return;
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const raw = a.getAttribute('href');
    const next = raw ? resolveSubdomainHref(raw, hostname) : null;
    if (next) a.setAttribute('href', next);
  }
}
