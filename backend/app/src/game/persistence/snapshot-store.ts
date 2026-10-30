import { crc32, gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { RepositoryBase, type PrismaClient } from '@terra/db';
import { SIM_VERSION } from '@terra/sim';
import { PRISMA } from '../../db/db.module';
import { prunableIds } from './retention';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const SNAPSHOT_CODEC = 'msgpack+gz';
export type SnapshotKind = 'PERIODIC' | 'SHUTDOWN' | 'SEAL' | 'END' | 'HOURLY';

export interface SavedSnapshot {
  readonly planetId: string;
  readonly tick: number;
  readonly kind: SnapshotKind;
  readonly simVersion: number;
  readonly savedAt: Date;
  readonly sizeBytes: number;
  readonly rawBytes: number;
}

export interface LoadedSnapshot extends SavedSnapshot {
  /** Uncompressed engine snapshot, ready for `restore()` (a standalone copy, not a view on Node's buffer pool). */
  readonly raw: Uint8Array;
}

/** `world.planet_snapshot` (DATA_MODEL §4.2): gzip + crc on the main thread, never on a sim thread. */
@Injectable()
export class SnapshotStore extends RepositoryBase {
  constructor(@Inject(PRISMA) prisma: PrismaClient) {
    super(prisma);
  }

  async save(planetId: string, tick: number, kind: SnapshotKind, rawBytes: Uint8Array, savedAt = new Date()): Promise<SavedSnapshot> {
    const data = await gzipAsync(rawBytes);
    const row = {
      planetId, tick: BigInt(tick), simVersion: SIM_VERSION, codec: SNAPSHOT_CODEC, sizeBytes: data.length, rawBytes: rawBytes.length,
      crc32: crc32(data) | 0, kind, savedAt, data,
    };
    await this.prisma.planetSnapshot.upsert({ where: { planetId_tick: { planetId, tick: row.tick } }, create: row, update: row });
    return { planetId, tick, kind, simVersion: SIM_VERSION, savedAt, sizeBytes: row.sizeBytes, rawBytes: row.rawBytes };
  }

  /** Newest intact snapshot; a crc or decompression failure falls back to the previous one. */
  async latest(planetId: string, onCorrupt?: (tick: bigint) => void): Promise<LoadedSnapshot | null> {
    let below: bigint | undefined;
    for (;;) {
      const row = await this.prisma.planetSnapshot.findFirst({
        where: { planetId, ...(below === undefined ? {} : { tick: { lt: below } }) }, orderBy: { tick: 'desc' },
      });
      if (!row) return null;
      if ((crc32(row.data) | 0) === row.crc32) {
        try {
          const raw = await gunzipAsync(row.data);
          return { planetId, tick: Number(row.tick), kind: row.kind, simVersion: row.simVersion, savedAt: row.savedAt, sizeBytes: row.sizeBytes, rawBytes: row.rawBytes, raw: new Uint8Array(raw) };
        } catch { /* corrupt despite crc: fall through */ }
      }
      onCorrupt?.(row.tick);
      below = row.tick;
    }
  }

  /** W00 rule: every planet whose newest snapshot is not `END`. */
  async livePlanetIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ planet_id: string }[]>`
      SELECT planet_id FROM (
        SELECT DISTINCT ON (planet_id) planet_id, kind FROM world.planet_snapshot ORDER BY planet_id, tick DESC
      ) latest WHERE kind <> 'END' ORDER BY planet_id`;
    return rows.map((r) => r.planet_id);
  }

  /** Applies the retention rule (DATA_MODEL §6); returns the number of deleted rows. */
  async prune(planetId: string, now = new Date()): Promise<number> {
    const rows = await this.prisma.planetSnapshot.findMany({ where: { planetId }, select: { id: true, tick: true, kind: true, savedAt: true } });
    const ids = prunableIds(rows, now);
    if (ids.length === 0) return 0;
    return (await this.prisma.planetSnapshot.deleteMany({ where: { id: { in: ids } } })).count;
  }
}
