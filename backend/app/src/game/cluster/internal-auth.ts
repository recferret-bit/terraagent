import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { ForbiddenException } from '@nestjs/common';
import type { AppEnv } from '../../core/tokens';

export const INTERNAL_HEADER = 'x-terra-internal-token';

export type InternalAuthEnv = Partial<Pick<AppEnv, 'JWT_ACCESS_SECRET' | 'NODE_ENV'>> & Record<string, unknown>;

export function resolveInternalSecret(env: InternalAuthEnv): string {
  const explicit = typeof env.TA_INTERNAL_SECRET === 'string' ? env.TA_INTERNAL_SECRET.trim() : '';
  if (explicit) return explicit;
  const jwt = typeof env.JWT_ACCESS_SECRET === 'string' ? env.JWT_ACCESS_SECRET.trim() : '';
  if (jwt) return `terra-internal:${jwt}`;
  const nodeEnv = String((env as { NODE_ENV?: unknown }).NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error('TA_INTERNAL_SECRET or JWT_ACCESS_SECRET must be set when NODE_ENV=production');
  }
  return 'terra-dev-internal';
}

export function internalAuthHeaders(env: InternalAuthEnv): Record<string, string> {
  return { [INTERNAL_HEADER]: resolveInternalSecret(env) };
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

export function isValidInternalAuth(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  env: InternalAuthEnv,
): boolean {
  const raw = headers[INTERNAL_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string' || !candidate) return false;
  return timingSafeEqual(sha256(candidate), sha256(resolveInternalSecret(env)));
}

export function assertInternalAuth(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  env: InternalAuthEnv,
): void {
  if (!isValidInternalAuth(headers, env)) {
    throw new ForbiddenException('Invalid internal cluster credentials');
  }
}
