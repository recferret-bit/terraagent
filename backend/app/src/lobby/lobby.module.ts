import { Global, Module } from '@nestjs/common';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import { PlanetsController } from './planets.controller';
import { PlanetsService } from './planets.service';
import { SectorReservationService } from './reservation.service';
import { MatchTicketsController } from './tickets.controller';
import { MatchTicketsService } from './tickets.service';

/**
 * Lobby domain module (W11): persistent canonical worlds, immutable atlas versions,
 * sector slot reservations, tickets, 5-member parties, persistent lifecycle/admission policy,
 * planet/sector summaries & public stats, and idempotent matchmaking ticket REST endpoints.
 */
@Global()
@Module({
  controllers: [PlanetsController, MatchTicketsController],
  providers: [
    LobbyPersistenceService,
    WorldLifecycleService,
    PlanetsService,
    SectorReservationService,
    MatchTicketsService,
  ],
  exports: [
    LobbyPersistenceService,
    WorldLifecycleService,
    PlanetsService,
    SectorReservationService,
    MatchTicketsService,
  ],
})
export class LobbyModule {}
