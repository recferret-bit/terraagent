import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from '../core/errors/index.js';
import { GamePlanets } from '../game/game-planets.service';
import { SnapshotService } from '../game/persistence/snapshot.service';
import { defineDevCommand, DevCommandRegistry } from './dev-command.registry.js';

/**
 * `planet.wipe` (LED-06): deletes a held planet (not loaded: its snapshots are corrupt or from a newer build) with its
 * snapshots, journal rows and colony rows, so the next seat or boot starts it fresh. A loaded planet is refused (409).
 */
@Injectable()
export class PlanetWipeCommand implements OnModuleInit {
  constructor(private readonly registry: DevCommandRegistry, private readonly snapshots: SnapshotService, private readonly planets: GamePlanets) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'planet.wipe',
      help: 'Delete a held (unloaded) planet with its snapshots, ledger rows and colony rows: { planetId }',
      args: z.object({ planetId: z.string().regex(/^pl_[A-Za-z0-9_-]{1,64}$/) }).strict(),
      run: async ({ planetId }) => {
        if (this.planets.isLoaded(planetId)) {
          throw new CoreException('PLANET_LOADED', { status: 409, message: `planet ${planetId} is loaded: only an unloaded (held) planet can be wiped` });
        }
        await this.snapshots.wipe(planetId);
        return { planetId, wiped: true };
      },
    }));
  }
}
