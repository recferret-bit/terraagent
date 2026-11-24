import type { IncomingMessage } from 'node:http';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { newId, type ClientMessageOf } from '@terra/contracts';
import { z } from 'zod';
import { SectorAntiCheatService } from '../core/anticheat';
import { CoreException } from '../core/errors';
import { SimClusterService } from '../game/cluster/sim-cluster.service';
import { GamePlanets } from '../game/game-planets.service';
import { COMMAND_INGRESS, type CommandIngress } from './command-ingress';
import { DEFAULT_HOME, HOME_PROVIDER, type HomeProvider } from './home-provider';
import { SESSION_VERIFIER, type SessionVerifier, type VerifiedSession } from './session-verifier';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

const HttpCommandBodySchema = z.strictObject({
  id: z.string().min(1).max(64).optional(),
  kind: z.string().min(1).max(64),
  args: z.unknown().optional(),
  sectorId: z.string().min(1).max(64).optional(),
  colonyId: z.string().min(1).max(64).optional(),
});

export interface HttpCommandResponse {
  readonly ok: true;
  readonly id: string;
  readonly appliedAtTick: number;
}

function statusForRejectCode(code: string): { status: number; errorCode: string } {
  switch (code) {
    case 'invalid_args':
    case 'unknown_kind':
      return { status: 400, errorCode: 'invalid_args' };
    case 'not_own_colony':
    case 'wave_disabled':
      return { status: 403, errorCode: 'NOT_OWN_COLONY' };
    case 'cross_sector_disabled':
      return { status: 403, errorCode: 'CROSS_SECTOR_DISABLED' };
    case 'not_own_territory':
      return { status: 403, errorCode: 'not_own_territory' };
    case 'unknown_entity':
    case 'unknown_task':
    case 'unknown_goal':
    case 'unknown_order':
      return { status: 404, errorCode: 'NOT_FOUND' };
    case 'rate_limited':
      return { status: 429, errorCode: 'RATE_LIMITED' };
    case 'host_unavailable':
    case 'market_unavailable':
      return { status: 503, errorCode: 'UNAVAILABLE' };
    default:
      return { status: 409, errorCode: code };
  }
}

/**
 * Authenticated HTTP gameplay command endpoint (`POST /v1/planets/:planetId/commands`).
 * Shares the exact same `SESSION_VERIFIER`, `SectorAntiCheatService` hash validator, and `CommandIngress`
 * pipeline as WebSocket `cmd` frames so HTTP and WebSockets enforce 1:1 planet, sector, and base anti-cheat.
 */
@Controller('planets')
export class HttpCommandController {
  constructor(
    @Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier,
    @Inject(COMMAND_INGRESS) private readonly ingress: CommandIngress,
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Optional() @Inject(HOME_PROVIDER) private readonly home?: HomeProvider,
    @Optional() @Inject(SectorAntiCheatService) private readonly antiCheat?: SectorAntiCheatService,
    @Optional() @Inject(SimClusterService) private readonly cluster?: SimClusterService,
  ) {}

  @Post(':planetId/commands')
  @HttpCode(200)
  async submitCommand(
    @Param('planetId') planetId: string,
    @Body() rawBody: unknown,
    @Req() req: IncomingMessage,
    @Headers('x-sector-id') sectorHeader?: string,
    @Headers('x-colony-id') colonyHeader?: string,
  ): Promise<HttpCommandResponse> {
    const session = await this.authenticate(req);
    const body = HttpCommandBodySchema.parse(rawBody ?? {});
    const available = this.planets.isLoaded(planetId) || Boolean(await this.cluster?.isAvailableAnywhere(planetId));
    if (!available) {
      throw new CoreException('NOT_YOUR_PLANET', {
        status: 403,
        message: `Planet ${planetId} is not loaded`,
        details: { code: 'not_your_planet', planetId },
      });
    }

    const requestedSectorId = (body.sectorId ?? sectorHeader)?.trim() || undefined;
    const requestedColonyId = (body.colonyId ?? colonyHeader)?.trim() || undefined;
    const isScenario = this.planets.isScenarioColonyPlanet(planetId);

    const { pinnedColonyId, pinnedSectorId, bindingHash } = await this.verifyHttpCommandAdmission(
      session,
      planetId,
      requestedSectorId,
      requestedColonyId,
      isScenario,
    );

    const commandId = body.id ?? newId('cm');
    const frame: ClientMessageOf<'cmd'> = {
      v: 1,
      t: 'cmd',
      id: commandId,
      d: { kind: body.kind, args: body.args ?? {} },
    };

    const reply = await new Promise<{ t: string; d: Record<string, unknown> }>((resolve, reject) => {
      Promise.resolve(
        this.ingress.handle(
          {
            transport: 'http',
            playerId: session.playerId,
            planetId,
            colonyId: pinnedColonyId,
            sectorId: pinnedSectorId,
            bindingHash,
            dev: session.dev === true,
            reply: (msg) => resolve(msg as { t: string; d: Record<string, unknown> }),
          },
          frame,
        ),
      ).catch(reject);
    });

    if (reply.t === 'cmd.ack') {
      return { ok: true, id: commandId, appliedAtTick: Number(reply.d.appliedAtTick ?? 0) };
    }
    const rejectCode = String(reply.d.code ?? 'internal');
    const detail = typeof reply.d.detail === 'string' && reply.d.detail ? reply.d.detail : rejectCode;
    const mapped = statusForRejectCode(rejectCode);
    throw new CoreException(mapped.errorCode, {
      status: mapped.status,
      message: detail,
      details: {
        code: rejectCode,
        ...(typeof reply.d.detail === 'string' ? { detail: reply.d.detail } : {}),
        ...(typeof reply.d.unlocksAt === 'string' ? { unlocksAt: reply.d.unlocksAt } : {}),
      },
    });
  }

