import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { DiplomacyBondToken } from '@terra/contracts';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { FlagsService } from '../../flags/flags.service.js';
import { DiplomacyEscrowService } from './diplomacy-escrow.service.js';

@Injectable()
export class DiplomacyEscrowListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DiplomacyEscrowListener.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    @Inject(DiplomacyEscrowService) private readonly escrows: DiplomacyEscrowService,
    @Inject(FlagsService) private readonly flags: { has(wave: string): boolean },
  ) {}

  onModuleInit(): void {
    if (this.stop) return;
    this.stop = this.bus.on('planet.event', (event) => this.onPlanet(event), {
      module: 'DiplomacyEscrowListener',
    });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private onPlanet(event: PlanetEventV1): void {
    if (!this.flags.has('W22')) return;
    const job = this.follow(event);
    if (job) {
      void job.catch((err: unknown) => {
        this.log.warn(`diplomacy escrow (${event.kind}) failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private follow(event: PlanetEventV1): Promise<unknown> | null {
    if (event.kind === 'truceSigned') return this.onTruceSigned(event);
    if (event.kind === 'truceEnded') return this.onTruceEnded(event);
    if (event.kind === 'warDeclared') return this.onWarDeclared(event);
    if (event.kind === 'warEnded') return this.onWarEnded(event);
    return null;
  }

  private onTruceSigned(event: PlanetEventV1): Promise<unknown> | null {
    const data = event.data as Record<string, unknown>;
    const bondAmount = Number(data.bondAmount ?? 0);
    if (!Number.isFinite(bondAmount) || bondAmount <= 0) return null;
    const truceId = String(data.truceId ?? '');
    if (!truceId) return null;
    const colonyAIndex = typeof data.colonyAIndex === 'number' ? data.colonyAIndex : numberOrUndef(data.colonyA);
    const colonyBIndex = typeof data.colonyBIndex === 'number' ? data.colonyBIndex : numberOrUndef(data.colonyB);
    const colonyAId = colonyIdString(data.colonyA, colonyAIndex, event.colonyIds[0]);
    const colonyBId = colonyIdString(data.colonyB, colonyBIndex, event.colonyIds[1]);
    const bondToken = (typeof data.bondToken === 'string' ? data.bondToken : 'NEAR') as DiplomacyBondToken;
    return this.escrows.openTruceBonds({
      planetId: event.planetId,
      truceId,
      colonyAId,
      colonyBId,
      colonyAIndex,
      colonyBIndex,
      bondToken,
      bondAmount,
    });
  }

  private onTruceEnded(event: PlanetEventV1): Promise<unknown> | null {
    const data = event.data as Record<string, unknown>;
    const bondAmount = Number(data.bondAmount ?? 0);
    if (!Number.isFinite(bondAmount) || bondAmount <= 0) return null;
    const truceId = String(data.truceId ?? '');
    const reason = data.reason as 'expired' | 'cancelled' | 'settled' | 'eliminated' | undefined;
    if (!truceId || !reason) return null;
    const colonyAIndex = typeof data.colonyAIndex === 'number' ? data.colonyAIndex : numberOrUndef(data.colonyA);
    const colonyBIndex = typeof data.colonyBIndex === 'number' ? data.colonyBIndex : numberOrUndef(data.colonyB);
    const colonyAId = colonyIdString(data.colonyA, colonyAIndex, event.colonyIds[0]);
    const colonyBId = colonyIdString(data.colonyB, colonyBIndex, event.colonyIds[1]);
    return this.escrows.settleTruceBonds({
      planetId: event.planetId,
      truceId,
      colonyAId,
      colonyBId,
      colonyAIndex,
      colonyBIndex,
      reason,
      cancelledBy: data.cancelledBy as string | number | undefined,
      cancelledByColony: typeof data.cancelledByColony === 'number' ? data.cancelledByColony : undefined,
    });
  }

  private onWarDeclared(event: PlanetEventV1): Promise<unknown> | null {
    const data = event.data as Record<string, unknown>;
    const bondAmount = Number(data.bondAmount ?? 0);
    const warId = String(data.warId ?? '');
    if (!warId || !Number.isFinite(bondAmount) || bondAmount <= 0) return null;
    const attackerColonyIndex =
      typeof data.attackerColonyIndex === 'number' ? data.attackerColonyIndex : numberOrUndef(data.attackerColony);
    const attackerColonyId = colonyIdString(data.attackerColonyId ?? data.attackerColony, attackerColonyIndex, event.colonyIds[0]);
    const bondToken = (typeof data.bondToken === 'string' ? data.bondToken : 'NEAR') as DiplomacyBondToken;
    return this.escrows.openWarBond({
      planetId: event.planetId,
      warId,
      attackerColonyId,
      attackerColonyIndex,
      bondToken,
      bondAmount,
    });
  }

  private onWarEnded(event: PlanetEventV1): Promise<unknown> | null {
    const data = event.data as Record<string, unknown>;
    const warId = String(data.warId ?? '');
    const reason = data.reason as 'objective_met' | 'cancelled' | 'expired' | 'eliminated' | undefined;
    if (!warId || !reason) return null;
    const attackerColonyIndex =
      typeof data.attackerColonyIndex === 'number' ? data.attackerColonyIndex : numberOrUndef(data.attackerColony);
    const defenderColonyIndex =
      typeof data.defenderColonyIndex === 'number' ? data.defenderColonyIndex : numberOrUndef(data.defenderColony);
    const attackerColonyId = colonyIdString(data.attackerColonyId ?? data.attackerColony, attackerColonyIndex, event.colonyIds[0]);
    const defenderColonyId = colonyIdString(data.defenderColonyId ?? data.defenderColony, defenderColonyIndex, event.colonyIds[1]);
    return this.escrows.settleWarBond({
      planetId: event.planetId,
      warId,
      attackerColonyId,
      defenderColonyId,
      attackerColonyIndex,
      defenderColonyIndex,
      reason,
    });
  }
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function colonyIdString(primary: unknown, index: number | undefined, fallback?: string): string {
  if (typeof primary === 'string' && primary.length > 0 && !/^\d+$/.test(primary)) return primary;
  if (fallback && fallback.length > 0) return fallback;
  if (index !== undefined) return `col_${index}`;
  return typeof primary === 'number' ? `col_${primary}` : String(primary ?? 'col_0');
}
