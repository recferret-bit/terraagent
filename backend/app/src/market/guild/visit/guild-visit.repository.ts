import { Inject, Injectable } from '@nestjs/common';
import type { GuildOffer } from '@terra/contracts';
import { Prisma, type PrismaClient } from '@terra/db';
import { PRISMA } from '../../../db/db.module.js';

export interface GuildVisitRow {
  readonly id: string;
  readonly npcId: string;
  readonly shipId: string;
  readonly planetId: string;
  readonly arriveAt: number;
  readonly departAt: number;
  readonly status: 'docked' | 'departed';
  readonly kind: 'cadence' | 'extra';
}

export interface GuildVisitInsert {
  readonly id: string;
  readonly npcId: string;
  readonly shipId: string;
  readonly planetId: string;
  readonly arriveAt: number;
  readonly departAt: number;
  readonly kind: 'cadence' | 'extra';
}

type Row = NonNullable<Awaited<ReturnType<PrismaClient['guildVisit']['findFirst']>>>;

/** `chain.guild_visit`. A cadence id is deterministic, so a second insert of the same window returns the row. */
@Injectable()
export class GuildVisitRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  latestCadence(npcId: string, planetId: string): Promise<GuildVisitRow | null> {
    return this.prisma.guildVisit
      .findFirst({
        where: { npcId, planetId, kind: 'cadence' },
        orderBy: { arriveAt: 'desc' },
      })
      .then((row) => (row ? toRow(row) : null));
  }

  /** Every dock still open for this NPC on this planet, oldest first. */
  openDocked(npcId: string, planetId: string): Promise<GuildVisitRow[]> {
    return this.prisma.guildVisit
      .findMany({
        where: { npcId, planetId, status: 'docked' },
        orderBy: { arriveAt: 'asc' },
      })
      .then((rows) => rows.map(toRow));
  }

  /** Docks whose departure is due, cadence and extra. Already-departed rows are not returned. */
  openDue(npcId: string, planetId: string, nowMs: number): Promise<GuildVisitRow[]> {
    return this.prisma.guildVisit
      .findMany({
        where: { npcId, planetId, status: 'docked', departAt: { lte: new Date(nowMs) } },
        orderBy: { arriveAt: 'asc' },
      })
      .then((rows) => rows.map(toRow));
  }

  async insertCadence(draft: GuildVisitInsert): Promise<{ row: GuildVisitRow; created: boolean }> {
    try {
      return { row: toRow(await this.prisma.guildVisit.create({ data: dataOf(draft) })), created: true };
    } catch (e) {
      if (!isUnique(e)) throw e;
      const again = await this.prisma.guildVisit.findUnique({ where: { id: draft.id } });
      if (!again) throw e;
      return { row: toRow(again), created: false };
    }
  }

  insertExtra(draft: GuildVisitInsert): Promise<GuildVisitRow> {
    return this.prisma.guildVisit.create({ data: dataOf(draft) }).then(toRow);
  }

  saveOffers(id: string, offers: readonly GuildOffer[]): Promise<void> {
    return this.prisma.guildVisit.update({ where: { id }, data: { offers: offers as unknown as Prisma.InputJsonValue } }).then(() => undefined);
  }

  /** One writer wins. A second tick in the same departure gets `false` and must not push again. */
  async markDeparted(id: string): Promise<boolean> {
    const res = await this.prisma.guildVisit.updateMany({
      where: { id, status: 'docked' },
      data: { status: 'departed' },
    });
    return res.count === 1;
  }
}

function dataOf(draft: GuildVisitInsert): Prisma.GuildVisitCreateInput {
  return {
    id: draft.id,
    npcId: draft.npcId,
    shipId: draft.shipId,
    planetId: draft.planetId,
    arriveAt: new Date(draft.arriveAt),
    departAt: new Date(draft.departAt),
    offers: [],
    status: 'docked',
    kind: draft.kind,
  };
}

function toRow(row: Row): GuildVisitRow {
  return {
    id: row.id,
    npcId: row.npcId,
    shipId: row.shipId,
    planetId: row.planetId,
    arriveAt: row.arriveAt.getTime(),
    departAt: row.departAt.getTime(),
    status: row.status === 'departed' ? 'departed' : 'docked',
    kind: row.kind === 'extra' ? 'extra' : 'cadence',
  };
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
}
