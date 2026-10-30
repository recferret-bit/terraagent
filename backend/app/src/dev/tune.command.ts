import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from '../core/errors/index.js';
import { GamePlanets } from '../game/game-planets.service';
import { defineDevCommand, DevCommandRegistry } from './dev-command.registry.js';

/** `tune` (D-35): balance overrides applied live to a running planet, recorded as a `dev.tuned` event; `export` returns the merged JSON. */
@Injectable()
export class TuneCommand implements OnModuleInit {
  constructor(private readonly registry: DevCommandRegistry, private readonly planets: GamePlanets) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'tune',
      help: 'Balance overrides on a planet: { planetId, op: "set"|"reset"|"export", path?: "table.row.field", value? }',
      args: z.object({
        planetId: z.string().min(1),
        op: z.enum(['set', 'reset', 'export']),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }).strict().refine((a) => a.op !== 'set' || (a.path !== undefined && a.value !== undefined), { message: 'op "set" needs path and value' }),
      run: async (a) => {
        if (!this.planets.isLoaded(a.planetId)) throw new CoreException('NOT_FOUND', { status: 404, message: `Planet ${a.planetId} is not loaded` });
        const req = a.op === 'set' ? { op: 'set' as const, path: a.path as string, value: a.value } : { op: a.op };
        const r = await this.planets.tune(a.planetId, req);
        if (!r.ok) throw new CoreException('VALIDATION_ERROR', { status: 400, message: r.error ?? 'tune failed' });
        return { dataHash: r.dataHash, overrides: r.overrides, ...(r.text !== undefined ? { text: r.text } : {}) };
      },
    }));
  }
}
