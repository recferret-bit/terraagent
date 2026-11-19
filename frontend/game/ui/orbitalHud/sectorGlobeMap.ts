import {
  W11_SEVEN_SECTOR_COORDS,
  formatSectorId,
  planetLookForType,
  type PlanetSummaryV1,
  type PublicColonySummaryV1,
  type SectorId,
} from '@terra/contracts';
import type { OrbitalGlobeMarkerInput } from '@terra/render/orbit/types';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { ActiveHomeColony } from '../../../design/pilot/activeHomeColony';
import { resolvePlanetPopulationCounts, type SectorIntentV1 } from '../lobby/orbitalPickerModel';

export interface SectorSphereAngle {
  readonly yaw: number;
  readonly pitch: number;
}

export interface SectorPopulationEntry {
  readonly players: number;
  readonly bots: number;
  readonly colonies: readonly PublicColonySummaryV1[];
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function hash13(x: number, y: number, z: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = fract(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d;
  py += d;
  pz += d;
  return fract((px + py) * pz);
}

function vnoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash13(ix, iy, iz);
  const b = hash13(ix + 1, iy, iz);
  const c = hash13(ix, iy + 1, iz);
  const d = hash13(ix + 1, iy + 1, iz);
  const e = hash13(ix, iy, iz + 1);
  const g = hash13(ix + 1, iy, iz + 1);
  const h = hash13(ix, iy + 1, iz + 1);
  const k = hash13(ix + 1, iy + 1, iz + 1);
  const x00 = a + (b - a) * fx;
  const x10 = c + (d - c) * fx;
  const x01 = e + (g - e) * fx;
  const x11 = h + (k - h) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

function fbm3(x: number, y: number, z: number): number {
  let a = 0.5;
  let s = 0;
  let n = 0;
  for (let i = 0; i < 6; i++) {
    s += a * vnoise3(x, y, z);
    n += a;
    const nx = (-0.8 * y - 0.6 * z) * 2.03 + 11.7;
    const ny = (0.8 * x + 0.36 * y - 0.48 * z) * 2.03 + 11.7;
    const nz = (0.6 * x - 0.48 * y + 0.64 * z) * 2.03 + 11.7;
    x = nx;
    y = ny;
    z = nz;
    a *= 0.5;
  }
  return s / n;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Mirrors the PlanetGlobe surface fragment heightfield so 3D sectors on ocean/temperate planets sit on verified continents.
 */
export function sampleGlobeLandHeight(
  kind: PlanetKind,
  yaw: number,
  pitch: number,
  spinY = 0,
): number {
  const spec = PLANET_SPECS[kind];
  const cp = Math.cos(pitch);
  const wx = Math.sin(yaw) * cp;
  const wy = Math.sin(pitch);
  const wz = Math.cos(yaw) * cp;
  const cy = Math.cos(-spinY);
  const sy = Math.sin(-spinY);
  const rx = wx * cy + wz * sy;
  const ry = wy;
  const rz = -wx * sy + wz * cy;
  const tilt = spec.orbital.axialTilt;
  const ct = Math.cos(-tilt);
  const st = Math.sin(-tilt);
  const px = rx * ct - ry * st;
  const py = rx * st + ry * ct;
  const pz = rz;
  const uSeed = spec.seed % 997;
  const qx = px * 2.1 + uSeed * 0.37;
  const qy = py * 2.1 + uSeed * 0.11;
  const qz = pz * 2.1 + uSeed * 0.23;
  const w = fbm3(qx * 1.7 + 3.1, qy * 1.7 + 3.1, qz * 1.7 + 3.1);
  const d = (w - 0.5) * 0.9;
  return smoothstep(0.22, 0.78, fbm3(qx + d, qy + d, qz + d));
}

export const HEX_OUTER_ANGULAR_RADIUS = 0.106;
const MIN_CENTER_SEPARATION = 0.232;

export function sphericalSectorAngle(a: SectorSphereAngle, b: SectorSphereAngle): number {
  const ax = Math.sin(a.yaw) * Math.cos(a.pitch);
  const ay = Math.sin(a.pitch);
  const az = Math.cos(a.yaw) * Math.cos(a.pitch);
  const bx = Math.sin(b.yaw) * Math.cos(b.pitch);
  const by = Math.sin(b.pitch);
  const bz = Math.cos(b.yaw) * Math.cos(b.pitch);
  return Math.acos(Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz)));
}

const PLANET_HEX_LAYOUT: Readonly<Record<PlanetKind, { cyaw: number; cpitch: number; sx: number; sy: number }>> = {
  dune: { cyaw: 0.02, cpitch: 0.05, sx: 0.152, sy: 0.148 },
  oceanForest: { cyaw: 0.06, cpitch: 0.16, sx: 0.156, sy: 0.148 },
  forestRock: { cyaw: -0.02, cpitch: -0.04, sx: 0.152, sy: 0.148 },
};

function sampleHexFootprintMinHeight(kind: PlanetKind, yaw: number, pitch: number, r = 0.055): number {
  let minH = sampleGlobeLandHeight(kind, yaw, pitch);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const h = sampleGlobeLandHeight(kind, yaw + Math.cos(a) * r, pitch + Math.sin(a) * r);
    if (h < minH) minH = h;
  }
  return minH;
}

