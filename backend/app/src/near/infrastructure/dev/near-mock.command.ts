import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { AuthRepository } from '../../../core/auth/auth.repository.js';
import { CoreException } from '../../../core/errors/index.js';
import { PRISMA } from '../../../db/db.module.js';
import { defineDevCommand, type DevCommand, DevCommandRegistry } from '../../../dev/dev-command.registry.js';
import { NearException, type NearErrorCode } from '../../domain/errors.js';
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
  ) {}

  onModuleInit(): void {
    this.registry.register(this.failCommand());
    this.registry.register(this.latencyCommand());
    this.registry.register(this.resetCommand());
    this.registry.register(this.upgradeCommand());
    this.registry.register(this.errorCommand());
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
        // In-memory subject → player (BE-31). Does not write social_identity (W06-06).
        const exp = Math.floor(Date.now() / 1000) + 60;
        const token = signMockToken({ provider, subject, exp }, mockOauthSecret());
        const issued = await this.social.login({ provider, token });
        const { accessToken, player, accountId } = issued.response;
        return { playerId: player.id, accountId, accessToken };
      },
    });
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
