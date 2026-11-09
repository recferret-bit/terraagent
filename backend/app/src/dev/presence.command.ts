import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DevPresence } from '../game/presence/dev-presence';
import { defineDevCommand, DevCommandRegistry } from './dev-command.registry.js';

const seatArgs = z.object({
  planetId: z.string().min(1),
  colonyIndex: z.number().int().nonnegative().optional(),
  colonyId: z.string().min(1).optional(),
}).strict();

/** `away`, `back`, and `colony.eliminate` (dev console). Module `system.presence`; clients cannot send that command. */
@Injectable()
export class PresenceCommands implements OnModuleInit {
  constructor(private readonly registry: DevCommandRegistry, private readonly presence: DevPresence) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'away',
      help: 'Mark this colony away on the next tick (system.presence). A repeat posts nothing.',
      args: seatArgs,
      run: (args) => this.presence.setAway({ ...args, away: true }),
    }));
    this.registry.register(defineDevCommand({
      name: 'back',
      help: 'Mark this colony present again (system.presence). A repeat posts nothing.',
      args: seatArgs,
      run: (args) => this.presence.setAway({ ...args, away: false }),
    }));
    this.registry.register(defineDevCommand({
      name: 'colony.eliminate',
      help: 'While away: emit colonyEliminated and start the hard-mode clock. Present colonies reject not_away.',
      args: seatArgs,
      run: (args) => this.presence.eliminate(args),
    }));
  }
}
