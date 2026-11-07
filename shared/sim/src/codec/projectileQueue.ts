import type { Blob } from '../kernel/state';
import type { PendingProjectileImpact, ProjectileImpactsBlob, ProjectileWeaponKind } from '../systems/combat/projectiles';

const ROW_KEYS = new Set(['id', 'attackerId', 'attackerOwner', 'targetId', 'weaponId', 'weaponKind', 'from', 'to', 'damage', 'speed', 'aoe', 'firedTick', 'impactTick']);
const POINT_KEYS = new Set(['x', 'y', 'q', 'r']);
interface ExtraFields { row?: Record<string, unknown>; from?: Record<string, unknown>; to?: Record<string, unknown>; missing?: number[] }
type PackedImpact = [
  id: number, attackerId: number, attackerOwner: number, targetId: number,
  weaponId: string, weaponKind: ProjectileWeaponKind,
  fromX: number, fromY: number, fromQ: number, fromR: number,
  toX: number, toY: number, toQ: number, toR: number,
  damage: number, speed: number, aoe: number, firedTick: number, impactTick: number,
  extras?: ExtraFields,
];
export type PackedProjectileQueue = [version: 1, changedAt: number, nextProjectileId: number, rows: PackedImpact[]];

function extras(value: object, known: ReadonlySet<string>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([key, item]) => !known.has(key) && item !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function packImpact(p: PendingProjectileImpact): PackedImpact {
  const row: PackedImpact = [p.id, p.attackerId, p.attackerOwner, p.targetId, p.weaponId, p.weaponKind,
    p.from.x, p.from.y, p.from.q, p.from.r, p.to.x, p.to.y, p.to.q, p.to.r,
    p.damage, p.speed, p.aoe, p.firedTick, p.impactTick];
  const extra: ExtraFields = { row: extras(p, ROW_KEYS), from: extras(p.from, POINT_KEYS), to: extras(p.to, POINT_KEYS) };
  for (let i = 0; i < row.length; i++) {
    if (row[i] === undefined) { (extra.missing ??= []).push(i); (row as unknown[])[i] = null; }
  }
  if (extra.row || extra.from || extra.to || extra.missing) row.push(extra);
  return row;
}

function unpackImpact(row: PackedImpact): PendingProjectileImpact {
  if (row.length < 19 || row.length > 20) throw new Error('invalid packed projectile row');
  const values = [...row] as PackedImpact;
  for (const index of row[19]?.missing ?? []) (values as unknown[])[index] = undefined;
  const [id, attackerId, attackerOwner, targetId, weaponId, weaponKind,
    fx, fy, fq, fr, tx, ty, tq, tr, damage, speed, aoe, firedTick, impactTick, extra] = values;
  return { ...extra?.row, id, attackerId, attackerOwner, targetId, weaponId, weaponKind,
    from: { ...extra?.from, x: fx, y: fy, q: fq, r: fr }, to: { ...extra?.to, x: tx, y: ty, q: tq, r: tr },
    damage, speed, aoe, firedTick, impactTick };
}

/** Lossless full-queue wire packing; canonical state and snapshots retain their named object fields. */
export function packProjectileQueue(blob: Blob): PackedProjectileQueue {
  const value = blob.value as ProjectileImpactsBlob;
  return [1, blob.changedAt, value.nextProjectileId, value.queue.map(packImpact)];
}

export function unpackProjectileQueue(packed: PackedProjectileQueue): Blob {
  if (packed[0] !== 1) throw new Error(`unsupported projectile queue format ${packed[0]}`);
  return { changedAt: packed[1], value: { nextProjectileId: packed[2], queue: packed[3].map(unpackImpact) } };
}
