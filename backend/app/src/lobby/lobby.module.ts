import { Global, Module } from '@nestjs/common';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import { SectorReservationService } from './reservation.service';
import { MatchTicketsController } from './tickets.controller';
import { MatchTicketsService } from './tickets.service';

/**
 * Lobby domain module (W11): persistent canonical worlds, immutable atlas versions,
 * sector slot reservations, tickets, 5-member parties, persistent lifecycle/admission policy,
 * and idempotent matchmaking ticket REST endpoints.
 */
@Global()
@Module({
  controllers: [MatchTicketsController],
  providers: [
    LobbyPersistenceService,
    WorldLifecycleService,
    SectorReservationService,
    MatchTicketsService,
  ],
  exports: [
    LobbyPersistenceService,
    WorldLifecycleService,
    SectorReservationService,
    MatchTicketsService,
  ],
})
export class LobbyModule {}
