import { Inject, Injectable, Optional } from '@nestjs/common';
import { accountClaimOpId, type Nep413Signature } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { AuthTokenService } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/index.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { IdentityPort } from '../application/ports/identity.port.js';

export interface ClaimAccountInputDto {
  readonly colonyId?: string;
  readonly walletAccountId?: string;
  readonly newPublicKey?: string;
  readonly signature?: Nep413Signature;
  readonly walletSignature?: Nep413Signature;
  readonly opId?: string;
  readonly playerId?: string;
}

export interface ClaimAccountResponse {
  readonly colonyId: string;
  readonly accountId: string;
  readonly claimedAt: string;
  readonly claimedByAccountId: string;
  readonly txHash: string;
}

export interface AccountClaimStatus {
  readonly claimed: boolean;
  readonly accountId: string;
  readonly claimedAt: string | null;
  readonly claimedByAccountId: string | null;
}

function sanitizeAccountStem(colonyId: string): string {
  const cleaned = colonyId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'col_0';
}

@Injectable()
export class AccountClaimService {
  private readonly claimedAccounts = new Map<string, ClaimAccountResponse>();

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(IdentityPort) private readonly identity: IdentityPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
  ) {}

  async claimColonyAccount(input: ClaimAccountInputDto): Promise<ClaimAccountResponse> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const colonyId = (input.colonyId ?? '').trim() || 'col_0';
    const stem = sanitizeAccountStem(colonyId);
    const sig = input.signature ?? input.walletSignature;
    const walletAccountId = input.walletAccountId?.trim() || sig?.accountId || `${stem}-wallet.terraagent.mock`;
    const walletPublicKey = input.newPublicKey?.trim() || sig?.publicKey || 'ed25519:mock-wallet-key';

    const { accountId, existingClaimedAt } = await this.resolveOrCreateColonyAccount({
      colonyId,
      stem,
      walletAccountId,
      walletPublicKey,
      playerId: input.playerId,
    });

    const opId = input.opId?.trim() || `${accountClaimOpId(colonyId)}:${walletAccountId}`;
    const receipt = await this.identity.claimAccount({
      opId,
      accountId,
      walletAccountId,
      walletPublicKey,
    });

    const priorMem = this.claimedAccounts.get(colonyId);
    const claimedAtDate =
      existingClaimedAt ?? (priorMem && priorMem.claimedByAccountId === walletAccountId ? new Date(priorMem.claimedAt) : new Date());
    const claimedAt = claimedAtDate.toISOString();

    if (this.db()) {
      await this.db()!.nearColonyAccount.updateMany({
        where: { accountId },
        data: { claimedAt: claimedAtDate, claimedByAccountId: walletAccountId },
      });
    }

    const response: ClaimAccountResponse = {
      colonyId,
      accountId,
      claimedAt,
      claimedByAccountId: walletAccountId,
      txHash: receipt.txHash,
    };
    this.claimedAccounts.set(colonyId, response);
    return response;
  }

  async isAccountClaimed(colonyId: string, accountId?: string): Promise<AccountClaimStatus> {
    const normColonyId = colonyId.trim() || 'col_0';
    const memByColony = this.claimedAccounts.get(normColonyId);
    if (memByColony) {
      return {
        claimed: true,
        accountId: memByColony.accountId,
        claimedAt: memByColony.claimedAt,
        claimedByAccountId: memByColony.claimedByAccountId,
      };
    }
    if (accountId) {
      for (const entry of this.claimedAccounts.values()) {
        if (entry.accountId === accountId) {
          return {
            claimed: true,
            accountId: entry.accountId,
            claimedAt: entry.claimedAt,
            claimedByAccountId: entry.claimedByAccountId,
          };
        }
      }
    }

    const prisma = this.db();
    if (prisma) {
      const row = await this.findColonyAccountRow(prisma, normColonyId, accountId);
      if (row) {
        return {
          claimed: row.claimedAt !== null,
          accountId: row.accountId,
          claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
          claimedByAccountId: row.claimedByAccountId ?? null,
        };
      }
    }

    const fallbackAccount = accountId ?? `${sanitizeAccountStem(normColonyId)}.pilot.terraagent.mock`;
    return { claimed: false, accountId: fallbackAccount, claimedAt: null, claimedByAccountId: null };
  }

  private db(): PrismaClient | null {
    return databaseEnabled(this.env) && this.prisma ? this.prisma : null;
  }

  private async findColonyAccountRow(prisma: PrismaClient, colonyId: string, accountId?: string) {
    if (accountId) {
      const byAccount = await prisma.nearColonyAccount.findUnique({ where: { accountId } });
      if (byAccount) return byAccount;
    }
    const byColony = await prisma.nearColonyAccount.findFirst({
      where: { OR: [{ colonyId }, { slot: colonyId }] },
    });
    if (byColony) return byColony;
    if (colonyId === 'col_0' || colonyId === '0') {
      return prisma.nearColonyAccount.findFirst({
        where: { slot: { notIn: ['player', 'system'] } },
        orderBy: { createdAt: 'asc' },
      });
    }
    return null;
  }

  private async resolveOrCreateColonyAccount(input: {
    colonyId: string;
    stem: string;
    walletAccountId: string;
    walletPublicKey: string;
    playerId?: string;
  }): Promise<{ accountId: string; existingClaimedAt: Date | null }> {
    const prisma = this.db();
    const defaultAccountId = `${input.stem}.pilot.terraagent.mock`;
    if (!prisma) {
      const mem = this.claimedAccounts.get(input.colonyId);
      return {
        accountId: mem?.accountId ?? defaultAccountId,
        existingClaimedAt: mem ? new Date(mem.claimedAt) : null,
      };
    }

    const existing = await this.findColonyAccountRow(prisma, input.colonyId);
    if (existing) {
      return { accountId: existing.accountId, existingClaimedAt: existing.claimedAt };
    }

    const deed = await prisma.deed.findUnique({ where: { colonyId: input.colonyId } });
    const resolvedAccountId = (deed?.accountId ?? defaultAccountId).replace(/[-_]{2,}/g, '-');
    const playerId = input.playerId ?? deed?.playerId ?? 'dev_pilot';
    await this.ensurePlayerRow(prisma, playerId);

    await prisma.mockChainAccount.upsert({
      where: { accountId: resolvedAccountId },
      create: { accountId: resolvedAccountId, kind: 'colony', publicKey: input.walletPublicKey },
      update: {},
    });

    const slot = input.colonyId.slice(0, 64);
    const byPlayerSlot = await prisma.nearColonyAccount.findUnique({
      where: { playerId_slot: { playerId, slot } },
    });
    if (byPlayerSlot) {
      return { accountId: byPlayerSlot.accountId, existingClaimedAt: byPlayerSlot.claimedAt };
    }

    const created = await prisma.nearColonyAccount.upsert({
      where: { accountId: resolvedAccountId },
      create: {
        accountId: resolvedAccountId,
        playerId,
        slot,
        colonyId: input.colonyId,
        ownerAccountId: input.walletAccountId,
        publicKey: input.walletPublicKey,
        encryptedSecret: 'mock',
        kekVersion: 1,
      },
      update: { colonyId: input.colonyId },
    });
    return { accountId: created.accountId, existingClaimedAt: created.claimedAt };
  }

  private async ensurePlayerRow(prisma: PrismaClient, playerId: string): Promise<void> {
    const found = await prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (found) return;
    const base = (playerId.trim() || 'dev_pilot').slice(0, 24);
    for (let n = 0; n < 5; n += 1) {
      const handle = n === 0 ? base : `${base}-${n + 1}`;
      try {
        await prisma.player.create({ data: { id: playerId, handle, deviceSecretHash: null } });
        return;
      } catch {
        if (await prisma.player.findUnique({ where: { id: playerId }, select: { id: true } })) return;
      }
    }
  }
}
