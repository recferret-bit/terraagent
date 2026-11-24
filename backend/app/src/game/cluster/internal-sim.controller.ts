import type { IncomingMessage } from 'node:http';
import { Body, Controller, Get, Inject, NotFoundException, Optional, Param, Post, Req } from '@nestjs/common';
import type { SimCommandV1 } from '@terra/contracts';
import { ColonyAgentLoopService } from '../../ai/colony-agent/colony-agent-loop.service';
import { APP_ENV, type AppEnv } from '../../core/tokens';
import { GamePlanets, type CommandOutcomeMsg, type LoadOptions } from '../game-planets.service';
import type { LandingSiteAnswer } from '../thread/protocol';
import { SectorStateService } from '../persistence/sector-state.service';
import { SimLeaseService } from '../persistence/sim-lease.service';
import { SnapshotService } from '../persistence/snapshot.service';
import { assertInternalAuth } from './internal-auth';

/**
 * Worker-internal RPC endpoints invoked by sibling API pods (`TA_SIM_ROLE=api`) and non-owning replicas
 * over authenticated internal links to query state, submit commands, load/restore planets, and update modes.
 */
@Controller('internal/sim')
export class InternalSimController {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv & Record<string, unknown>,
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Inject(SnapshotService) private readonly snapshots: SnapshotService,
    @Optional() @Inject(SimLeaseService) private readonly simLease?: SimLeaseService,
    @Optional() @Inject(SectorStateService) private readonly sectorState?: SectorStateService,
    @Optional() @Inject(ColonyAgentLoopService) private readonly colonyAgentLoop?: ColonyAgentLoopService,
  ) {}

  @Get('planets/:planetId/full-state')
  async fullState(@Param('planetId') planetId: string, @Req() req: IncomingMessage) {
    assertInternalAuth(req.headers, this.env);
    if (!this.planets.isLoaded(planetId)) {
      throw new NotFoundException(`Planet ${planetId} not loaded on this worker`);
    }
    const full = await this.planets.fullState(planetId, 5_000);
    return {
      planetId: full.planetId,
      tick: full.tick,
      bytesBase64: Buffer.from(full.bytes).toString('base64'),
      simVersion: full.simVersion,
      dataHash: full.dataHash,
      planetType: full.planetType,
      warp: full.warp,
      ...(full.overrides ? { overrides: full.overrides } : {}),
    };
  }

  @Post('planets/:planetId/command')
  async submitCommand(
    @Param('planetId') planetId: string,
    @Body() body: { cmd: SimCommandV1 },
    @Req() req: IncomingMessage,
  ): Promise<CommandOutcomeMsg> {
    assertInternalAuth(req.headers, this.env);
    if (!this.planets.isLoaded(planetId)) {
      return { ok: false, commandId: body.cmd.commandId, code: 'planet_not_loaded' };
    }
    return this.planets.submit(planetId, body.cmd);
  }

  @Post('planets/:planetId/mode')
  setMode(
    @Param('planetId') planetId: string,
    @Body() body: { mode: 'active' | 'coarse' },
    @Req() req: IncomingMessage,
  ): { ok: boolean } {
    assertInternalAuth(req.headers, this.env);
    const mode = body.mode === 'coarse' ? 'coarse' : 'active';
    return { ok: this.planets.setMode(planetId, mode) };
  }

  @Post('planets/:planetId/load-new')
  async loadNew(
    @Param('planetId') planetId: string,
    @Body() opts: LoadOptions & { snapshotBase64?: string; scenarioSeats?: number[]; captureInitial?: boolean },
    @Req() req: IncomingMessage,
  ): Promise<{ hosted: boolean }> {
    assertInternalAuth(req.headers, this.env);
    if (opts?.snapshotBase64) {
      const { snapshotBase64, scenarioSeats, captureInitial, ...rest } = opts;
      if (!this.planets.isLoaded(planetId) && this.simLease && !(await this.simLease.tryAcquire(planetId))) {
        return { hosted: false };
      }
      if (scenarioSeats && scenarioSeats.length > 0) {
        this.planets.markScenarioColonyPlanet(planetId, scenarioSeats);
      }
      try {
        await this.planets.load(planetId, {
          ...rest,
          snapshot: new Uint8Array(Buffer.from(snapshotBase64, 'base64')),
        });
      } catch (err) {
        await this.simLease?.releasePlanet(planetId).catch(() => undefined);
        throw err;
      }
      if (!this.planets.isLoaded(planetId)) {
        await this.simLease?.releasePlanet(planetId).catch(() => undefined);
      } else {
        await this.simLease?.tryAcquire(planetId).catch(() => undefined);
        if (captureInitial) {
          this.planets.requestSectorSync(planetId);
          await this.snapshots.capture(planetId, 'SEAL', 5_000);
          await this.sectorState?.flushPlanet(planetId);
        }
      }
      return { hosted: this.planets.isLoaded(planetId) };
    }
    await this.snapshots.loadNew(planetId, opts ?? {});
    if (this.planets.isLoaded(planetId)) {
      await this.simLease?.tryAcquire(planetId).catch(() => undefined);
    }
    return { hosted: this.planets.isLoaded(planetId) };
  }

  @Post('planets/:planetId/wipe')
  async wipePlanet(
    @Param('planetId') planetId: string,
    @Req() req: IncomingMessage,
  ): Promise<{ wiped: boolean }> {
    assertInternalAuth(req.headers, this.env);
    this.colonyAgentLoop?.clearPlanetCache(planetId);
    await this.snapshots.wipeLoadedOrHeld(planetId);
    return { wiped: true };
  }

  @Post('planets/:planetId/load-home')
  async loadHome(
    @Param('planetId') planetId: string,
    @Body() body: { loadOptions?: LoadOptions; restoreOnly?: boolean },
    @Req() req: IncomingMessage,
  ): Promise<{ outcome: 'loaded' | 'restored' | 'generated' | 'absent'; hosted: boolean }> {
    assertInternalAuth(req.headers, this.env);
    const outcome = body.restoreOnly
      ? await this.snapshots.restoreIfPersisted(planetId)
      : await this.snapshots.loadHome(planetId, body.loadOptions ?? {});
    const hosted = this.planets.isLoaded(planetId);
    if (hosted) await this.simLease?.tryAcquire(planetId).catch(() => undefined);
    return { outcome, hosted };
  }

  @Post('planets/:planetId/landing-site')
  async landingSite(
    @Param('planetId') planetId: string,
    @Body() body: { loadOptions?: LoadOptions; colonyIndex: number; timeoutMs?: number; sectorId?: string },
    @Req() req: IncomingMessage,
  ): Promise<LandingSiteAnswer> {
    assertInternalAuth(req.headers, this.env);
    if (this.snapshots.loadHome) await this.snapshots.loadHome(planetId, body.loadOptions ?? {});
    else await this.snapshots.loadNew(planetId, body.loadOptions ?? {});
    if (this.planets.isLoaded(planetId)) {
      await this.simLease?.tryAcquire(planetId).catch(() => undefined);
    }
    return this.planets.landingSite(planetId, body.colonyIndex, body.timeoutMs ?? 15_000, body.sectorId);
  }
}
