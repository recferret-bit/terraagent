import type { IncomingMessage } from 'node:http';
import { parseWaves } from '@terra/contracts';
import { AuthTokenService, extractBearerPlayer } from '../core/auth/index.js';
import { CoreException, CoreUnauthorized } from '../core/errors/index.js';
import { FlagsService } from '../flags/flags.service.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;
const DEV_TOKEN_RE = /^dev:([a-z0-9_-]{1,32})$/i;
const PLAYER_TOKEN_RE = /^player:([a-z0-9_-]{1,64})$/i;
const AS_NAME_RE = /^[a-z0-9_-]{1,32}$/i;
const PLAYER_ID_RE = /^[a-z0-9_-]{1,64}$/i;

export interface ResolvedMePlayer {
  readonly id: string;
  readonly handle: string;
  readonly isGuest: boolean;
}

function extractBearerToken(req: IncomingMessage): string | undefined {
  const raw = req.headers?.authorization ?? (req.headers as Record<string, unknown> | undefined)?.Authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return undefined;
  const match = BEARER_RE.exec(header.trim());
  return match?.[1];
}

function extractQueryParam(urlStr: string | undefined, key: string): string | undefined {
  if (!urlStr) return undefined;
  const qIdx = urlStr.indexOf('?');
  if (qIdx === -1) return undefined;
  try {
    const params = new URLSearchParams(urlStr.slice(qIdx));
    return params.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the authenticated player for `/me/*` routes (W12-12).
 * Refuses requests with `wave_disabled` when W12 is inactive.
 * In non-production, supports `Bearer dev:<name>` and `?as=<name>` fallback.
 */
export function resolveMePlayer(
  req: IncomingMessage,
  tokens: AuthTokenService,
  flags: FlagsService,
  production = false,
): ResolvedMePlayer {
  if (!flags.has('W12')) {
    throw new CoreException('wave_disabled', {
      status: 403,
      message: 'Player page is off',
      details: { code: 'wave_disabled' },
    });
  }

  if (!production) {
    const wavesParam = extractQueryParam(req.url, 'waves');
    if (wavesParam) {
      try {
        if (!parseWaves(wavesParam).has('W12')) {
          throw new CoreException('wave_disabled', {
            status: 403,
            message: 'Player page is off',
            details: { code: 'wave_disabled' },
          });
        }
      } catch (e) {
        if (e instanceof CoreException) throw e;
      }
    }
  }

  const bearerToken = extractBearerToken(req);

  try {
    const player = extractBearerPlayer(req, tokens);
    return { id: player.id, handle: player.handle, isGuest: false };
  } catch (err) {
    if (!production) {
      if (bearerToken) {
        const pm = PLAYER_TOKEN_RE.exec(bearerToken);
        if (pm?.[1]) {
          return { id: pm[1], handle: 'pilot', isGuest: true };
        }
        const m = DEV_TOKEN_RE.exec(bearerToken);
        if (m?.[1]) {
          const name = m[1].toLowerCase();
          return { id: `pr_dev_${name}`, handle: name, isGuest: true };
        }
      }
      const queryPlayerId = extractQueryParam(req.url, 'playerId');
      if (queryPlayerId && PLAYER_ID_RE.test(queryPlayerId)) {
        return { id: queryPlayerId, handle: 'pilot', isGuest: true };
      }
      const asName = extractQueryParam(req.url, 'as');
      if (asName && AS_NAME_RE.test(asName)) {
        const name = asName.toLowerCase();
        return { id: `pr_dev_${name}`, handle: name, isGuest: true };
      }
    }

    if (err instanceof CoreUnauthorized) throw err;
    throw new CoreUnauthorized('UNAUTHORIZED', {
      message: err instanceof Error ? err.message : 'Unauthorized',
      cause: err,
    });
  }
}