function findVerifiedLandSpot(
  kind: PlanetKind,
  baseYaw: number,
  basePitch: number,
  placed: readonly SectorSphereAngle[],
): SectorSphereAngle {
  const seaLevel = PLANET_SPECS[kind].orbital.seaLevel;
  const fullHexTarget = seaLevel + 0.02;
  const centerMin = seaLevel + 0.03;
  const clearOfOthers = (y: number, p: number) =>
    placed.every((o) => sphericalSectorAngle({ yaw: y, pitch: p }, o) >= MIN_CENTER_SEPARATION);

  let bestLand: { pos: SectorSphereAngle; score: number } | null = null;
  let bestAny: { pos: SectorSphereAngle; score: number } | null = null;
  for (const rad of [0, 0.04, 0.08, 0.12, 0.16, 0.20, 0.25, 0.30, 0.36, 0.42]) {
    const steps = rad === 0 ? 1 : 24;
    for (let k = 0; k < steps; k++) {
      const a = (k * Math.PI * 2) / steps;
      const y = baseYaw + Math.cos(a) * rad;
      const p = Math.max(-0.56, Math.min(0.56, basePitch + Math.sin(a) * rad));
      if (Math.abs(y) > 0.68 || !clearOfOthers(y, p)) continue;
      const pos = { yaw: Number(y.toFixed(3)), pitch: Number(p.toFixed(3)) };
      const footprintH = sampleHexFootprintMinHeight(kind, y, p, 0.055);
      if (footprintH >= fullHexTarget) return pos;
      const centerH = sampleGlobeLandHeight(kind, y, p);
      if (centerH >= centerMin && (!bestLand || footprintH > bestLand.score)) {
        bestLand = { pos, score: footprintH };
      }
      if (!bestAny || centerH > bestAny.score) {
        bestAny = { pos, score: centerH };
      }
    }
  }
  return bestLand?.pos ?? bestAny?.pos ?? { yaw: Number(baseYaw.toFixed(3)), pitch: Number(basePitch.toFixed(3)) };
}

const SECTOR_ANGLES_BY_KIND: Readonly<Record<PlanetKind, Readonly<Record<SectorId, SectorSphereAngle>>>> = (() => {
  const byKind = {} as Record<PlanetKind, Record<SectorId, SectorSphereAngle>>;
  for (const kind of PLANET_KINDS) {
    const cfg = PLANET_HEX_LAYOUT[kind];
    const map: Record<string, SectorSphereAngle> = {};
    const placed: SectorSphereAngle[] = [];
    for (const [mq, mr] of W11_SEVEN_SECTOR_COORDS) {
      const id = formatSectorId(mq, mr);
      const hx = Math.sqrt(3) * (mq + mr * 0.5);
      const hy = 1.5 * mr;
      const pos = findVerifiedLandSpot(kind, cfg.cyaw + hx * cfg.sx, cfg.cpitch - hy * cfg.sy, placed);
      map[id] = pos;
      placed.push(pos);
    }
    byKind[kind] = map;
  }
  return byKind;
})();

export function getSectorSphereAngle(
  sectorId: SectorId,
  fallbackIdx = 0,
  kind: PlanetKind = 'dune',
): SectorSphereAngle {
  const table = SECTOR_ANGLES_BY_KIND[kind];
  if (sectorId in table) return table[sectorId]!;
  const angle = (fallbackIdx % 6) * (Math.PI / 3);
  return { yaw: Math.cos(angle) * 0.36, pitch: Math.sin(angle) * 0.32 };
}

/**
 * Resolves consistent per-sector player & bot counts matching the planet totals.
 */
export function resolveSectorPopulationMap(summary: PlanetSummaryV1): Map<SectorId, SectorPopulationEntry> {
  const landSectors = summary.sectors.filter((s) => s.kind === 'land');
  const fallbackSec = landSectors[0]?.sectorId ?? 'sec_0_0';
  const landSet = new Set(landSectors.map((s) => s.sectorId));

  const counts = new Map<SectorId, { players: number; bots: number; colonies: PublicColonySummaryV1[] }>();
  for (const sec of landSectors) {
    counts.set(sec.sectorId, { players: 0, bots: 0, colonies: [] });
  }

  for (const col of summary.colonies ?? []) {
    const sid = landSet.has(col.foundingSectorId) ? col.foundingSectorId : fallbackSec;
    const bucket = counts.get(sid);
    if (!bucket) continue;
    bucket.colonies.push(col);
    if (col.isBot) bucket.bots += 1;
    else bucket.players += 1;
  }

  for (const sec of landSectors) {
    const bucket = counts.get(sec.sectorId)!;
    const occ = Math.max(sec.foundedSeats, sec.livingColonies ?? 0);
    if (bucket.players + bucket.bots < occ) {
      bucket.players += occ - (bucket.players + bucket.bots);
    }
  }

  const pop = resolvePlanetPopulationCounts(summary);
  let assignedPlayers = 0;
  let assignedBots = 0;
  for (const b of counts.values()) {
    assignedPlayers += b.players;
    assignedBots += b.bots;
  }

  if (landSectors.length > 0) {
    let extraPlayers = Math.max(0, pop.players - assignedPlayers);
    let idx = 0;
    while (extraPlayers > 0) {
      const sid = landSectors[idx % landSectors.length]!.sectorId;
      counts.get(sid)!.players += 1;
      extraPlayers -= 1;
      idx += 1;
    }
    let extraBots = Math.max(0, pop.bots - assignedBots);
    let botIdx = landSectors.length > 1 ? 1 : 0;
    while (extraBots > 0) {
      const sid = landSectors[botIdx % landSectors.length]!.sectorId;
      counts.get(sid)!.bots += 1;
      extraBots -= 1;
      botIdx += 1;
    }
  }
  return counts;
}

