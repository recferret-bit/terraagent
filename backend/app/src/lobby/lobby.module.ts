import { Global, Module } from '@nestjs/common';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import { MatchmakerService } from './matchmaker.service';
import { PlanetsController } from './planets.controller';
import { PlanetsService } from './planets.service';
import { CanonicalWorldProvisioningService } from './provisioning.service';
import { SectorReservationService } from './reservation.service';
import { SpawnSagaService } from './spawn-saga.service';
import { MatchTicketsController } from './tickets.controller';
import { MatchTicketsService } from './tickets.service';

/**
 * Lobby domain module (W11): persistent canonical worlds, immutable atlas versions,
 * sector slot reservations, tickets, 5-member parties, persistent lifecycle/admission policy,
 * canonical world sim-thread provisioning, planet/sector summaries & public stats,
 * idempotent matchmaking ticket REST endpoints, same-planet sector matchmaker,
 * and idempotent colony spawn saga / orphan reconciler.
 */
@Global()
@Module({
  controllers: [PlanetsController, MatchTicketsController],
  providers: [
    LobbyPersistenceService,
    WorldLifecycleService,
    CanonicalWorldProvisioningService,
    PlanetsService,
    SectorReservationService,
    MatchTicketsService,
    MatchmakerService,
    SpawnSagaService,
  ],
  exports: [
    LobbyPersistenceService,
    WorldLifecycleService,
    CanonicalWorldProvisioningService,
    PlanetsService,
    SectorReservationService,
    MatchTicketsService,
    MatchmakerService,
    SpawnSagaService,
  ],
})
export class LobbyModule {}
