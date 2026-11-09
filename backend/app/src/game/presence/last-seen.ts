import type { PrismaClient } from '@terra/db';
import type { LastSeenPort, LastSeenTouch } from './types';

/** Writes `last_seen_at` on the colony and the player. A missing row is not an error (CT-13). */
export class PrismaLastSeen implements LastSeenPort {
  constructor(private readonly prisma: PrismaClient) {}

  async touch(input: LastSeenTouch): Promise<{ colonyIndex?: number }> {
    const colonyIndex = await this.touchColony(input);
    await this.touchPlayer(input);
    return { colonyIndex: input.colonyIndex ?? colonyIndex };
  }

  private async touchColony(input: LastSeenTouch): Promise<number | undefined> {
    try {
      const updated = await this.prisma.colony.updateMany({
        where: { id: input.colonyId },
        data: { lastSeenAt: input.at },
      });
      if (updated.count === 0) return undefined;
      const row = await this.prisma.colony.findUnique({ where: { id: input.colonyId }, select: { colonyIndex: true } });
      return row?.colonyIndex;
    } catch {
      return undefined;
    }
  }

  private async touchPlayer(input: LastSeenTouch): Promise<void> {
    try {
      await this.prisma.player.updateMany({ where: { id: input.playerId }, data: { lastSeenAt: input.at } });
    } catch {
      /* a missing player must not block the presence command */
    }
  }
}
