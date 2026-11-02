import { Injectable, type OnModuleInit } from '@nestjs/common';
import { newId } from '@terra/contracts';
import { compileData, getPlanetTime, restore } from '@terra/sim';
import { z } from 'zod';
import { CoreException } from '../core/errors/index.js';
import { GamePlanets } from '../game/game-planets.service.js';
import { defineDevCommand, DevCommandRegistry } from './dev-command.registry.js';

const timeArgsSchema = z
  .object({
    planetId: z.string().min(1),
    timeOfDay: z.number().min(0).max(24).optional(),
    realHoursPerDay: z.number().min(0.005).max(168).optional(),
    timeScale: z.number().min(0).max(1000).optional(),
  })
  .strict();

/** `time`: queries or updates the authoritative solar clock (`timeOfDay`, `realHoursPerDay`, `timeScale`) of a planet. */
@Injectable()
export class TimeCommand implements OnModuleInit {
  constructor(
    private readonly registry: DevCommandRegistry,
    private readonly planets: GamePlanets,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      defineDevCommand({
        name: 'time',
        help: 'Server: query or configure planet solar time (timeOfDay 0..24h, realHoursPerDay, timeScale)',
        args: timeArgsSchema,
        run: async ({ planetId, timeOfDay, realHoursPerDay, timeScale }) => {
          if (!this.planets.loadedIds().includes(planetId)) {
            throw new CoreException('NOT_FOUND', { status: 404, message: `Planet "${planetId}" is not loaded` });
          }
          if (timeOfDay !== undefined || realHoursPerDay !== undefined || timeScale !== undefined) {
            const out = await this.planets.submit(planetId, {
              colonyIndex: null,
              source: 'dev',
              commandId: newId('cm'),
              kind: 'dev.time',
              args: {
                ...(timeOfDay !== undefined ? { timeOfDay } : {}),
                ...(realHoursPerDay !== undefined ? { realHoursPerDay } : {}),
                ...(timeScale !== undefined ? { timeScale } : {}),
              },
            });
            if (!out.ok) {
              throw new CoreException('VALIDATION_FAILED', { status: 400, message: out.detail ?? out.code });
            }
          }
          const full = await this.planets.fullState(planetId);
          const data = full.overrides ? compileData(new Set(['W00', 'W01']), full.overrides) : undefined;
          const pt = getPlanetTime(restore(full.bytes), data);
          return {
            planetId,
            tick: full.tick,
            hour: pt.hour,
            timeOfDay: pt.timeOfDay,
            phase: pt.phase,
            cyclePhase: pt.cyclePhase,
            day: pt.day,
            daylight: pt.daylight,
            isNight: pt.isNight,
            realHoursPerDay: pt.realHoursPerDay,
            timeScale: pt.timeScale,
          };
        },
      }),
    );
  }
}
