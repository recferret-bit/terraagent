import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { ResourceKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { AuthRepository } from '../../../core/auth/auth.repository.js';
import { CoreException } from '../../../core/errors/index.js';
import { PRISMA } from '../../../db/db.module.js';
import { defineDevCommand, type DevCommand, DevCommandRegistry } from '../../../dev/dev-command.registry.js';
import {
  CARGO_MINTER_ACCOUNT,
  CargoTokenPort,
  NEAR_ADAPTER_CARGO,
  toCargoBaseUnits,
  type MintCargoInput,
} from '../../application/ports/cargo-token.port.js';
import { NearException, type NearErrorCode } from '../../domain/errors.js';
import { CargoStatusService } from '../../cargo/cargo-status.service.js';
import { mockOauthSecret, signMockToken } from '../../identity/mock-token.js';
import { SocialAuthService } from '../../identity/social-auth.service.js';
import { mockChainControls } from '../mock/mock-controls.js';

const portSchema = z.string().min(1);

const failArgs = z.object({ port: portSchema, rate: z.number().min(0).max(1) }).strict();
const latencyArgs = z.object({
  port: portSchema,
  minMs: z.number().int().min(0),
  maxMs: z.number().int().min(0),
}).strict();
const resetArgs = z.object({ player: z.string().min(1) }).strict();
const upgradeArgs = z.object({
  provider: z.enum(['google', 'x']),
  subject: z.string().min(1).max(64),
}).strict();
const errorArgs = z.object({ code: z.string().min(1) }).strict();
const cargoGrantArgs = z.object({
  colony: z.union([z.string(), z.number()]),
  resource: ResourceKey,
  amount: z.number().int().positive(),
}).strict();

/** The four player-facing codes `near.error` may force. Anything else is 400 `VALIDATION_ERROR`. */
const PLAYER_NEAR_CODES = [
  'NEAR_PROVIDER_REJECTED',
  'NEAR_NAME_TAKEN',
  'NEAR_RELAY_FAILED',
  'NEAR_RELAY_RECEIVER_NOT_ALLOWED',
] as const satisfies readonly NearErrorCode[];

function playerNearCode(code: string): (typeof PLAYER_NEAR_CODES)[number] | undefined {
  for (const known of PLAYER_NEAR_CODES) if (known === code) return known;
  return undefined;
}

/** Dev console: per-port mock fail/latency, account reset and mock social upgrade, plus `near.error`. */
@Injectable()
export class NearMockCommand implements OnModuleInit {
  constructor(
    private readonly registry: DevCommandRegistry,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly authRepo: AuthRepository,
    private readonly social: SocialAuthService,
    @Optional() @Inject(NEAR_ADAPTER_CARGO) private readonly cargo?: CargoTokenPort,
    @Optional() @Inject(CargoStatusService) private readonly cargoStatus?: CargoStatusService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.failCommand());
    this.registry.register(this.latencyCommand());
    this.registry.register(this.resetCommand());
    this.registry.register(this.upgradeCommand());
    this.registry.register(this.errorCommand());
    this.registry.register(this.cargoGrantCommand());
  }

  private failCommand(): DevCommand<typeof failArgs> {
    return defineDevCommand({
      name: 'near.mock.fail',
      help: 'Set the mock fail rate (0..1) for one port. 0 forces success.',
      args: failArgs,
      run: ({ port, rate }) => {
        mockChainControls.setFail(port, rate);
        return { port, rate };
      },
    });
  }

  private latencyCommand(): DevCommand<typeof latencyArgs> {
    return defineDevCommand({
      name: 'near.mock.latency',
      help: 'Set the mock latency range in ms for one port (maxMs >= minMs, both >= 0).',
      args: latencyArgs,
      run: ({ port, minMs, maxMs }) => {
        if (maxMs < minMs) {
          throw new CoreException('VALIDATION_ERROR', { status: 400, message: `maxMs (${maxMs}) must be >= minMs (${minMs})` });
        }
        mockChainControls.setLatency(port, minMs, maxMs);
        return { port, minMs, maxMs };
      },
    });
  }

  private resetCommand(): DevCommand<typeof resetArgs> {
    return defineDevCommand({
      name: 'account.reset',
      help: 'Revoke sessions for a player id or handle, and drop their social rows. The player stays.',
      args: resetArgs,
      run: async ({ player }) => {
        const found = await this.findPlayer(player);
        const sessionsRevoked = await this.authRepo.revokeAllSessionsOfPlayer(found.id);
        const socialIdentities = await this.deleteSocialIdentities(found.id);
        return { playerId: found.id, handle: found.handle, sessionsRevoked, socialIdentities };
      },
    });
  }

  private errorCommand(): DevCommand<typeof errorArgs> {
    return defineDevCommand({
      name: 'near.error',
      help: 'Throw NEAR_PROVIDER_REJECTED, NEAR_NAME_TAKEN, NEAR_RELAY_FAILED, or NEAR_RELAY_RECEIVER_NOT_ALLOWED.',
      args: errorArgs,
      run: ({ code }) => {
        const known = playerNearCode(code);
        if (!known) {
          throw new CoreException('VALIDATION_ERROR', { status: 400, message: `Unknown NEAR error code "${code}"` });
        }
        throw new NearException(known);
      },
    });
  }

  private upgradeCommand(): DevCommand<typeof upgradeArgs> {
    return defineDevCommand({
      name: 'account.upgrade',
      help: 'Sign in a mock social subject (google or x) and return the player id.',
      args: upgradeArgs,
      run: async ({ provider, subject }) => {
        // Persists core.social_identity when the database is on (W06-06). The refresh token is not returned.
        const exp = Math.floor(Date.now() / 1000) + 60;
        const token = signMockToken({ provider, subject, exp }, mockOauthSecret());
        const issued = await this.social.login({ provider, token });
        const { accessToken, player, accountId } = issued.response;
        return { playerId: player.id, accountId, accessToken };
      },
    });
  }

  private cargoGrantCommand(): DevCommand<typeof cargoGrantArgs> {
    return defineDevCommand({
      name: 'cargo.grant',
      help: 'Grant cargo tokens to a colony on the mock chain.',
      args: cargoGrantArgs,
      run: async ({ colony, resource, amount }) => {
        const accountId = await this.resolveColonyAccountId(colony);
        if (!this.cargo) {
          throw new CoreException('VALIDATION_ERROR', { status: 400, message: 'Cargo token port not configured' });
        }
        const opId = `cargo-grant:${accountId}:${Date.now()}`;
        const res = await this.cargo.mint({
          opId,
          to: accountId,
          tokenId: resource,
          amount: toCargoBaseUnits(amount),
          by: CARGO_MINTER_ACCOUNT,
          caller: CARGO_MINTER_ACCOUNT,
        } as MintCargoInput);
        await this.cargoStatus?.pushColonyStatus(String(colony), undefined, undefined, accountId);
        return { colony: String(colony), accountId, resource, amount, txHash: res.txHash };
      },
    });
  }

  private async resolveColonyAccountId(colony: string | number): Promise<string> {
    const colonyStr = String(colony);
    if ('nearColonyAccount' in this.prisma && this.prisma.nearColonyAccount) {
      const found = await this.prisma.nearColonyAccount.findFirst({
        where: {
          OR: [{ colonyId: colonyStr }, { accountId: colonyStr }],
        },
      });
      if (found) return found.accountId;
      if (colonyStr === '0' || colonyStr === 'col-0') {
        const first = await this.prisma.nearColonyAccount.findFirst();
        if (first) return first.accountId;
      }
    }
    const fallback = `${colonyStr}.terraagent.mock`;
    if ('mockChainAccount' in this.prisma && this.prisma.mockChainAccount) {
      await this.prisma.mockChainAccount.upsert({
        where: { accountId: fallback },
        create: { accountId: fallback, kind: 'named' },
        update: {},
      });
    }
    return fallback;
  }

  private async findPlayer(player: string): Promise<{ id: string; handle: string }> {
    const byId = await this.prisma.player.findUnique({ where: { id: player } });
    const found = byId ?? await this.prisma.player.findUnique({ where: { handle: player } });
    if (!found) throw new CoreException('NOT_FOUND', { status: 404, message: `Unknown player "${player}"` });
    return found;
  }

  /** The model is on the Prisma client. Skip when a stand-in client has no delegate. */
  private async deleteSocialIdentities(playerId: string): Promise<number> {
    if (!('socialIdentity' in this.prisma) || !this.prisma.socialIdentity) return 0;
    const { count } = await this.prisma.socialIdentity.deleteMany({ where: { playerId } });
    return count;
  }
}
