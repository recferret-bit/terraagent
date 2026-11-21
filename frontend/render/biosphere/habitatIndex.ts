import { HEX_DIRS, hexDistance, hexIndex, mixGroundSeed } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../planets/PlanetSpec';
import { HEX_TERRAIN, isClearedPrep, tileHash01, type HexTileLayers } from '../planets/hex/chunkMesh';
import { planetExtent, tileAt, tileXZ } from '../planets/hex/hexMath';
import type { BiosphereHabitatIndex, HabitatAnchor } from './biosphereTypes';

function subsampleAnchors(list: HabitatAnchor[], cap: number): HabitatAnchor[] {
  if (list.length <= cap) return list;
  const out: HabitatAnchor[] = [];
  const step = list.length / cap;
  for (let k = 0; k < cap; k++) out.push(list[Math.floor(k * step)]!);
  return out;
}

export function buildHexHabitatIndex(
  radius: number,
  layers: HexTileLayers,
  look: PlanetSpec,
  heightAt: (x: number, z: number) => number,
): BiosphereHabitatIndex {
  const hx = hexIndex(radius);
  const ext = planetExtent(radius);
  const forestRaw: HabitatAnchor[] = [];
  const forestTileSet = new Set<number>();
  const waterRaw: HabitatAnchor[] = [];
  const grassRaw: HabitatAnchor[] = [];
  const rockRaw: HabitatAnchor[] = [];
  const colonizedRaw: HabitatAnchor[] = [];
  const terrain = layers.terrain;

  const innerRadius = Math.max(2, radius - 2);
  if (terrain) {
    for (let i = 0; i < hx.count; i++) {
      const q = hx.q[i]!, r = hx.r[i]!;
      if (hexDistance(0, 0, q, r) > innerRadius) continue;
      const [x, z] = tileXZ(q, r);
      const t = terrain[i] ?? 0;
      const prep = layers.prep?.[i] ?? 0;
      const owner = layers.owner?.[i] ?? -1;

      if (owner >= 0 || isClearedPrep(prep)) {
        colonizedRaw.push({ x, z, tileIndex: i });
        continue;
      }

      if (t === HEX_TERRAIN.forest) {
        forestRaw.push({ x, z, tileIndex: i });
        forestTileSet.add(i);
      } else if (t === HEX_TERRAIN.flat) {
        grassRaw.push({ x, z, tileIndex: i });
        if (look.kind === 'dune' && (layers.height[i] ?? 0) < 0.45 && tileHash01(q, r, mixGroundSeed(layers.seed ?? look.seed, 503)) > 0.72) {
          waterRaw.push({ x, z, tileIndex: i });
        }
      } else if (t === HEX_TERRAIN.rock) {
        rockRaw.push({ x, z, tileIndex: i });
      } else if (look.kind === 'dune' && t === HEX_TERRAIN.shallow) {
        waterRaw.push({ x, z, tileIndex: i });
      }

      if (look.kind !== 'dune' && (t === HEX_TERRAIN.flat || t === HEX_TERRAIN.forest || t === HEX_TERRAIN.slope)) {
        for (const [dq, dr] of HEX_DIRS) {
          const nb = hx.indexOf(q + dq, r + dr);
          if (nb >= 0 && (terrain[nb] === HEX_TERRAIN.shallow || terrain[nb] === HEX_TERRAIN.deep)) {
            waterRaw.push({ x, z, tileIndex: i });
            break;
          }
        }
      }
    }
  }

  const isInBounds = (x: number, z: number): boolean => {
    const pick = tileAt(radius, x, z);
    return pick !== null && hexDistance(0, 0, pick.q, pick.r) <= innerRadius;
  };

  return {
    halfSize: ext.z,
    forestAnchors: subsampleAnchors(forestRaw, 220),
    forestTileSet,
    waterAnchors: subsampleAnchors(waterRaw.length > 0 ? waterRaw : grassRaw, 160),
    grassAnchors: subsampleAnchors(grassRaw.length > 0 ? grassRaw : forestRaw, 220),
    rockAnchors: subsampleAnchors(rockRaw, 120),
    colonizedAnchors: subsampleAnchors(colonizedRaw, 160),
    isInBounds,
    isPassableLand(x, z) {
      const pick = tileAt(radius, x, z);
      if (!pick || !terrain || hexDistance(0, 0, pick.q, pick.r) > innerRadius) return false;
      const t = terrain[pick.i] ?? 0;
      if (t === HEX_TERRAIN.hole) return false;
      if (look.kind !== 'dune' && (t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep)) return false;
      return true;
    },
    heightAt,
  };
}

export function buildContinuousHabitatIndex(
  halfSize: number,
  look: PlanetSpec,
  heightAt: (x: number, z: number) => number,
  waterLevel: number | null,
): BiosphereHabitatIndex {
  const forestAnchors: HabitatAnchor[] = [];
  const waterAnchors: HabitatAnchor[] = [];
  const grassAnchors: HabitatAnchor[] = [];
  const rockAnchors: HabitatAnchor[] = [];
  const forestTileSet = new Set<number>();
  const span = halfSize * 0.88;
  const step = Math.max(8, (span * 2) / 14);
  let idx = 0;

  for (let z = -span; z <= span; z += step) {
    for (let x = -span; x <= span; x += step) {
      idx++;
      const y = heightAt(x, z);
      if (waterLevel !== null && y <= waterLevel + 0.08) continue;
      if (waterLevel !== null && y <= waterLevel + 1.1) {
        waterAnchors.push({ x, z, tileIndex: idx });
      } else if (y > 4.2) {
        rockAnchors.push({ x, z, tileIndex: idx });
      } else if (((idx * 37 + look.seed) % 3) === 0) {
        forestAnchors.push({ x, z, tileIndex: idx });
        forestTileSet.add(idx);
      } else {
        grassAnchors.push({ x, z, tileIndex: idx });
        if (look.kind === 'dune' && y < 0.9) waterAnchors.push({ x, z, tileIndex: idx });
      }
    }
  }

  return {
    halfSize,
    forestAnchors,
    forestTileSet,
    waterAnchors: waterAnchors.length > 0 ? waterAnchors : grassAnchors,
    grassAnchors: grassAnchors.length > 0 ? grassAnchors : forestAnchors,
    rockAnchors,
    colonizedAnchors: [],
    isInBounds(x, z) {
      return Math.abs(x) <= halfSize * 0.90 && Math.abs(z) <= halfSize * 0.90;
    },
    isPassableLand(x, z) {
      if (Math.abs(x) > halfSize * 0.92 || Math.abs(z) > halfSize * 0.92) return false;
      if (waterLevel !== null && heightAt(x, z) <= waterLevel + 0.06) return false;
      return true;
    },
    heightAt,
  };
}
