import { createHmac, randomBytes } from 'node:crypto';
import { extractGeoContext, normalizeIp, type GeoRequestLike } from './geo-context';

const PROCESS_FALLBACK_SALT = randomBytes(32).toString('hex');

function headerValue(headers: GeoRequestLike['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Honors browser Global Privacy Control (`Sec-GPC: 1`) on analytics intake and server commits. */
export function hasGpcHeader(req?: GeoRequestLike): boolean {
  return headerValue(req?.headers, 'sec-gpc') === '1';
}

function requestIp(req?: GeoRequestLike): string | undefined {
  if (!req) return undefined;
  const pub = extractGeoContext(req).clientIp;
  if (pub) return pub;
  const xff = headerValue(req.headers, 'x-forwarded-for')?.split(',')[0];
  for (const candidate of [headerValue(req.headers, 'x-real-ip'), xff, req.ip, req.socket?.remoteAddress]) {
    const ip = normalizeIp(candidate);
    if (ip) return ip;
  }
  return undefined;
}

function requestUserAgent(req?: GeoRequestLike): string | undefined {
  const ua = headerValue(req?.headers, 'user-agent');
  return ua ? ua.slice(0, 256) : undefined;
}

function bytesToUuid(bytes: Buffer): string {
  const b = Buffer.from(bytes.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Derives a daily-rotating cookieless UUID from transient client IP + User-Agent so same-day
 * cross-subdomain funnels stitch without storing any browser cookies. Rotates at UTC midnight;
 * raw IP and User-Agent are never persisted or logged. Returns `undefined` if neither is present.
 */
export function dailyCookielessId(req?: GeoRequestLike, salt?: string, now = new Date()): string | undefined {
  const ip = requestIp(req);
  const ua = requestUserAgent(req);
  if (!ip && !ua) return undefined;
  const key = `${salt?.trim() || PROCESS_FALLBACK_SALT}:${now.toISOString().slice(0, 10)}`;
  const digest = createHmac('sha256', key).update(`${ip ?? ''}\0${ua ?? ''}`).digest();
  return bytesToUuid(digest);
}
