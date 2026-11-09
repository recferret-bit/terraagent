import type { AwayDigestV1, ResourceKey } from '@terra/contracts';

/** Numbers read from a sim snapshot. Building counts and terraform % are not on `AwayDigestV1` (BE-59). */
export interface DigestBaseline {
  readonly resources: Readonly<Record<ResourceKey, number>>;
  readonly energy: number;
  readonly robots: number;
  readonly territory: number;
}

export interface BaselineReader {
  read(planetId: string, colonyId: string): Promise<DigestBaseline | null>;
}

export interface DigestRecord {
  readonly id: bigint;
  readonly colonyId: string;
  readonly planetId: string;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly seenAt: Date | null;
  readonly lastEventSeq: bigint;
  readonly body: AwayDigestV1;
}

export interface DigestInsert {
  readonly colonyId: string;
  readonly planetId: string;
  readonly openedAt: Date;
  readonly lastEventSeq: bigint;
  readonly body: AwayDigestV1;
}

/** One write: merged body on the newest unseen row, `seen_at` on the older ones. */
export interface DigestMerge {
  readonly newestId: bigint;
  readonly body: AwayDigestV1;
  readonly lastEventSeq: bigint;
  readonly olderIds: readonly bigint[];
  readonly seenAt: Date;
}

export interface DigestStore {
  insert(row: DigestInsert): Promise<DigestRecord>;
  save(id: bigint, body: AwayDigestV1, lastEventSeq: bigint, closedAt?: Date): Promise<void>;
  commitMerge(merge: DigestMerge): Promise<void>;
  findOpen(colonyId: string): Promise<DigestRecord | null>;
  listOpen(): Promise<DigestRecord[]>;
  /** Unseen rows, oldest first. */
  listUnseen(colonyId: string): Promise<DigestRecord[]>;
  /** `opened_at` strictly before `cutoff`. A row opened at `cutoff` stays. */
  purgeOpenedBefore(cutoff: Date): Promise<number>;
}

export interface OpenDigest {
  id: bigint;
  planetId: string;
  colonyId: string;
  openedAt: Date;
  body: AwayDigestV1;
  lastEventSeq: bigint;
  dirty: boolean;
  /** False until a live read or a snapshot fill lands. A later snapshot may still fill a zero body (BE-59). */
  baselineFilled: boolean;
}

export interface AttackFold {
  readonly kind: 'raidStarted' | 'underAttack' | 'raidRepelled';
  readonly tick: number;
  readonly species?: string;
  readonly q?: number;
  readonly r?: number;
}

export interface DigestLog {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface PlanetEventLike {
  readonly planetId: string;
  readonly tick: number;
  readonly kind: string;
  readonly colonyIds: readonly string[];
  readonly data: unknown;
}
