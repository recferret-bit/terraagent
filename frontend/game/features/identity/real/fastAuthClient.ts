import { Auth0Client } from '@auth0/auth0-spa-js';

export const FASTAUTH_TESTNET_DOMAIN = 'login.testnet.fast-auth.com';
export const FASTAUTH_TESTNET_CLIENT_ID = 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl';

export interface FastAuthPopupResult {
  readonly rawIdToken: string;
  readonly email: string | null;
}

let cachedClient: Auth0Client | null = null;

function getAuth0Client(): Auth0Client {
  if (!cachedClient) {
    cachedClient = new Auth0Client({
      domain: FASTAUTH_TESTNET_DOMAIN,
      clientId: FASTAUTH_TESTNET_CLIENT_ID,
      authorizationParams: {
        redirect_uri: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
        scope: 'openid profile email',
      },
    });
  }
  return cachedClient;
}

/** Opens the NEAR FastAuth (Auth0 testnet) popup and returns the signed RS256 ID token. */
export async function loginWithFastAuthPopup(): Promise<FastAuthPopupResult> {
  const client = getAuth0Client();
  await client.loginWithPopup();
  const claims = await client.getIdTokenClaims();
  const rawIdToken = claims?.__raw;
  if (!rawIdToken) {
    throw new Error('NEAR FastAuth popup completed without an ID token.');
  }
  return { rawIdToken, email: typeof claims.email === 'string' ? claims.email : null };
}

/** Queries `/v1/near/status` to check whether `IdentityPort` runs against `mock`, `testnet`, or `mainnet`. */
export async function probeIdentityAdapterMode(
  fetchImpl: typeof fetch | undefined = globalThis.fetch,
): Promise<'mock' | 'testnet' | 'mainnet'> {
  if (typeof fetchImpl !== 'function') return 'mock';
  try {
    const res = await fetchImpl('/v1/near/status', { headers: { accept: 'application/json' } });
    if (!res.ok) return 'mock';
    const body = (await res.json()) as {
      ports?: ReadonlyArray<{ port?: string; mode?: string }>;
    };
    const identityPort = body.ports?.find((p) => p.port === 'Identity');
    if (identityPort?.mode === 'testnet' || identityPort?.mode === 'mainnet') {
      return identityPort.mode;
    }
    return 'mock';
  } catch {
    return 'mock';
  }
}
