import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  DeedMetadataV1,
  newId,
  type DeedHexCoord,
  type DeedPlanetType,
  type DeedStatus,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { clearColonyGoals, getOpenColonyGoals, type PlanetState } from '@terra/sim';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { CoreException } from '../../core/errors/index.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { DeedRepository, type StoredDeedRecord } from './deed.repository.js';

export const TERRAFORM_STEP_BP = 1000;
export const TRADE_VOLUME_STEP = 100;

export interface DeedMilestonePatch {
  readonly colonyId: string;
  readonly planetId?: string;
  readonly stage?: number;
  readonly terraformBp?: number;
  readonly walls?: number;
  readonly tradeVolume?: number;
  readonly truces?: number;
  readonly rank?: number;
  readonly colonyName?: string;
  readonly planetType?: DeedPlanetType;
  readonly territoryHexes?: readonly DeedHexCoord[];
  readonly status?: DeedStatus;
  readonly settled?: boolean;
  readonly change: string;
  readonly forceImmediate?: boolean;
}

export type MilestoneQueuedListener = (
  colonyId: string,
  mergedPatch: DeedMilestonePatch,
  nextMetadata: DeedMetadataV1,
) => void | Promise<void>;

export interface DeedOwnershipTransferResult {
  readonly colonyId: string;
  readonly previousPlayerId: string | null;
  readonly newPlayerId: string;
  readonly newAccountId: string;
  readonly cancelledGoals: number;
}

export function quantizeTerraformBp(bp: number): number {
  const clamped = Math.min(10_000, Math.max(0, Math.floor(bp)));
  return Math.floor(clamped / TERRAFORM_STEP_BP) * TERRAFORM_STEP_BP;
}

export function quantizeTradeVolume(vol: number): number {
  const nonNeg = Math.max(0, Math.floor(vol));
  return Math.floor(nonNeg / TRADE_VOLUME_STEP) * TRADE_VOLUME_STEP;
}

/**
 * Subscribes to milestone events (`stageReached`, `tileStateChanged`, `tilePrepared`, `tradeSettled`, `truceSigned`)
 * and builds wave-gated `DeedMetadataV1` patches (W20-06, NEAR-91).
 * Fields whose producer wave is disabled (`W05`, `W08`, `W13`, `W14`, `W18`) are omitted from metadata.
 */
