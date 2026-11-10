import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AutoTradeLimits, DirectorKeyStatusPayload } from '@terra/contracts';
import { readAutoTradeLimits, restore } from '@terra/sim';
import type { IncomingMessage } from 'node:http';
import { EventBus } from '../../bus/event-bus.js';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import { AgentWalletPort, type KeyStatus } from '../application/ports/agent-wallet.port.js';
import { NearException } from '../domain/errors.js';
import {
  DIRECTOR_GAS_ALLOWANCE,
  DIRECTOR_METHODS,
  DIRECTOR_RECEIVER,
  mirrorAmounts,
  nextDirectorPublicKey,
  tokenCapsFromLimits,
  type DirectorTokenCap,
} from './director-key.allowance.js';
import { DirectorKeyRepository, type DirectorKeyRow, type OwnedColony } from './director-key.repository.js';
import { parseDirectorKeyBody, type DirectorKeyRequest } from './director-key.request.js';
import { directorStatusFromKey, type DirectorStatusBusEvent } from './director-key.status.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

/**
 * `POST` / `DELETE /v1/near/director-key` (W15-18).
 * Allowance is each autoTrade `maxPerSession`. Gas is `0` (BE-73). A second POST while active is idempotent.
 */
@Injectable()
export class DirectorKeyService {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AgentWalletPort) private readonly wallet: AgentWalletPort,
    @Inject(DirectorKeyRepository) private readonly repo: DirectorKeyRepository,
    @Inject(EventBus) private readonly bus: EventBus,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async add(req: IncomingMessage, raw: unknown): Promise<DirectorKeyStatusPayload> {
    const { playerId, body, colony } = await this.opened(req, raw);
    const caps = await this.capsFor(body, colony);
    const existing = await this.repo.find(colony.colonyId);
    if (existing && existing.revokedAt === null) return this.current(colony, existing);
    return this.createKey(colony, existing, caps);
  }

  async remove(req: IncomingMessage, raw: unknown): Promise<DirectorKeyStatusPayload> {
    const { body, colony } = await this.opened(req, raw);
    const existing = await this.repo.find(colony.colonyId);
    if (!existing) throw new CoreException('director_key_missing', { status: 404, message: 'No director key' });
    await this.wallet.revokeKey({
      opId: `director-key:revoke:${existing.accountId}:${existing.publicKey}`,
      accountId: existing.accountId,
      publicKey: existing.publicKey,
    });
    const status = await this.wallet.keyStatus({ accountId: existing.accountId, publicKey: existing.publicKey });
    await this.persist(colony.colonyId, existing.accountId, existing.publicKey, status, existing.revokedAt ?? new Date());
    return this.emit(colony, status);
  }

  private async opened(req: IncomingMessage, raw: unknown): Promise<{ playerId: string; body: DirectorKeyRequest; colony: OwnedColony }> {
    this.assertWave();
    const playerId = this.playerId(req);
    const body = parseDirectorKeyBody(raw);
    const colony = await this.repo.requireOwner(body.colonyId, playerId);
    return { playerId, body, colony };
  }

  private async capsFor(body: DirectorKeyRequest, colony: OwnedColony): Promise<DirectorTokenCap[]> {
    const limits = body.limits !== undefined ? body.limits : await this.blobLimits(colony);
    const caps = tokenCapsFromLimits(limits ?? {});
    if (caps.length === 0) {
      throw new CoreException('INVALID_REQUEST', { status: 400, message: 'autoTrade limits are empty' });
    }
    return caps;
  }

  private async createKey(colony: OwnedColony, existing: DirectorKeyRow | null, caps: DirectorTokenCap[]): Promise<DirectorKeyStatusPayload> {
    const publicKey = nextDirectorPublicKey(colony.colonyId, existing?.publicKey ?? null);
    const accountId = existing?.accountId ?? await this.repo.accountIdFor(colony.colonyId);
    await this.addOrKeep(accountId, publicKey, caps);
    const status = await this.wallet.keyStatus({ accountId, publicKey });
    if (status.revoked) {
      throw new CoreException('director_key_revoked', { status: 409, message: 'That director key is revoked' });
    }
    await this.persist(colony.colonyId, accountId, publicKey, status, null);
    return this.emit(colony, status);
  }

  private async addOrKeep(accountId: string, publicKey: string, caps: DirectorTokenCap[]): Promise<void> {
    try {
      await this.wallet.addLimitedKey({
        opId: `director-key:add:${accountId}:${publicKey}`,
        accountId,
        publicKey,
        allowance: DIRECTOR_GAS_ALLOWANCE,
        receiverId: DIRECTOR_RECEIVER,
        methodNames: DIRECTOR_METHODS,
        tokens: caps,
      });
    } catch (e) {
      if (!(e instanceof NearException) || e.errorCode !== 'NEAR_ACCOUNT_EXISTS') throw e;
    }
  }

  private async current(colony: OwnedColony, row: DirectorKeyRow): Promise<DirectorKeyStatusPayload> {
    const status = await this.wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    return this.emit(colony, status);
  }

  private async persist(colonyId: string, accountId: string, publicKey: string, status: KeyStatus, revokedAt: Date | null): Promise<void> {
    const mirror = mirrorAmounts(status.tokens);
    await this.repo.save({
      colonyId,
      accountId,
      publicKey,
      allowance: mirror.allowance,
      spent: mirror.spent,
      tokens: status.tokens,
      revokedAt,
    });
  }

  private emit(colony: OwnedColony, status: KeyStatus): DirectorKeyStatusPayload {
    const payload = directorStatusFromKey(colony.colonyId, status);
    const event: DirectorStatusBusEvent = { planetId: colony.planetId, playerId: colony.playerId, colonyId: colony.colonyId, payload };
    this.bus.emit('director.status', event);
    return payload;
  }

  private async blobLimits(colony: OwnedColony): Promise<AutoTradeLimits | undefined> {
    if (!this.planets?.isLoaded(colony.planetId)) return undefined;
    try {
      const full = await this.planets.fullState(colony.planetId);
      return readAutoTradeLimits(restore(full.bytes), colony.colonyIndex);
    } catch {
      return undefined;
    }
  }

  private assertWave(): void {
    if (!this.flags.has('W15')) {
      throw new CoreException('wave_disabled', { status: 403, message: 'Director keys are off', details: { code: 'wave_disabled' } });
    }
  }

  private playerId(req: IncomingMessage): string {
    const raw = req.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = typeof header === 'string' ? BEARER_RE.exec(header.trim())?.[1] : undefined;
    if (!token) throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Sign in required' });
    const dev = devBearerPlayer(token);
    if (dev) {
      if (this.env?.NODE_ENV === 'production') throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Sign in required' });
      return dev.id;
    }
    if (!this.tokens) throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Sign in required' });
    try {
      return extractBearerPlayer(req, this.tokens).id;
    } catch {
      throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Sign in required' });
    }
  }
}
