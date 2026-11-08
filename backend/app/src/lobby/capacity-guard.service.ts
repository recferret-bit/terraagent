import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CANONICAL_PLANET_IDS,
  CANONICAL_PLANETS,
  deriveWorldAvailability,
  type AtlasConfigV1,
  type AtlasManifestV1,
  type CanonicalPlanetDef,
  type MatchTicketV1,
  type PlanetType,
} from '@terra/contracts';
import type { GeneratedSmallAtlas } from '@terra/sim';
import { Counter } from 'prom-client';
import { MetricsRegistry } from '../core/metrics.registry';
import {
  assertCanonicalWorldIdentity,
  assertWorldProvisionBudget,
  getSharedCapacityMetricsState,
  incrementSharedCapacityBlocked,
  isCapacityBlockedProcessResult,
  recordCapacityBlockedForProcessResult,
  validateWorldProvisionBudget,
} from './capacity-guard.helpers';
import {
  CANONICAL_WORLDS_CAP,
  CapacityGuardError,
  MM_CAPACITY_BLOCKED_METRIC,
  type CanonicalWorldIdentityInput,
  type ClusterCapacitySnapshot,
  type GuardedMatchmakerTickResult,
  type PlanetCapacitySnapshot,
  type RecordCapacityBlockedInput,
  type SharedCapacityMetricsState,
  type TicketCapacityEvaluationResult,
  type WorldProvisionBudgetInput,
  type WorldProvisionBudgetLimits,
  type WorldProvisionBudgetResult,
} from './capacity-guard.types';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import type {
  MatchTicketRecord,
  ProvisionCanonicalWorldInput,
  ProvisionCanonicalWorldResult,
} from './lobby-persistence.types';
import { loadAndSyncTicketRecord } from './matchmaker.helpers';
import { MatchmakerService } from './matchmaker.service';
import type { ProcessTicketResult, RunMatchmakerTickOptions } from './matchmaker.types';
import { CANONICAL_PLANET_TYPES, resolveCanonicalPlanetType } from './planets.helpers';

export * from './capacity-guard.types';
export * from './capacity-guard.helpers';

/**
 * Canonical Capacity Guard Service (W11-15: MATCHMAKING §0.2 MM-42..44, §0.4, §9).
 * Replaces the legacy warm pool and `MAX_ACTIVE_PLANETS = 60` overflow policy with a strict
 * 3-canonical-world guard, safe-site capacity accounting, and `mm_capacity_blocked_total` telemetry.
 */
@Injectable()
export class CanonicalCapacityGuardService {
  private readonly lifecycle: WorldLifecycleService;
  private readonly matchmaker: MatchmakerService;
  private readonly metricsState: SharedCapacityMetricsState;
  private promBlockedCounter?: Counter<string>;

