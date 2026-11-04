import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../db/db.module.js';

export interface ProgressionEffectDelivery {
  id: string;
  playerId: string;
  payload: unknown;
}
export type ProgressionEffectHandler = (effect: ProgressionEffectDelivery) => Promise<void>;

/** At-least-once delivery. Consumers must use effect.id as their external idempotency key. */
@Injectable()
export class ProgressionEffects {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async drain(kind: string, handler: ProgressionEffectHandler, now = new Date()): Promise<number> {
    const rows = await this.db.progressionEffect.findMany({
      where: { kind, completedAt: null, availableAt: { lte: now } },
      orderBy: { availableAt: 'asc' },
      take: 50,
    });
    let completed = 0;
    for (const row of rows) {
      const lease = randomUUID();
      const claimed = await this.db.progressionEffect.updateMany({
        where: { id: row.id, completedAt: null, availableAt: { lte: now } },
        data: { lease, attempts: { increment: 1 }, availableAt: new Date(now.getTime() + 60_000) },
      });
      if (!claimed.count) continue;
      try {
        await handler({ id: row.id, playerId: row.playerId, payload: row.payload });
        const ack = await this.db.progressionEffect.updateMany({
          where: { id: row.id, lease },
          data: { completedAt: new Date(), lastError: null, lease: null },
        });
        completed += ack.count;
      } catch (error) {
        await this.db.progressionEffect.updateMany({
          where: { id: row.id, lease },
          data: {
            lease: null,
            lastError: String(error).slice(0, 2000),
            availableAt: new Date(now.getTime() + Math.min(3600_000, 1000 * 2 ** Math.min(row.attempts, 12))),
          },
        });
      }
    }
    return completed;
  }
}
