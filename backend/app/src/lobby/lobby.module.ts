import { Global, Module } from '@nestjs/common';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
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
  providers: [LobbyPersistenceService, WorldLifecycleService, MatchTicketsService],
  exports: [LobbyPersistenceService, WorldLifecycleService, MatchTicketsService],
})
export class LobbyModule {}