@Injectable()
export class DeedProjectorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeedProjectorService.name);
  private readonly stops: Array<() => void> = [];
  private readonly listeners = new Set<MilestoneQueuedListener>();
  private readonly queuedByColony = new Map<string, DeedMilestonePatch>();
  private readonly rawTradeVolumeByColony = new Map<string, number>();
  private readonly rawTerraformBpByColony = new Map<string, number>();
  private readonly ownerOverrides = new Map<string, { playerId: string; accountId: string }>();

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0 || !this.bus) return;
    this.stops.push(
      this.bus.on('planet.event', (ev) => this.onPlanetEvent(ev), {
        module: 'DeedProjectorService',
      }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  onMilestoneQueued(fn: MilestoneQueuedListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getQueuedMilestone(colonyId: string): DeedMilestonePatch | null {
    return this.queuedByColony.get(colonyId) ?? null;
  }

  clearQueuedMilestone(colonyId: string): void {
    this.queuedByColony.delete(colonyId);
  }

  /**
   * Filters metadata fields according to active wave flags:
   * - `stage`: requires `W08`
   * - `terraformBp`: requires `W05`
   * - `walls`: requires `W14` (omitted while W14 is postponed)
   * - `tradeVolume`: requires `W13`
   * - `truces`: requires `W18`
   */
  sanitizeMetadataForActiveWaves(meta: DeedMetadataV1): DeedMetadataV1 {
    const raw: Record<string, unknown> = {
      planet: meta.planet,
      colony: meta.colony,
      ...(meta.colonyName ? { colonyName: meta.colonyName } : {}),
      ...(meta.planetType ? { planetType: meta.planetType } : {}),
      ...(this.flags.has('W08') && meta.stage !== undefined ? { stage: meta.stage } : {}),
      ...(this.flags.has('W05') && meta.terraformBp !== undefined
        ? { terraformBp: meta.terraformBp }
        : {}),
      ...(this.flags.has('W14') && meta.walls !== undefined ? { walls: meta.walls } : {}),
      ...(this.flags.has('W13') && meta.tradeVolume !== undefined
        ? { tradeVolume: meta.tradeVolume }
        : {}),
      ...(this.flags.has('W18') && meta.truces !== undefined ? { truces: meta.truces } : {}),
      ...(meta.rank !== undefined ? { rank: meta.rank } : {}),
      ...(meta.territoryHexes ? { territoryHexes: meta.territoryHexes } : {}),
      status: meta.status,
      settled: meta.settled,
      version: meta.version,
      imageUrl: meta.imageUrl,
    };
    return DeedMetadataV1.parse(raw);
  }

  async projectMilestone(patch: DeedMilestonePatch): Promise<DeedMetadataV1 | null> {
    if (!this.flags.has('W20')) return null;
    const record = await this.resolveTargetDeed(patch.colonyId, patch.planetId);
    if (!record) return null;
    if (record.status === 'eliminated' || record.status === 'abandoned') return null;

    const prior = this.queuedByColony.get(record.colonyId);
    const merged: DeedMilestonePatch = {
      ...prior,
      ...patch,
      colonyId: record.colonyId,
      planetId: record.planetId,
      forceImmediate: Boolean(prior?.forceImmediate || patch.forceImmediate),
    };

    const nextVersion = record.metadataVersion + 1;
    const base = record.metadata;
    const candidate: DeedMetadataV1 = this.sanitizeMetadataForActiveWaves({
      ...base,
      ...(merged.colonyName !== undefined ? { colonyName: merged.colonyName } : {}),
      ...(merged.planetType !== undefined ? { planetType: merged.planetType } : {}),
      ...(merged.stage !== undefined ? { stage: merged.stage } : {}),
      ...(merged.terraformBp !== undefined ? { terraformBp: merged.terraformBp } : {}),
      ...(merged.walls !== undefined ? { walls: merged.walls } : {}),
      ...(merged.tradeVolume !== undefined ? { tradeVolume: merged.tradeVolume } : {}),
      ...(merged.truces !== undefined ? { truces: merged.truces } : {}),
      ...(merged.rank !== undefined ? { rank: merged.rank } : {}),
      ...(merged.territoryHexes !== undefined
        ? { territoryHexes: [...merged.territoryHexes] }
        : {}),
      status: merged.status ?? base.status,
      settled: merged.settled ?? base.settled,
      version: nextVersion,
      imageUrl: `/v1/near/deed/${encodeURIComponent(record.tokenId)}/image.png?v=${nextVersion}`,
    });

    if (!merged.forceImmediate && !this.hasMeaningfulChange(base, candidate)) {
      return null;
    }

    this.queuedByColony.set(record.colonyId, merged);
    record.pendingMilestone = merged as unknown as Record<string, unknown>;
    const db = this.database();
    if (db && 'deed' in db && db.deed) {
      await db.deed.update({
        where: { colonyId: record.colonyId },
        data: { pendingMilestone: merged as object },
      });
    }

    for (const fn of [...this.listeners]) {
      await fn(record.colonyId, merged, candidate);
    }
    return candidate;
  }

  /**
   * W08 follow-up gate: transfers colony deed ownership to a new player/account, cancels active HQ goals
   * of the previous owner so tutorial/goal state resumes cleanly for the new owner, and revokes the old owner's authority.
   */
  async transferDeedOwnership(input: {
    colonyId: string;
    newPlayerId: string;
    newAccountId: string;
    simState?: PlanetState;
    colonyIndex?: number;
  }): Promise<DeedOwnershipTransferResult> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const record = await this.deeds.findByColonyId(input.colonyId);
    if (!record) {
      throw new CoreException('DEED_NOT_FOUND', { status: 404, message: 'Deed not found' });
    }
    const previousPlayerId =
      this.ownerOverrides.get(record.colonyId)?.playerId ?? record.playerId;
    const colIdx = input.colonyIndex ?? 0;

    let cancelledGoals = 0;
    if (input.simState) {
      const open = getOpenColonyGoals(input.simState, colIdx);
      cancelledGoals = open.length;
      clearColonyGoals(input.simState, colIdx, input.simState.meta.tick);
    } else if (this.planets?.isLoaded(record.planetId)) {
      await this.planets.submit(record.planetId, {
        colonyIndex: colIdx,
        source: 'dev',
        commandId: newId('cm'),
        kind: 'dev.goal',
        args: { op: 'clear', colonyIndex: colIdx },
      });
    }

    record.playerId = input.newPlayerId;
    record.accountId = input.newAccountId;
    this.ownerOverrides.set(record.colonyId, {
      playerId: input.newPlayerId,
      accountId: input.newAccountId,
    });

    const db = this.database();
    if (db) {
      await db.deed.update({
        where: { colonyId: record.colonyId },
        data: { playerId: input.newPlayerId, accountId: input.newAccountId },
      });
      await db.colony.updateMany({
        where: { id: record.colonyId },
        data: { playerId: input.newPlayerId },
      });
    }

    return {
      colonyId: record.colonyId,
      previousPlayerId,
      newPlayerId: input.newPlayerId,
      newAccountId: input.newAccountId,
      cancelledGoals,
    };
  }

  /** Verifies `actorPlayerId` is the current owner of `colonyId` (rejects old owner after deed transfer). */
  async assertColonyGoalAuthority(colonyId: string, actorPlayerId: string): Promise<void> {
    const override = this.ownerOverrides.get(colonyId);
    const record = await this.deeds.findByColonyId(colonyId);
    const currentOwner = override?.playerId ?? record?.playerId;
    if (currentOwner && currentOwner !== actorPlayerId) {
      throw new CoreException('FORBIDDEN', {
        status: 403,
        message: `Player "${actorPlayerId}" no longer owns colony "${colonyId}"`,
      });
    }
  }

  private onPlanetEvent(event: PlanetEventV1): void {
    if (!this.flags.has('W20')) return;
    void this.handleEvent(event).catch((err: unknown) => {
      this.log.warn(
        `deed milestone projection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async handleEvent(event: PlanetEventV1 | { planetId: string; kind: string; colonyIds?: readonly string[]; data: Record<string, unknown> }): Promise<DeedMetadataV1 | null> {
    if (!this.flags.has('W20')) return null;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const colonyId = this.extractColonyId(event, data);
    if (!colonyId) return null;

    switch (event.kind) {
      case 'stageReached': {
        if (!this.flags.has('W08')) return null;
        const stage = Number(data.stage ?? 0);
        if (!Number.isFinite(stage)) return null;
        return this.projectMilestone({
          colonyId,
          planetId: event.planetId,
          stage,
          change: `Reached Stage S${stage}`,
        });
      }
      case 'tileStateChanged':
      case 'tilePrepared':
      case 'obstacleRemoved': {
        if (!this.flags.has('W05')) return null;
        const explicitBp = typeof data.terraformBp === 'number' ? data.terraformBp : undefined;
        const prevRaw = this.rawTerraformBpByColony.get(colonyId) ?? 0;
        const deltaBp = typeof data.deltaBp === 'number' ? data.deltaBp : 200;
        const nextRaw = explicitBp !== undefined ? explicitBp : Math.min(10_000, prevRaw + deltaBp);
        this.rawTerraformBpByColony.set(colonyId, nextRaw);
        const stepBp = quantizeTerraformBp(nextRaw);
        if (stepBp === 0 && explicitBp === undefined) return null;
        return this.projectMilestone({
          colonyId,
          planetId: event.planetId,
          terraformBp: stepBp,
          change: `Terraform ${Math.round(stepBp / 100)} %`,
        });
      }
      case 'tradeSettled': {
        if (!this.flags.has('W13')) return null;
        const rawDelta = Number(data.quoteTotal ?? data.qty ?? data.amount ?? 100);
        const prevVol = this.rawTradeVolumeByColony.get(colonyId) ?? 0;
        const nextVol = prevVol + (Number.isFinite(rawDelta) ? Math.max(0, rawDelta) : 100);
        this.rawTradeVolumeByColony.set(colonyId, nextVol);
        const quantized = quantizeTradeVolume(nextVol);
        if (quantized <= 0) return null;
        return this.projectMilestone({
          colonyId,
          planetId: event.planetId,
          tradeVolume: quantized,
          change: `Trade volume ${quantized}`,
        });
      }
      case 'truceSigned': {
        if (!this.flags.has('W18')) return null;
        const rec = await this.resolveTargetDeed(colonyId, event.planetId);
        const prevTruces =
          this.queuedByColony.get(rec?.colonyId ?? colonyId)?.truces ??
          rec?.metadata.truces ??
          0;
        const nextTruces = prevTruces + 1;
        return this.projectMilestone({
          colonyId,
          planetId: event.planetId,
          truces: nextTruces,
          change: `Truces signed: ${nextTruces}`,
        });
      }
      default:
        return null;
    }
  }

  private hasMeaningfulChange(prev: DeedMetadataV1, next: DeedMetadataV1): boolean {
    const prevQueued = this.queuedByColony.get(next.colony);
    const compareStage = prevQueued?.stage ?? prev.stage;
    const compareTf = prevQueued?.terraformBp ?? prev.terraformBp;
    const compareWalls = prevQueued?.walls ?? prev.walls;
    const compareTrade = prevQueued?.tradeVolume ?? prev.tradeVolume;
    const compareTruces = prevQueued?.truces ?? prev.truces;
    const compareRank = prevQueued?.rank ?? prev.rank;
    const compareStatus = prevQueued?.status ?? prev.status;
    const compareSettled = prevQueued?.settled ?? prev.settled;

    return (
      next.stage !== compareStage ||
      next.terraformBp !== compareTf ||
      next.walls !== compareWalls ||
      next.tradeVolume !== compareTrade ||
      next.truces !== compareTruces ||
      next.rank !== compareRank ||
      next.status !== compareStatus ||
      next.settled !== compareSettled
    );
  }

  private extractColonyId(
    event: { colonyIds?: readonly string[] },
    data: Record<string, unknown>,
  ): string | null {
    if (typeof data.colonyId === 'string' && data.colonyId.length > 0) return data.colonyId;
    if (typeof event.colonyIds?.[0] === 'string' && event.colonyIds[0].length > 0) {
      return event.colonyIds[0];
    }
    if (typeof data.colonyIndex === 'number' && Number.isFinite(data.colonyIndex)) {
      return `col_${data.colonyIndex}`;
    }
    return null;
  }

  private async resolveTargetDeed(
    colonyId: string,
    planetId?: string,
  ): Promise<StoredDeedRecord | null> {
    const direct = await this.deeds.findByColonyId(colonyId);
    if (direct) return direct;
    if (planetId) {
      const onPlanet = await this.deeds.listForPlayerOrColony({ planetId });
      if (onPlanet.length > 0) return onPlanet[0] ?? null;
    }
    if (colonyId === 'col_0' || colonyId === '0') {
      const all = await this.deeds.listAll();
      return all[0] ?? null;
    }
    return null;
  }

  private database(): PrismaClient | null {
    return this.env && databaseEnabled(this.env) && this.prisma ? this.prisma : null;
  }
}
