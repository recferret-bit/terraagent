import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import type { AuthTokenService } from '../../../core/auth/index.js';
import { databaseEnabled } from '../../../core/persistence.js';
import type { AppEnv } from '../../../core/tokens.js';
import { NearException } from '../../domain/errors.js';
import { resolveOptionalBearerPlayerId } from '../../identity/colony-ownership.guard.js';
import { nearAdapterFor } from '../../infrastructure/adapter-selection.js';

/**
 * Proof that the caller controls the wallet `accountId` of a wallet-first staking action (`W28`).
 *
 * - Real networks: the NEP-413 `walletSignature` of that account, verified on chain by `verifyStakingWalletSignature`
 *   inside the service (a missing or foreign signature is `401` there), is the proof.
 * - Mock: no key exists to sign with, so the session must be the wallet's: a Bearer player that owns a `near_colony_account`
 *   row for the wallet (`accountId` / `ownerAccountId` / `claimedByAccountId`) or a linked `social_identity` account.
 *   No session is `401`, somebody else's wallet is `403` (`NEAR_NOT_OWNER`). This is what stops spoofing `accountId`.
 */
export class WalletControlGuard {
  constructor(
    private readonly tokens: AuthTokenService | undefined,
    private readonly env: AppEnv | undefined,
    private readonly prisma: PrismaClient | undefined,
  ) {}

  async assert(req: IncomingMessage, accountId: string): Promise<void> {
    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    if (nearAdapterFor('Staking', envMap) !== 'mock') return;
    const playerId = resolveOptionalBearerPlayerId(req, this.tokens, this.env);
    if (!playerId) {
      throw new NearException('NEAR_NOT_OWNER', { status: 401, message: 'Sign in with the wallet you stake from.' });
    }
    if (!(await this.controls(playerId, accountId))) {
      throw new NearException('NEAR_NOT_OWNER', { status: 403, message: 'Caller does not control this wallet' });
    }
  }

  /** `true` when `playerId` owns or has linked the wallet `accountId`. A strict deployment never reaches the mock branch. */
  async controls(playerId: string, accountId: string): Promise<boolean> {
    const db = this.prisma;
    if (!db || !(databaseEnabled(this.env) || !('$connect' in db))) return false;
    const [colonyRow, social] = await Promise.all([
      db.nearColonyAccount.findFirst({
        where: { playerId, OR: [{ accountId }, { ownerAccountId: accountId }, { claimedByAccountId: accountId }] },
        select: { accountId: true },
      }),
      db.socialIdentity.findFirst({ where: { playerId, accountId }, select: { id: true } }),
    ]);
    return Boolean(colonyRow || social);
  }
}