  constructor(
    @Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) lifecycle?: WorldLifecycleService,
    @Optional() @Inject(MatchmakerService) matchmaker?: MatchmakerService,
    @Optional() @Inject(MetricsRegistry) private readonly metricsRegistry?: MetricsRegistry,
  ) {
    this.lifecycle = lifecycle ?? new WorldLifecycleService(this.persistence);
    this.matchmaker = matchmaker ?? new MatchmakerService(this.persistence, undefined, this.lifecycle);
    this.metricsState = getSharedCapacityMetricsState(this.persistence);
    this.initPrometheusHook();
  }

  private initPrometheusHook(): void {
    if (!this.metricsRegistry) return;
    const existing = this.metricsRegistry.registry.getSingleMetric(MM_CAPACITY_BLOCKED_METRIC) as
      | Counter<string>
      | undefined;
    this.promBlockedCounter =
      existing ??
      new Counter({
        name: MM_CAPACITY_BLOCKED_METRIC,
        help: 'Total matchmaking ticket evaluations blocked by exhausted canonical safe-site capacity (MM-43)',
        registers: [this.metricsRegistry.registry],
      });
    this.metricsState.listeners.add((_planetType, _reason, delta) => {
      this.promBlockedCounter?.inc(delta);
    });
  }

  assertCanonicalWorldIdentity(
    input: string | CanonicalWorldIdentityInput,
    existingWorldIds?: readonly string[],
  ): CanonicalPlanetDef {
    return assertCanonicalWorldIdentity(input, existingWorldIds);
  }

  validateWorldProvisionBudget(
    input: WorldProvisionBudgetInput | AtlasManifestV1 | AtlasConfigV1 | GeneratedSmallAtlas,
    options?: { readonly limits?: WorldProvisionBudgetLimits; readonly throwOnError?: boolean },
  ): WorldProvisionBudgetResult {
    return validateWorldProvisionBudget(input, options);
  }

  assertWorldProvisionBudget(
    input: WorldProvisionBudgetInput | AtlasManifestV1 | AtlasConfigV1 | GeneratedSmallAtlas,
    limits?: WorldProvisionBudgetLimits,
  ): WorldProvisionBudgetResult {
    return assertWorldProvisionBudget(input, limits);
  }

  provisionWarmPoolWorld(input?: unknown): never {
    throw new CapacityGuardError(
      'warm_pool_disabled',
      'warm-pool world creation is permanently disabled in W11 (MM-42); only the 3 canonical worlds exist',
      { input },
    );
  }

  topUpWarmPool(input?: unknown): never {
    return this.provisionWarmPoolWorld(input);
  }

  trimWarmPool(input?: unknown): never {
    return this.provisionWarmPoolWorld(input);
  }

  createOverflowWorld(input?: unknown): never {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      'overflow and 4th-world creation are forbidden in W11 (MM-43); full canonical worlds queue demand',
      { input, maxCanonicalWorlds: CANONICAL_WORLDS_CAP },
    );
  }

  provisionOverflowWorld(input?: unknown): never {
    return this.createOverflowWorld(input);
  }

  async guardWorldProvisioning(
    input: ProvisionCanonicalWorldInput | WorldProvisionBudgetInput,
  ): Promise<CanonicalPlanetDef> {
    const existingWorlds = await this.persistence.listCanonicalWorlds();
    const existingIds = existingWorlds.map((w) => w.id);
    const canonical = assertCanonicalWorldIdentity(input, existingIds);
    assertWorldProvisionBudget({ ...input, existingWorldIds: existingIds });
    return canonical;
  }

  async provisionGuardedCanonicalWorld(
    input: ProvisionCanonicalWorldInput,
  ): Promise<ProvisionCanonicalWorldResult> {
    await this.guardWorldProvisioning(input);
    return this.persistence.provisionCanonicalWorld(input);
  }

  recordCapacityBlocked(input?: string | RecordCapacityBlockedInput): number {
    return incrementSharedCapacityBlocked(this.metricsState, input);
  }

  getCapacityBlockedTotal(): number {
    return this.metricsState.capacityBlockedTotal;
  }

  getCapacityBlockedByPlanet(): Readonly<Record<PlanetType, number>> & Readonly<Record<string, number>> {
    const bp = this.metricsState.byPlanet;
    return {
      desert: bp.desert,
      ocean: bp.ocean,
      temperate: bp.temperate,
      [CANONICAL_PLANETS.desert.id]: bp.desert,
      [CANONICAL_PLANETS.ocean.id]: bp.ocean,
      [CANONICAL_PLANETS.temperate.id]: bp.temperate,
    };
  }

  resetCapacityBlockedMetrics(): void {
    this.metricsState.capacityBlockedTotal = 0;
    this.metricsState.byPlanet.desert = 0;
    this.metricsState.byPlanet.ocean = 0;
    this.metricsState.byPlanet.temperate = 0;
    this.metricsState.byReason.clear();
  }

  async getPlanetCapacitySnapshot(planetIdOrType: PlanetType | string): Promise<PlanetCapacitySnapshot> {
    const canonical = assertCanonicalWorldIdentity(planetIdOrType);
    const queuedTickets = await this.persistence.listTickets({ state: 'QUEUED' });
    return this.buildPlanetSnapshot(canonical.type, queuedTickets);
  }

  async evaluateClusterCapacity(): Promise<ClusterCapacitySnapshot> {
    const [persistedWorlds, queuedTickets] = await Promise.all([
      this.persistence.listCanonicalWorlds(),
      this.persistence.listTickets({ state: 'QUEUED' }),
    ]);
    for (const w of persistedWorlds) {
      assertCanonicalWorldIdentity({ id: w.id, type: w.canonicalType, look: w.look });
    }
    if (persistedWorlds.length > CANONICAL_WORLDS_CAP) {
      throw new CapacityGuardError(
        'non_canonical_world_forbidden',
        `cluster persisted ${persistedWorlds.length} worlds, exceeding canonical cap of ${CANONICAL_WORLDS_CAP}`,
        { worldIds: persistedWorlds.map((w) => w.id) },
      );
    }

    const planets = await Promise.all(
      CANONICAL_PLANET_TYPES.map((type) => this.buildPlanetSnapshot(type, queuedTickets)),
    );
    const byPlanet: Record<string, PlanetCapacitySnapshot> = {};
    for (const p of planets) {
      byPlanet[p.type] = p;
      byPlanet[p.planetId] = p;
    }

    const totalNominalCapacity = planets.reduce((s, p) => s + p.nominalCapacity, 0);
    const totalValidatedSafeSites = planets.reduce((s, p) => s + p.validatedSafeSites, 0);
    const totalReservedSeats = planets.reduce((s, p) => s + p.reservedSeats, 0);
    const totalFoundedSeats = planets.reduce((s, p) => s + p.foundedSeats, 0);
    const totalFreeSeats = planets.reduce((s, p) => s + p.freeSeats, 0);
    const totalTakenSeats = totalReservedSeats + totalFoundedSeats;
    const queuedTicketsCount = queuedTickets.length;
    const capacityBlockedTotal = this.metricsState.capacityBlockedTotal;
    const allSlotsExhausted = totalValidatedSafeSites > 0 && totalFreeSeats === 0;

    return {
      canonicalWorldsCount: persistedWorlds.length,
      maxCanonicalWorlds: CANONICAL_WORLDS_CAP,
      warmPoolEnabled: false,
      warmPoolCount: 0,
      overflowWorldsCount: 0,
      canonicalPlanetIds: [...CANONICAL_PLANET_IDS],
      totalNominalCapacity,
      nominalCapacity: totalNominalCapacity,
      totalValidatedSafeSites,
      totalValidatedCapacity: totalValidatedSafeSites,
      validatedSafeSites: totalValidatedSafeSites,
      totalReservedSeats,
      reservedSeats: totalReservedSeats,
      totalFoundedSeats,
      foundedSeats: totalFoundedSeats,
      totalFreeSeats,
      freeSeats: totalFreeSeats,
      totalTakenSeats,
      seatsTaken: totalTakenSeats,
      queuedTicketsCount,
      queuedDemand: queuedTicketsCount,
      capacityBlockedTotal,
      mm_capacity_blocked_total: capacityBlockedTotal,
      capacityBlockedByPlanet: this.getCapacityBlockedByPlanet(),
      capacityBlockedByReason: Object.fromEntries(this.metricsState.byReason.entries()),
      allSlotsExhausted,
      clusterFull: allSlotsExhausted,
      planets,
      byPlanet: byPlanet as ClusterCapacitySnapshot['byPlanet'],
      updatedAt: new Date().toISOString(),
    };
  }

  getCapacitySnapshot(): Promise<ClusterCapacitySnapshot> {
    return this.evaluateClusterCapacity();
  }

  async evaluateTicketCapacity(
    ticketOrResult: string | MatchTicketRecord | MatchTicketV1 | ProcessTicketResult,
  ): Promise<TicketCapacityEvaluationResult> {
    if (
      typeof ticketOrResult === 'object' &&
      ticketOrResult !== null &&
      'outcome' in ticketOrResult &&
      'ticket' in ticketOrResult
    ) {
      recordCapacityBlockedForProcessResult(this.metricsState, ticketOrResult);
      const check = isCapacityBlockedProcessResult(ticketOrResult);
      const snap = await this.getPlanetCapacitySnapshot(ticketOrResult.ticket.planetType);
      return {
        blocked: check.blocked,
        reason: check.blocked ? check.reason : null,
        outcome: ticketOrResult.outcome,
        ticketId: ticketOrResult.ticket.id,
        planetId: snap.planetId,
        planetType: snap.type,
        sectorId:
          ticketOrResult.ticket.sectorIntent.kind === 'chosen'
            ? ticketOrResult.ticket.sectorIntent.sectorId
            : (ticketOrResult.reservation?.sectorId ?? null),
        freeSeats: snap.freeSeats,
        capacityBlockedTotal: this.metricsState.capacityBlockedTotal,
        ticket: ticketOrResult.ticket,
      };
    }

    const ticket = await loadAndSyncTicketRecord(this.persistence, ticketOrResult);
    const snap = await this.getPlanetCapacitySnapshot(ticket.planetType);
    const chosenId = ticket.sectorIntent.kind === 'chosen' ? ticket.sectorIntent.sectorId : null;
    const chosenSec = chosenId ? await this.persistence.getSector(snap.planetId, chosenId) : null;
    const freeSeats = chosenSec ? chosenSec.freeSeats : snap.freeSeats;
    const blocked = ticket.state === 'QUEUED' && freeSeats === 0;
    const reason = blocked ? (chosenId ? 'chosen_sector_full' : 'planet_full') : null;
    if (blocked) {
      this.recordCapacityBlocked({
        planetId: snap.planetId,
        planetType: snap.type,
        sectorId: chosenId ?? undefined,
        ticketId: ticket.id,
        reason: reason ?? 'planet_full',
      });
    }
    return {
      blocked,
      reason,
      ticketId: ticket.id,
      planetId: snap.planetId,
      planetType: snap.type,
      sectorId: chosenId,
      freeSeats,
      capacityBlockedTotal: this.metricsState.capacityBlockedTotal,
      ticket,
    };
  }

  async runGuardedMatchmakerTick(
    matchmakerOrOpts?: MatchmakerService | RunMatchmakerTickOptions,
    maybeOpts?: RunMatchmakerTickOptions,
  ): Promise<GuardedMatchmakerTickResult> {
    const mm = matchmakerOrOpts instanceof MatchmakerService ? matchmakerOrOpts : this.matchmaker;
    const opts =
      matchmakerOrOpts instanceof MatchmakerService ? (maybeOpts ?? {}) : (matchmakerOrOpts ?? {});
    const beforeBlocked = this.metricsState.capacityBlockedTotal;
    const summary = await mm.runMatchmakerTick(opts);
    for (const res of summary.results) {
      recordCapacityBlockedForProcessResult(this.metricsState, res);
    }
    const capacity = await this.evaluateClusterCapacity();
    return {
      ...summary,
      capacity,
      capacityBlockedInTick: Math.max(0, capacity.capacityBlockedTotal - beforeBlocked),
      capacityBlockedTotal: capacity.capacityBlockedTotal,
      canonicalWorldsCount: capacity.canonicalWorldsCount,
      warmPoolCreated: 0,
      overflowWorldsCreated: 0,
    };
  }

  private async buildPlanetSnapshot(
    type: PlanetType,
    queuedTickets: readonly MatchTicketRecord[],
  ): Promise<PlanetCapacitySnapshot> {
    const def = CANONICAL_PLANETS[type];
    const [world, sectors, reservations, slots] = await Promise.all([
      this.persistence.getCanonicalWorldByType(type),
      this.persistence.listSectors(def.id),
      this.persistence.listReservations(def.id),
      this.persistence.listLandingSlots(def.id),
    ]);
    const landSectors = sectors.filter((s) => s.kind === 'land');
    const oceanSectors = sectors.filter((s) => s.kind === 'ocean');
    let nominalCapacity = 0;
    let validatedSafeSites = 0;
    let reservedSeats = 0;
    let foundedSeats = 0;

    for (const sec of landSectors) {
      const secVal = Math.min(sec.foundingCapacity, sec.validatedCapacity);
      const heldRes = reservations.filter((r) => r.sectorId === sec.sectorId && r.state === 'HELD').length;
      const commRes = reservations.filter((r) => r.sectorId === sec.sectorId && r.state === 'COMMITTED').length;
      const heldSlots = slots.filter((s) => s.sectorId === sec.sectorId && s.state === 'HELD').length;
      const commSlots = slots.filter((s) => s.sectorId === sec.sectorId && s.state === 'COMMITTED').length;
      const secFounded = Math.min(secVal, Math.max(sec.foundedSeats, commRes, commSlots));
      const secReserved = Math.min(
        Math.max(0, secVal - secFounded),
        Math.max(sec.reservedSeats, heldRes, heldSlots),
      );
      nominalCapacity += sec.foundingCapacity;
      validatedSafeSites += secVal;
      foundedSeats += secFounded;
      reservedSeats += secReserved;
    }

    const freeSeats = Math.max(0, validatedSafeSites - reservedSeats - foundedSeats);
    const takenSeats = reservedSeats + foundedSeats;
    const lifecycle = world?.lifecycle ?? 'ACTIVE';
    const health = world?.health ?? 'OK';
    const admission = world?.admission ?? 'OPEN';
    const availability = deriveWorldAvailability({ lifecycle, health, admission, freeSeats });
    const queuedForPlanet = queuedTickets.filter(
      (t) => t.planetId === def.id || t.planetType === type || resolveCanonicalPlanetType(t.planetId) === type,
    ).length;
    const blockedCount = this.metricsState.byPlanet[type];
    const isFull = validatedSafeSites > 0 && freeSeats === 0;

    return {
      id: def.id,
      planetId: def.id,
      type,
      planetType: type,
      name: world?.name ?? def.name,
      look: world?.look ?? def.look,
      provisioned: world !== null,
      lifecycle,
      health,
      admission,
      availability,
      totalSectors: sectors.length,
      landSectors: landSectors.length,
      oceanSectors: oceanSectors.length,
      nominalCapacity,
      validatedSafeSites,
      validatedCapacity: validatedSafeSites,
      reservedSeats,
      foundedSeats,
      freeSeats,
      takenSeats,
      seatsTaken: takenSeats,
      isFull,
      full: isFull,
      queuedTicketsCount: queuedForPlanet,
      queuedDemand: queuedForPlanet,
      capacityBlockedCount: blockedCount,
      capacityBlockedTotal: blockedCount,
    };
  }
}
