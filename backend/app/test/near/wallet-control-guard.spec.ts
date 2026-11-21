import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { WalletControlGuard } from '../../src/near/staking/services/wallet-control.guard';

const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as unknown as IncomingMessage;
const env = (over: Record<string, string> = {}) => ({ NODE_ENV: 'test', ...over }) as unknown as AppEnv;

/** A DB double with no `$connect` (the colony guard's "mock prisma" test shape). */
function prisma(opts: { colony?: string[]; social?: string[]; player: string }) {
  return {
    nearColonyAccount: {
      findFirst: async ({ where }: { where: { playerId: string; OR: Array<Record<string, string>> } }) =>
        where.playerId === opts.player && where.OR.some((c) => Object.values(c).some((v) => opts.colony?.includes(v))) ? { accountId: 'x' } : null,
    },
    socialIdentity: {
      findFirst: async ({ where }: { where: { playerId: string; accountId: string } }) =>
        where.playerId === opts.player && opts.social?.includes(where.accountId) ? { id: 'si' } : null,
    },
  } as never;
}

const PLAYER = 'pr_dev_alice'; // devBearerPlayer('alice') is hashed; the guard only compares what the DB double says

describe('W28-04 WalletControlGuard (mock chain)', () => {
  it('rejects a request with no session (401) and an unknown dev token shape (401)', async () => {
    const guard = new WalletControlGuard(undefined, env(), prisma({ player: PLAYER, social: ['a.near'] }));
    await expect(guard.assert(req(), 'a.near')).rejects.toMatchObject({ status: 401, errorCode: 'NEAR_NOT_OWNER' });
    await expect(guard.assert(req('Bearer not-a-token'), 'a.near')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a session whose player did not link the wallet (403), accepts linked or colony-owned wallets', async () => {
    const { devPlayerId } = await import('../../src/ws/session-verifier');
    const alice = devPlayerId('alice');
    const guard = new WalletControlGuard(undefined, env(), prisma({ player: alice, social: ['alice.near'], colony: ['col.alice.near'] }));
    await expect(guard.assert(req('Bearer dev:alice'), 'alice.near')).resolves.toBeUndefined();
    await expect(guard.assert(req('Bearer dev:alice'), 'col.alice.near')).resolves.toBeUndefined();
    await expect(guard.assert(req('Bearer dev:alice'), 'bob.near')).rejects.toMatchObject({ status: 403, errorCode: 'NEAR_NOT_OWNER' });
    await expect(guard.assert(req('Bearer dev:mallory'), 'alice.near')).rejects.toMatchObject({ status: 403 });
  });

  it('denies everything when there is no database to prove the link', async () => {
    const guard = new WalletControlGuard(undefined, env(), undefined);
    expect(await guard.controls('pr_x', 'a.near')).toBe(false);
    await expect(guard.assert(req('Bearer dev:alice'), 'a.near')).rejects.toMatchObject({ status: 403 });
  });

  it('on a real network a signed action steps aside (the service verifies the NEP-413 signature)', async () => {
    const guard = new WalletControlGuard(undefined, env({ NEAR_MODE: 'testnet' }), undefined);
    await expect(guard.assert(req(), 'a.near')).resolves.toBeUndefined();
  });

  it('requireSession (the unsigned Patron nomination) demands the linked session on EVERY network', async () => {
    const { devPlayerId } = await import('../../src/ws/session-verifier');
    const alice = devPlayerId('alice');
    for (const mode of ['mock', 'testnet', 'mainnet']) {
      const guard = new WalletControlGuard(undefined, env({ NEAR_MODE: mode }), prisma({ player: alice, social: ['alice.near'] }));
      await expect(guard.assert(req(), 'alice.near', { requireSession: true })).rejects.toMatchObject({ status: 401 });
      await expect(guard.assert(req('Bearer dev:mallory'), 'alice.near', { requireSession: true })).rejects.toMatchObject({ status: 403 });
      await expect(guard.assert(req('Bearer dev:alice'), 'alice.near', { requireSession: true })).resolves.toBeUndefined();
    }
  });
});
