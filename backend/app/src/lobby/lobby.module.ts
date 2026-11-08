import { Global, Module } from '@nestjs/common';
import { CanonicalCapacityGuardService } from './capacity-guard.service';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import { MatchmakerService } from './matchmaker.service';
import { PlanetsController } from './planets.controller';
import { PlanetsService } from './planets.service';
import { CanonicalWorldProvisioningService } from './provisioning.service';
import { SectorReservationService } from './reservation.service';
import { MatchTicketsController } from './tickets.controller';
import { MatchTicketsService } from './tickets.service';

/**
 * Lobby domain module (W11): persistent canonical worlds, immutable atlas versions,
 * sector slot reservations, tickets, 5-member parties, persistent lifecycle/admission policy,
 * canonical world sim-thread provisioning, planet/sector summaries & public stats,
 * idempotent matchmaking ticket REST endpoints, same-planet sector matchmaker,
 * and canonical capacity guard (`MM-42..44`).
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
    CanonicalCapacityGuardService,
  ],
  exports: [
    LobbyPersistenceService,
    WorldLifecycleService,
    CanonicalWorldProvisioningService,
    PlanetsService,
    SectorReservationService,
    MatchTicketsService,
    MatchmakerService,
    CanonicalCapacityGuardService,
  ],
})
export class LobbyModule {}
