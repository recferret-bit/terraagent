import type { AwayDigestV1 } from '@terra/contracts';
import type { DigestInsert, DigestMerge, DigestRecord, DigestStore } from './types';

interface StoredDigest {
  id: bigint;
  colonyId: string;
  planetId: string;
  openedAt: Date;
  closedAt: Date | null;
  seenAt: Date | null;
  lastEventSeq: bigint;
  body: AwayDigestV1;
}

/** Process-local stand-in used when snapshot persistence is off (unit tests). */
export class MemoryDigestStore implements DigestStore {
  private readonly rows: StoredDigest[] = [];
  private next = 1n;

  async insert(row: DigestInsert): Promise<DigestRecord> {
    const saved: StoredDigest = { ...row, id: this.next++, closedAt: null, seenAt: null, body: clone(row.body) };
    this.rows.push(saved);
    return copy(saved);
  }

  async save(id: bigint, body: AwayDigestV1, lastEventSeq: bigint, closedAt?: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    row.body = clone(body);
    row.lastEventSeq = lastEventSeq;
    if (closedAt) row.closedAt = closedAt;
  }

  async commitMerge(merge: DigestMerge): Promise<void> {
    const newest = this.rows.find((r) => r.id === merge.newestId);
    if (newest) {
      newest.body = clone(merge.body);
      newest.lastEventSeq = merge.lastEventSeq;
    }
    const older = new Set(merge.olderIds);
    for (const row of this.rows) if (older.has(row.id)) row.seenAt = merge.seenAt;
  }

  async findOpen(colonyId: string): Promise<DigestRecord | null> {
    const open = this.rows.filter((r) => r.colonyId === colonyId && r.closedAt === null);
    const row = open.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime() || Number(b.id - a.id))[0];
    return row ? copy(row) : null;
  }

  async listOpen(): Promise<DigestRecord[]> {
    return this.rows.filter((r) => r.closedAt === null).map(copy);
  }

  async listUnseen(colonyId: string): Promise<DigestRecord[]> {
    return this.rows
      .filter((r) => r.colonyId === colonyId && r.seenAt === null)
      .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime() || Number(a.id - b.id))
      .map(copy);
  }

  async latestUnseen(colonyId: string): Promise<DigestRecord | null> {
    const row = this.rows
      .filter((r) => r.colonyId === colonyId && r.seenAt === null)
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime() || Number(b.id - a.id))[0];
    return row ? copy(row) : null;
  }

  async markClosedUnseen(colonyId: string, seenAt: Date): Promise<void> {
    for (const row of this.rows) {
      if (row.colonyId === colonyId && row.seenAt === null && row.closedAt !== null) row.seenAt = seenAt;
    }
  }

  async purgeOpenedBefore(cutoff: Date): Promise<number> {
    const before = this.rows.length;
    const keep = this.rows.filter((r) => r.openedAt.getTime() >= cutoff.getTime());
    this.rows.splice(0, this.rows.length, ...keep);
    return before - this.rows.length;
  }

  async count(): Promise<number> {
    return this.rows.length;
  }
}

function clone(body: AwayDigestV1): AwayDigestV1 {
  return JSON.parse(JSON.stringify(body)) as AwayDigestV1;
}

function copy(row: StoredDigest): DigestRecord {
  return { ...row, body: clone(row.body) };
}
