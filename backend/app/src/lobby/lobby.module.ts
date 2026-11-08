import { Global, Module } from '@nestjs/common';
import { LobbyPersistenceService } from './lobby-persistence.service';

/**
 * Lobby domain module (W11): persistent canonical worlds, immutable atlas versions,
 * sector slot reservations, tickets, and 5-member parties.
 */
@Global()
@Module({
  providers: [LobbyPersistenceService],
  exports: [LobbyPersistenceService],
})
export class LobbyModule {}
