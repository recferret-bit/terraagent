import { Global, Module } from '@nestjs/common';
import { CanonicalCapacityGuardService } from './capacity-guard.service';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import { MatchmakerService } from './matchmaker.service';
import { PlanetsController } from './planets.controller';
import { PlanetsService } from './planets.service';
import { CanonicalWorldProvisioningService } from './provisioning.service';
import { WorldReconciliationService } from './reconciliation.service';
import { SectorReservationService } from './reservation.service';
import { SpawnSagaService } from './spawn-saga.service';
import { MatchTicketsController } from './tickets.controller';
import { MatchTicketsService } from './tickets.service';
import { CanonicalWorldRecoveryService } from './world-recovery.service';

/**
 * Lobby domain module (W11): persistent canonical worlds, immutable atlas versions,
 * sector slot reservations, tickets, 5-member parties, persistent lifecycle/admission policy,
 * canonical world sim-thread provisioning & restart recovery, planet/sector summaries & public stats,
 * idempotent matchmaking ticket REST endpoints, same-planet sector matchmaker,
 * canonical capacity guard, and idempotent colony spawn saga / orphan reconciler.
 */
@Global()
@Module({
  controllers: [PlanetsController, MatchTicketsController],
  providers: [
    LobbyPersistenceService,
    WorldLifecycleService,
    CanonicalWorldProvisioningService,
    CanonicalWorldRecoveryService,
    PlanetsService,
    SectorReservationService,
    MatchTicketsService,
    MatchmakerService,
    CanonicalCapacityGuardService,
    SpawnSagaService,
    WorldReconciliationService,
  ],
  exports: [
    LobbyPersistenceService,
    WorldLifecycleService,
    CanonicalWorldProvisioningService,
    CanonicalWorldRecoveryService,
    PlanetsService,
    SectorReservationService,
    MatchTicketsService,
    MatchmakerService,
    CanonicalCapacityGuardService,
    SpawnSagaService,
    WorldReconciliationService,
  ],
})
export class LobbyModule {}
