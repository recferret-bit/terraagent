import { getActiveHexTerrains, HEX_TERRAIN, tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import type { ActiveTwisterSnapshot, OverloadedBuildingTarget, TwisterFx } from '@terra/render/weather';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import type * as THREE from 'three';
import type { FeatureContext } from '../../../core/registry/types';
import { forEachEntity, type ClientView } from '../../../store/replica/viewCodec';
import type { WeatherBlobView } from '../weatherRenderer';

export const resolveScene = (ctx: FeatureContext): THREE.Scene | null =>
  ctx.services.scene3d?.scene ?? (ctx.services as { scene?: THREE.Scene }).scene ?? null;

export const resolveHexTerrain = (ctx: FeatureContext): HexTerrain | null =>
  (ctx.services as { hexTerrain?: HexTerrain | null }).hexTerrain ?? [...getActiveHexTerrains()][0] ?? null;

export const resolveCamera = (ctx: FeatureContext): THREE.Camera | null => {
  const svc = ctx.services as {
    camera?: THREE.Camera | null;
    rtsCamera?: { camera?: THREE.Camera | null } | null;
    scene3d?: { camera?: THREE.Camera | null } | null;
  };
  return svc.camera ?? svc.rtsCamera?.camera ?? svc.scene3d?.camera ?? null;
};

export function resolveHeightAt(ctx: FeatureContext): (x: number, z: number) => number {
  const s3 = ctx.services.scene3d;
  const hexTerrain = resolveHexTerrain(ctx);
  if (hexTerrain && typeof hexTerrain.heightAt === 'function') return (x, z) => hexTerrain.heightAt(x, z);
  if (s3) return () => s3.tileToWorld(0, 0).y ?? 0;
  return () => 0;
}

export function computeCraterDiscTiles(
  q: number,
  r: number,
  tiles?: ReadonlyArray<{ q: number; r: number }>,
): Array<{ q: number; r: number }> {
  if (tiles && tiles.length >= 37) return [...tiles];
  const seen = new Set<string>();
  const out: Array<{ q: number; r: number }> = [];
  const push = (tq: number, tr: number) => {
    const k = `${tq},${tr}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ q: tq, r: tr });
    }
  };
  for (const t of tiles ?? []) push(t.q, t.r);
  for (let dr = -3; dr <= 3; dr++) {
    for (let dq = -3; dq <= 3; dq++) {
      if (hexDistance(0, 0, dq, dr) <= 3) push(q + dq, r + dr);
    }
  }
  return out;
}

export function clearMeteorTilesOnTerrain(
  terrain: HexTerrain | null,
  craterTiles: ReadonlyArray<{ q: number; r: number }>,
): void {
  if (!terrain || typeof terrain.setTileState !== 'function') return;
  const hx = hexIndex(terrain.radius);
  for (const t of craterTiles) {
    const idx = hx.indexOf(t.q, t.r);
    if (idx >= 0 && terrain.props?.instancesForTile(idx).length > 0) {
      terrain.setTileState(t.q, t.r, HEX_TERRAIN.hole, 0, undefined, 0, 0);
    }
  }
}

export function expandLightningTiles(
  tiles: ReadonlyArray<{ q: number; r: number }>,
): Array<{ q: number; r: number }> {
  if (tiles.length !== 1) return [...tiles];
  const { q, r } = tiles[0]!;
  return [{ q, r }, { q: q + 1, r }, { q, r: r + 1 }, { q: q - 1, r: r + 1 }];
}

export function clearLightningTilesOnTerrain(
  terrain: HexTerrain | null,
  tiles: ReadonlyArray<{ q: number; r: number }>,
): void {
  if (!terrain || typeof terrain.setTileState !== 'function') return;
  const hx = hexIndex(terrain.radius);
  for (const t of tiles) {
    const [wx, wz] = tileXZ(t.q, t.r);
    if (typeof terrain.heightAt === 'function' && terrain.heightAt(wx, wz) < -0.05) continue;
    const idx = hx.indexOf(t.q, t.r);
    if (idx >= 0 && (terrain.props?.instancesForTile(idx).length ?? 0) > 0) {
      terrain.setTileState(t.q, t.r, HEX_TERRAIN.hole, 0, undefined, 0, 0);
    }
  }
}

function sweepTwisterTreesAt(
  terrain: HexTerrain,
  hx: ReturnType<typeof hexIndex>,
  twisterFx: TwisterFx | null,
  id: number,
  cq: number,
  cr: number,
  extras?: ReadonlyArray<{ q: number; r: number }>,
): void {
  const checkTiles = [...(extras ?? [])];
  for (let dq = -2; dq <= 2; dq++) {
    for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++) {
      checkTiles.push({ q: cq + dq, r: cr + dr });
    }
  }
  for (const t of checkTiles) {
    const idx = hx.indexOf(t.q, t.r);
    if (idx >= 0 && terrain.props?.instancesForTile(idx).some((p) => p.kind === 'pine')) {
      twisterFx?.suckTree(id, t.q, t.r);
      terrain.setTileState(t.q, t.r, HEX_TERRAIN.flat, 0);
    }
  }
}

export function clearTwisterTreesOnTerrain(
  terrain: HexTerrain | null,
  twisterFx: TwisterFx | null,
  activeTwisters?: ReadonlyArray<ActiveTwisterSnapshot>,
): void {
  if (!terrain || typeof terrain.setTileState !== 'function') return;
  const hx = hexIndex(terrain.radius);
  for (const snap of activeTwisters ?? []) {
    sweepTwisterTreesAt(
      terrain,
      hx,
      twisterFx,
      snap.id ?? snap.twisterId ?? 1,
      Math.round(snap.x ?? snap.q ?? 0),
      Math.round(snap.y ?? snap.r ?? 0),
      snap.uprootedTrees,
    );
  }
  const map = (twisterFx as unknown as { instances?: Map<number, { id: number; x: number; z: number }> } | null)?.instances;
  for (const inst of map?.values() ?? []) {
    const r = Math.round(inst.z / Math.sqrt(3));
    const q = Math.round(inst.x / 2 - r / 2);
    sweepTwisterTreesAt(terrain, hx, twisterFx, inst.id, q, r);
  }
}

export function purgeUnsyncedPreviewTwisters(twisterFx: TwisterFx | null): void {
  const map = (twisterFx as unknown as { instances?: Map<number, { root: THREE.Group; syncedFromSim: boolean }> } | null)?.instances;
  if (!map || !twisterFx) return;
  for (const [id, inst] of [...map]) {
    if (!inst.syncedFromSim) {
      twisterFx.group.remove(inst.root);
      map.delete(id);
    }
  }
}

export function extractOverloadedBuildings(
  simView: ClientView,
  weatherBlob: WeatherBlobView | undefined,
  heightAt: (x: number, z: number) => number,
  tileToWorld?: (q: number, r: number) => { x: number; y: number; z: number },
): OverloadedBuildingTarget[] {
  const overloadMap = weatherBlob?.overloadUntilByEntity ?? {};
  const powerMap = simView.entityPower ?? {};
  const out: OverloadedBuildingTarget[] = [];

  forEachEntity(simView.entities, simView.count, (e) => {
    if (e.hp <= 0) return;
    const untilTick = overloadMap[String(e.id)] ?? overloadMap[e.id as unknown as string] ?? 0;
    const pwr = powerMap[e.id] as { overloaded?: boolean; offlineReason?: string; reason?: string } | undefined;
    const isOverloaded =
      untilTick > simView.tick ||
      pwr?.overloaded === true ||
      pwr?.offlineReason === 'overload' ||
      (typeof pwr?.reason === 'string' && pwr.reason.includes('overload')) ||
      e.state === 12;
    if (!isOverloaded) return;
    const wp = tileToWorld ? tileToWorld(e.q, e.r) : { x: (e.q + e.r / 2) * 2, y: 0, z: e.r * Math.sqrt(3) };
    out.push({ entityId: e.id, x: wp.x, y: tileToWorld ? wp.y : heightAt(wp.x, wp.z), z: wp.z, radius: 1.4, height: 2.3 });
  });
  return out;
}