/**
 * Resolves the fixed sector for ACTIVE BASE so selecting or hovering target drop sectors never makes it jump.
 */
export function resolveHomeBaseSectorId(
  summary: PlanetSummaryV1,
  activeColony: ActiveHomeColony | null,
): SectorId | null {
  const land = summary.sectors.filter((s) => s.kind === 'land');
  const landSet = new Set(land.map((s) => s.sectorId));
  const colonies = summary.colonies ?? [];

  if (activeColony && planetLookForType(summary.type) === activeColony.kind) {
    if (
      activeColony.foundingSectorId &&
      (landSet.size === 0 || landSet.has(activeColony.foundingSectorId))
    ) {
      return activeColony.foundingSectorId;
    }
    const match = colonies.find(
      (c) => c.colonyId === activeColony.colonyId || c.displayName === activeColony.colonyName,
    );
    if (match && landSet.has(match.foundingSectorId)) return match.foundingSectorId;
    return land.find((s) => s.foundedSeats > 0)?.sectorId ?? land[0]?.sectorId ?? 'sec_0_0';
  }

  const humanCol = colonies.find((c) => !c.isBot && landSet.has(c.foundingSectorId));
  if (humanCol) return humanCol.foundingSectorId;
  const anyCol = colonies.find((c) => landSet.has(c.foundingSectorId));
  if (anyCol) return anyCol.foundingSectorId;

  const popMap = resolveSectorPopulationMap(summary);
  for (const sec of land) {
    const p = popMap.get(sec.sectorId);
    if (p && p.players > 0) return sec.sectorId;
  }
  for (const sec of land) {
    const p = popMap.get(sec.sectorId);
    if (p && p.bots > 0) return sec.sectorId;
  }
  return null;
}

/**
 * Picks which sector the orbital targeting reticle points to (`hovered` > `chosen` > first open land sector).
 */
export function resolveTargetSectorId(
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  hoveredSectorId: string | null,
  homeBaseSectorId?: string | null,
): SectorId {
  const land = summary.sectors.filter((s) => s.kind === 'land');
  if (hoveredSectorId && land.some((s) => s.sectorId === hoveredSectorId)) return hoveredSectorId;
  if (intent.mode === 'chosen' && land.some((s) => s.sectorId === intent.sectorId)) return intent.sectorId;
  if (
    intent.mode === 'auto' &&
    homeBaseSectorId &&
    (land.length === 0 || land.some((s) => s.sectorId === homeBaseSectorId))
  ) {
    return homeBaseSectorId;
  }
  return (land.find((s) => s.freeSeats > 0) ?? land[0])?.sectorId ?? 'sec_0_0';
}

/**
 * Builds the 3D globe hex sector markers (max 7 on the visible hemisphere) from `PlanetSummaryV1`.
 */
export function buildOrbitalGlobeMarkers(
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  hoveredSectorId: string | null,
  kind?: PlanetKind,
  activeColony: ActiveHomeColony | null = null,
): OrbitalGlobeMarkerInput[] {
  const resolvedKind = kind ?? planetLookForType(summary.type);
  const homeBaseSectorId = resolveHomeBaseSectorId(summary, activeColony);
  const targetSectorId = resolveTargetSectorId(
    summary,
    intent,
    hoveredSectorId,
    activeColony ? homeBaseSectorId : null,
  );
  const popMap = resolveSectorPopulationMap(summary);
  const landSectors = summary.sectors.filter((s) => s.kind === 'land').slice(0, 8);

  return landSectors.map((sec, idx) => {
    const pos = getSectorSphereAngle(sec.sectorId, idx, resolvedKind);
    const pop = popMap.get(sec.sectorId) ?? { players: 0, bots: 0, colonies: [] };
    const isTarget = sec.sectorId === targetSectorId;
    const role: OrbitalGlobeMarkerInput['role'] = isTarget
      ? 'target'
      : pop.players > 0
        ? 'player'
        : pop.bots > 0
          ? 'bot'
          : 'sector';
    return {
      id: sec.sectorId,
      yaw: pos.yaw,
      pitch: pos.pitch,
      role,
      players: pop.players,
      bots: pop.bots,
      isHomeBase: sec.sectorId === homeBaseSectorId,
    };
  });
}
