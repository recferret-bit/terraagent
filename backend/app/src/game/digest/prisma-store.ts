import { Prisma, type PrismaClient } from '@prisma/client';
import { AwayDigestV1Schema, type AwayDigestV1 } from '@terra/contracts';
import type { DigestInsert, DigestMerge, DigestRecord, DigestStore } from './types';

type Row = {
  id: bigint;
  colonyId: string;
  planetId: string;
  openedAt: Date;
  closedAt: Date | null;
  seenAt: Date | null;
  lastEventSeq: bigint;
  body: unknown;
};

/** `world.planet_event_digest` (CT-30..33). */
export class PrismaDigestStore implements DigestStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(row: DigestInsert): Promise<DigestRecord> {
    const saved = await this.prisma.planetEventDigest.create({
      data: {
        colonyId: row.colonyId,
        planetId: row.planetId,
        openedAt: row.openedAt,
        lastEventSeq: row.lastEventSeq,
        body: json(row.body),
      },
    });
    const body = readBody(saved.body);
    if (!body) throw new Error(`digest ${saved.id.toString()} was stored with a body the contract rejects`);
    return { ...saved, body };
  }

  async save(id: bigint, body: AwayDigestV1, lastEventSeq: bigint, closedAt?: Date): Promise<void> {
    await this.prisma.planetEventDigest.update({
      where: { id },
      data: { body: json(body), lastEventSeq, ...(closedAt ? { closedAt } : {}) },
    });
  }

  async commitMerge(merge: DigestMerge): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.planetEventDigest.update({
        where: { id: merge.newestId },
        data: { body: json(merge.body), lastEventSeq: merge.lastEventSeq },
      }),
      this.prisma.planetEventDigest.updateMany({
        where: { id: { in: [...merge.olderIds] } },
        data: { seenAt: merge.seenAt },
      }),
    ]);
  }

  async findOpen(colonyId: string): Promise<DigestRecord | null> {
    const row = await this.prisma.planetEventDigest.findFirst({
      where: { colonyId, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  async listOpen(): Promise<DigestRecord[]> {
    const rows = await this.prisma.planetEventDigest.findMany({ where: { closedAt: null } });
    return rows.flatMap((row) => {
      const rec = toRecord(row);
      return rec ? [rec] : [];
    });
  }

  async listUnseen(colonyId: string): Promise<DigestRecord[]> {
    const rows = await this.prisma.planetEventDigest.findMany({
      where: { colonyId, seenAt: null },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row) => {
      const rec = toRecord(row);
      return rec ? [rec] : [];
    });
  }

  async latestUnseen(colonyId: string): Promise<DigestRecord | null> {
    const row = await this.prisma.planetEventDigest.findFirst({
      where: { colonyId, seenAt: null },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    });
    return row ? toRecord(row) : null;
  }

  async markClosedUnseen(colonyId: string, seenAt: Date): Promise<void> {
    await this.prisma.planetEventDigest.updateMany({
      where: { colonyId, seenAt: null, closedAt: { not: null } },
      data: { seenAt },
    });
  }

  async purgeOpenedBefore(cutoff: Date): Promise<number> {
    const deleted = await this.prisma.planetEventDigest.deleteMany({ where: { openedAt: { lt: cutoff } } });
    return deleted.count;
  }
}

function json(body: AwayDigestV1): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue;
}

function readBody(value: unknown): AwayDigestV1 | null {
  const parsed = AwayDigestV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toRecord(row: Row): DigestRecord | null {
  const body = readBody(row.body);
  return body ? { ...row, body } : null;
}
