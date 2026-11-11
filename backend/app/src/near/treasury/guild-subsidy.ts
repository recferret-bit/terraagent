import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';

/** Next Guild schedule slot until W15 owns the clock. */
export const GUILD_VISIT_SLOT_MS = 60 * 60 * 1000;

export interface WaveFlags {
  has(wave: string): boolean;
}

/**
 * W15 hook `scheduleExtraVisit` (W22-12). W15 off still writes the row while W22 is on;
 * the Council hides this kind later (W22-14).
 */
@Injectable()
export class GuildSubsidyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FlagsService) private readonly flags: WaveFlags,
  ) {}

  /** One `chain.guild_visit` row: subsidy, not organic. */
  scheduleExtraVisit(planetId: string, now = new Date()): Promise<{ id: string }> {
    return this.prisma.chainGuildVisit.create({
      data: {
        id: randomUUID(),
        planetId,
        arrivesAt: new Date(now.getTime() + GUILD_VISIT_SLOT_MS),
        subsidy: true,
        organic: false,
      },
      select: { id: true },
    });
  }

  /** A passed `guild_subsidy`. No row when W22 is off. */
  async applyGuildSubsidy(planetId: string, now = new Date()): Promise<boolean> {
    if (!this.flags.has('W22')) return false;
    await this.scheduleExtraVisit(planetId, now);
    return true;
  }
}
