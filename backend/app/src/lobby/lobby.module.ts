import { Global, Module } from '@nestjs/common';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';

/**
 * Lobby domain module (W11): persistent canonical worlds, immutable atlas versions,
 * sector slot reservations, tickets, 5-member parties, and persistent lifecycle/admission policy.
 */
@Global()
@Module({
  providers: [LobbyPersistenceService, WorldLifecycleService],
  exports: [LobbyPersistenceService, WorldLifecycleService],
})
export class LobbyModule {}
