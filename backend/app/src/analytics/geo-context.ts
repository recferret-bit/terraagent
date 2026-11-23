import { isIP } from 'node:net';

export interface AnalyticsRelayContext {
  readonly clientIp?: string;
  readonly countryCode?: string;
}

export interface GeoRequestLike {
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

const INVALID_COUNTRIES = new Set(['XX', 'T1', 'A1', 'A2']);
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-geoip-country', 'x-country-code'] as const;
const IP_HEADERS = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip'] as const;

let regionDisplay: Intl.DisplayNames | undefined;

function headerValue(headers: GeoRequestLike['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeIp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim().replace(/^"|"$/g, '');
  if (value.startsWith('[') && value.includes(']')) value = value.slice(1, value.indexOf(']'));
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));
  if (value.toLowerCase().startsWith('::ffff:')) value = value.slice(7);
  return isIP(value) ? value : undefined;
}

export function isPublicIp(raw: string | undefined): boolean {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return false;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return false;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff')) return false;
  return true;
}

export function normalizeCountryCode(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || INVALID_COUNTRIES.has(code)) return undefined;
  return code;
}

export function countryNameForCode(code: string | undefined): string | undefined {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return undefined;
  try {
    regionDisplay ??= new Intl.DisplayNames(['en'], { type: 'region' });
    const name = regionDisplay.of(normalized);
    return name && name !== normalized ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extracts transient country/IP hints from an incoming HTTP request strictly for in-memory PostHog GeoIP relay.
 * Never persisted in Postgres or written to logs. Private/loopback hops are discarded.
 */
export function extractGeoContext(req?: GeoRequestLike): AnalyticsRelayContext {
  if (!req) return {};
  let countryCode: string | undefined;
  for (const h of COUNTRY_HEADERS) {
    countryCode = normalizeCountryCode(headerValue(req.headers, h));
    if (countryCode) break;
  }

  const candidates: (string | undefined)[] = [];
  for (const h of IP_HEADERS) candidates.push(headerValue(req.headers, h));
  const forwarded = headerValue(req.headers, 'x-forwarded-for');
  if (forwarded) {
    for (const part of forwarded.split(',')) candidates.push(part);
  }
  candidates.push(req.ip, req.socket?.remoteAddress);

  let clientIp: string | undefined;
  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate);
    if (normalized && isPublicIp(normalized)) {
      clientIp = normalized;
      break;
    }
  }

  return {
    ...(clientIp ? { clientIp } : {}),
    ...(countryCode ? { countryCode } : {}),
  };
}
