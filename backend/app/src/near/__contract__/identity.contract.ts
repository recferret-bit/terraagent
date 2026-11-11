import { expect } from 'vitest';
import { namedAccountOpId } from '@terra/contracts';
import type { IdentityPort } from '../application/ports/identity.port';
import { mockOauthSecret, signMockToken } from '../identity/mock-token';
import { defineNearContract } from './harness';

function googleToken(subject: string): string {
  const exp = Math.floor(Date.now() / 1000) + 120;
  return signMockToken({ provider: 'google', subject, exp }, mockOauthSecret());
}

/** Same claims as {@link googleToken}, with the first signature byte flipped. */
function tamperedGoogleToken(subject: string): string {
  const token = googleToken(subject);
  const dot = token.indexOf('.');
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  sig[0] = ((sig[0] ?? 0) ^ 0xff) & 0xff;
  return `${token.slice(0, dot)}.${sig.toString('base64url')}`;
}

/** Port contract for `IdentityPort`. Named accounts hit Postgres when the booted app has a database. */
export const contract = defineNearContract<IdentityPort>({
  port: 'Identity',
  helpers: () => ({}),
  suite: ({ test, expectReceipt }) => {
    test('loginSocial returns the mock subject as playerId', async ({ port }) => {
      const result = await port.loginSocial({ provider: 'google', token: googleToken('test-pilot') });
      expect(result.playerId).toBe('test-pilot');
    });

    test('a tampered token throws NEAR_PROVIDER_REJECTED', async ({ port }) => {
      const login = port.loginSocial({ provider: 'google', token: tamperedGoogleToken('test-pilot') });
      await expect(login).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });
    });

    test('createNamedAccount suffixes a taken name and replays the first opId', async (a) => {
      const uid = a.kind === 'mock' ? 'test-pilot' : `pilot-${Date.now().toString(36)}`;
      const suffix = a.kind === 'mock' ? 'terraagent.mock' : (process.env.NEAR_ROOT_ACCOUNT || 'terraagent.testnet');
      const firstOp = namedAccountOpId('google', `${uid}-a`);
      const first = await a.port.createNamedAccount({ opId: firstOp, name: uid });
      expect(first.accountId).toBe(`${uid}.${suffix}`);
      expectReceipt(first.receipt, a);

      const second = await a.port.createNamedAccount({ opId: namedAccountOpId('google', `${uid}-b`), name: uid });
      expect(second.accountId).toBe(`${uid}-2.${suffix}`);

      const replay = await a.port.createNamedAccount({ opId: firstOp, name: uid });
      expect(replay.accountId).toBe(first.accountId);
    });

    test('claimAccount throws NEAR_UNAVAILABLE', async ({ port }) => {
      let thrown: unknown;
      try {
        await port.claimAccount({
          opId: 'claim:test-pilot',
          accountId: 'test-pilot.terraagent.mock',
          walletAccountId: 'alice.near',
          walletPublicKey: 'ed25519:mock',
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
    });
  },
});
