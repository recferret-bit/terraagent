import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from '../core/errors/index.js';
import { GamePlanets } from '../game/game-planets.service.js';
import { defineDevCommand, DevCommandRegistry } from './dev-command.registry.js';

/** `warp`: dev time warp of a planet, `k` engine steps per tick slot (the thread may cap it; the effective value is broadcast as `dev.warp`). */
@Injectable()
export class WarpCommand implements OnModuleInit {
  constructor(private readonly registry: DevCommandRegistry, private readonly planets: GamePlanets) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'warp',
      help: 'Server: warp <k> sets the time warp of the current planet (1..100 steps per tick slot; 1 = normal)',
      args: z.object({ planetId: z.string().min(1), k: z.number().int().min(1).max(100) }).strict(),
      run: ({ planetId, k }) => {
        if (!this.planets.setWarp(planetId, k)) throw new CoreException('NOT_FOUND', { status: 404, message: `Planet "${planetId}" is not loaded` });
        return { planetId, k };
      },
    }));
  }
}