  private async verifyHttpCommandAdmission(
    session: VerifiedSession,
    planetId: string,
    requestedSectorId: string | undefined,
    requestedColonyId: string | undefined,
    isScenarioPlanet: boolean,
  ): Promise<{ readonly pinnedColonyId: string | undefined; readonly pinnedSectorId: string | undefined; readonly bindingHash: string | undefined }> {
    if (!this.antiCheat) {
      return { pinnedColonyId: requestedColonyId, pinnedSectorId: requestedSectorId, bindingHash: undefined };
    }
    if (!this.antiCheat.index.getPlanet(planetId)?.syncedFromSim) {
      const full = await (this.cluster
        ? this.cluster.fullStateAnywhere(planetId, 2000)
        : this.planets.fullState(planetId, 2000)
      ).catch(() => null);
      if (full) this.antiCheat.syncFromSnapshotBytes(planetId, full.bytes);
    }
    const fastActiveOnTarget = this.antiCheat.index
      .listActiveBasesByPlayer(session.playerId)
      .find(
        (b) =>
          b.planetId === planetId &&
          (!requestedColonyId || b.colonyId === requestedColonyId) &&
          (!requestedSectorId || b.baseSectorId === requestedSectorId),
      );
    const fastTargetColony = requestedColonyId
      ? this.antiCheat.index.getColonyById(requestedColonyId)
      : undefined;
    const fastLatest = this.antiCheat.index.getLatestBindingByPlayer(session.playerId);
    const hasOtherActiveBase = this.antiCheat.index.listActiveBasesByPlayer(session.playerId).length > 0;
    const hasLiveTerminalOnTarget = Boolean(
      fastTargetColony
        ? fastTargetColony.planetId === planetId && fastTargetColony.terminalFromLive && fastTargetColony.status !== 'ACTIVE'
        : !hasOtherActiveBase &&
            fastLatest?.planetId === planetId &&
            fastLatest.terminalFromLive &&
            fastLatest.status !== 'ACTIVE' &&
            (!requestedSectorId || fastLatest.baseSectorId === requestedSectorId),
    );
    const effectiveHome =
      fastActiveOnTarget || hasLiveTerminalOnTarget ? undefined : await this.resolveEffectiveHome(session.playerId, planetId);

    const joinVerdict = await this.antiCheat.verifyJoin({
      transport: 'http',
      playerId: session.playerId,
      targetPlanetId: planetId,
      requestedSectorId,
      requestedColonyId,
      dev: session.dev === true,
      isScenarioPlanet,
      ...(effectiveHome ? { resolvedHome: effectiveHome } : {}),
      allowNewJoin: false,
    });
    if (!joinVerdict.ok) {
      throw new CoreException(joinVerdict.errorCode, {
        status: joinVerdict.httpStatus,
        message: joinVerdict.detail,
        details: { code: joinVerdict.reason, planetId },
      });
    }
    return {
      pinnedColonyId: joinVerdict.colonyId ?? requestedColonyId,
      pinnedSectorId: joinVerdict.sectorId,
      bindingHash: joinVerdict.bindingHash,
    };
  }

  private async authenticate(req: IncomingMessage): Promise<VerifiedSession> {
    const raw = req.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = typeof header === 'string' ? BEARER_RE.exec(header.trim())?.[1] : undefined;
    if (!token) {
      throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Missing Authorization Bearer header' });
    }
    try {
      const session = await this.verifier.verify(token);
      if (!session?.playerId) {
        throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Invalid access token' });
      }
      return session;
    } catch (e) {
      if (e instanceof CoreException) throw e;
      throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Invalid access token' });
    }
  }

  private async resolveEffectiveHome(playerId: string, planetId: string) {
    if (!this.home) return DEFAULT_HOME;
    try {
      const onTarget = await this.home.getHome(playerId, planetId);
      if (onTarget.state === 'ACTIVE') return onTarget;
      return await this.home.getHome(playerId);
    } catch {
      return DEFAULT_HOME;
    }
  }
}
