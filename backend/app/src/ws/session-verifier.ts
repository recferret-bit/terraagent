import { createHash } from 'node:crypto';

/** Result of verifying a `hello.accessToken`. */
export interface VerifiedSession {
  readonly playerId: string;
}

/** Verifies the access token of a `hello` (WS-10). W00 uses `DevSessionVerifier`; W01 binds a JWT verifier to the same token. */
export interface SessionVerifier {
  /** Resolves with the session, or throws when the token is not acceptable. */
  verify(accessToken: string): Promise<VerifiedSession>;
}

export const SESSION_VERIFIER = Symbol('SESSION_VERIFIER');

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
    const m = DEV_TOKEN.exec(accessToken);
    if (!m) throw new Error('malformed dev session token');
    return { playerId: devPlayerId(m[1]!) };
  }
}
