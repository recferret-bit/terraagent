import { createHash } from 'node:crypto';
import type { AuthTokenService } from '../core/auth/auth-token.service';

/** Result of verifying a `hello.accessToken` or `reauth.accessToken`. */
export interface VerifiedSession {
  readonly playerId: string;
  readonly handle?: string;
  readonly exp?: number;
}

/** Verifies the access token of a `hello` or `reauth` (WS-10, LB-02). */
export interface SessionVerifier {
  /** Resolves with the session (or null), or throws when the token is not acceptable. */
  verify(accessToken: string): Promise<VerifiedSession | null>;
}

export const SESSION_VERIFIER = Symbol('SESSION_VERIFIER');

/** Thrown when a `dev:` token has a syntactically invalid name on initial `hello` (closes 4000 `bad_hello`). */
export class BadHelloTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadHelloTokenError';
  }
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const DEV_TOKEN = /^dev:([a-z0-9_-]{1,32})$/;

/** `pr_` + 26 Crockford chars derived from a sha256 of the name: the same name always maps to the same player. */
export function devPlayerId(name: string): string {
  const hash = createHash('sha256').update(`terra-dev-player:${name}`).digest();
  let s = '';
  for (let i = 0; i < 26; i++) s += ALPHABET[hash[i]! % 32];
  return `pr_${s}`;
}

/** W00 dev session: `dev:<name>` tokens, refused in production. */
export class DevSessionVerifier implements SessionVerifier {
  constructor(private readonly production: boolean) {}

  async verify(accessToken: string): Promise<VerifiedSession> {
    if (this.production) throw new Error('dev session tokens are disabled in production');
    if (accessToken === 'dev:expired') throw new Error('dev session token expired');
    const m = DEV_TOKEN.exec(accessToken);
    if (!m) throw new BadHelloTokenError('malformed dev session token');
    return { playerId: devPlayerId(m[1]!) };
  }
}

/**
 * W01-03 session verifier (WS-10): verifies HS256 access JWTs via `AuthTokenService`, while keeping W00's `dev:<name>`
 * shortcut in non-production so W00 unit/integration/e2e suites continue to work.
 */
export class JwtSessionVerifier implements SessionVerifier {
  private readonly dev: DevSessionVerifier;

  constructor(
    private readonly tokens: Pick<AuthTokenService, 'verify'>,
    private readonly production: boolean,
  ) {
    this.dev = new DevSessionVerifier(production);
  }

  async verify(accessToken: string): Promise<VerifiedSession | null> {
    if (!this.production && accessToken.startsWith('dev:')) {
      return this.dev.verify(accessToken);
    }
    if (this.production && accessToken.startsWith('dev:')) {
      throw new Error('dev session tokens are disabled in production');
    }
    return this.tokens.verify(accessToken);
  }
}
