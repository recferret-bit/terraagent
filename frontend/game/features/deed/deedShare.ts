export interface DeedTwitterIntentOptions {
  readonly tokenId: string;
  readonly colonyName?: string;
  readonly planetId?: string;
  readonly stage?: number;
  readonly terraformBp?: number;
  readonly settled?: boolean;
  readonly origin?: string;
}

function normalizeOrigin(origin?: string): string {
  if (!origin) return '';
  return origin.trim().replace(/\/+$/, '');
}

export function buildDeedSharePath(tokenId: string): string {
  const clean = tokenId.trim();
  if (!clean) {
    throw new Error('tokenId is required to build a deed share path');
  }
  return `/deed/${encodeURIComponent(clean)}`;
}

export function buildDeedShareUrl(tokenId: string, origin?: string): string {
  const prefix = normalizeOrigin(origin);
  const path = buildDeedSharePath(tokenId);
  return prefix ? `${prefix}${path}` : path;
}

export function buildDeedImageUrl(
  tokenId: string,
  version = 1,
  origin?: string,
): string {
  const clean = tokenId.trim();
  if (!clean) {
    throw new Error('tokenId is required to build a deed image URL');
  }
  const prefix = normalizeOrigin(origin);
  const v = Math.max(1, Math.trunc(version || 1));
  return `${prefix}/v1/near/deed/${encodeURIComponent(clean)}/image.png?v=${v}`;
}

export function buildDeedTwitterIntentText(
  opts: DeedTwitterIntentOptions,
): string {
  const name = opts.colonyName?.trim() || opts.tokenId.trim();
  const stage =
    typeof opts.stage === 'number' && Number.isFinite(opts.stage)
      ? Math.max(0, Math.min(10, Math.trunc(opts.stage)))
      : 0;
  const bp =
    typeof opts.terraformBp === 'number' && Number.isFinite(opts.terraformBp)
      ? Math.max(0, Math.min(10_000, Math.trunc(opts.terraformBp)))
      : 0;
  const pct = Math.round(bp / 100);
  const badge = opts.settled ? 'Settled Colony Deed' : 'Colony Deed';
  const planetPart = opts.planetId?.trim() ? ` on ${opts.planetId.trim()}` : '';
  return `${name}${planetPart} — Stage S${stage} ${badge} (${pct}% Terraformed) on TerraAgent #NEAR`;
}

export function buildDeedTwitterIntentUrl(
  opts: DeedTwitterIntentOptions,
): string {
  const shareUrl = buildDeedShareUrl(opts.tokenId, opts.origin);
  const text = buildDeedTwitterIntentText(opts);
  const params = new URLSearchParams({
    text,
    url: shareUrl,
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function extractDeedTokenIdFromLocation(loc?: {
  readonly pathname?: string;
  readonly search?: string;
}): string | null {
  const search = loc?.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (search) {
    const params = new URLSearchParams(search);
    const fromQuery = params.get('tokenId') ?? params.get('token') ?? params.get('id');
    if (fromQuery && fromQuery.trim().length > 0) {
      return fromQuery.trim();
    }
  }
  const pathname =
    loc?.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const match = /^\/(?:v1\/)?deed\/([^/?#]+)/.exec(pathname);
  if (match?.[1]) {
    try {
      const decoded = decodeURIComponent(match[1]).trim();
      return decoded.length > 0 ? decoded : null;
    } catch {
      return match[1].trim() || null;
    }
  }
  return null;
}
