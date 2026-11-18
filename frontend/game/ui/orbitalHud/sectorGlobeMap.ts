import {
  W11_SEVEN_SECTOR_COORDS,
  formatSectorId,
  type PlanetSummaryV1,
  type SectorId,
} from '@terra/contracts';
import type { OrbitalGlobeMarkerInput } from '@terra/render/orbit/types';
import type { SectorIntentV1 } from '../lobby/orbitalPickerModel';

interface SectorSphereAngle {
  readonly yaw: number;
  readonly pitch: number;
}

// Distributed clearly across the camera-facing hemisphere as a cohesive 7-sector honeycomb
// following the curved planet surface without needing strict micro-scale fidelity.
const SECTOR_SPHERE_ANGLES: Readonly<Record<SectorId, SectorSphereAngle>> = (() => {
  const map: Record<string, SectorSphereAngle> = {};
  for (const [mq, mr] of W11_SEVEN_SECTOR_COORDS) {
    const id = formatSectorId(mq, mr);
    const hx = Math.sqrt(3) * (mq + mr * 0.5);
    const hy = 1.5 * mr;
    map[id] = {
      yaw: Number((hx * 0.205 - 0.02).toFixed(3)),
      pitch: Number((-hy * 0.205 + 0.04).toFixed(3)),
    };
  }
  return map;
})();

export function getSectorSphereAngle(sectorId: SectorId, fallbackIdx = 0): SectorSphereAngle {
  if (sectorId in SECTOR_SPHERE_ANGLES) {
    return SECTOR_SPHERE_ANGLES[sectorId]!;
  }
  const angle = (fallbackIdx % 6) * (Math.PI / 3);
  return {
    yaw: Math.cos(angle) * 0.42,
    pitch: Math.sin(angle) * 0.36,
  };
}

/**
 * Picks which sector the orbital targeting reticle points to (`hovered` > `chosen` > first open land sector).
 */
export function resolveTargetSectorId(
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  hoveredSectorId: string | null,
): SectorId {
  const land = summary.sectors.filter((s) => s.kind === 'land');
  if (hoveredSectorId && land.some((s) => s.sectorId === hoveredSectorId)) {
    return hoveredSectorId;
  }
  if (intent.mode === 'chosen' && land.some((s) => s.sectorId === intent.sectorId)) {
    return intent.sectorId;
  }
  const firstOpen = land.find((s) => s.freeSeats > 0) ?? land[0];
  return firstOpen?.sectorId ?? 'sec_0_0';
}

/**
 * Builds the 3D globe surface markers from real `PlanetSummaryV1` sector & colony/bot data.
 */
export function buildOrbitalGlobeMarkers(
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  hoveredSectorId: string | null,
): OrbitalGlobeMarkerInput[] {
  const targetSectorId = resolveTargetSectorId(summary, intent, hoveredSectorId);
  const colonies = summary.colonies ?? [];
  const playersBySector = new Map<string, number>();
  const botsBySector = new Map<string, number>();

  for (const col of colonies) {
    const sid = col.foundingSectorId;
    if (col.isBot) botsBySector.set(sid, (botsBySector.get(sid) ?? 0) + 1);
    else playersBySector.set(sid, (playersBySector.get(sid) ?? 0) + 1);
  }

  const landSectors = summary.sectors.filter((s) => s.kind === 'land');
  const markers: OrbitalGlobeMarkerInput[] = landSectors.map((sec, idx) => {
    const pos = getSectorSphereAngle(sec.sectorId, idx);
    const bots = botsBySector.get(sec.sectorId) ?? 0;
    const playersFromSec = Math.max(0, (sec.livingColonies ?? sec.foundedSeats) - bots);
    const players = Math.max(playersBySector.get(sec.sectorId) ?? 0, playersFromSec);
    const isTarget = sec.sectorId === targetSectorId;
    const role: OrbitalGlobeMarkerInput['role'] = isTarget
      ? 'target'
      : players > 0
        ? 'player'
        : bots > 0
          ? 'bot'
          : 'sector';
    return {
      id: sec.sectorId,
      yaw: pos.yaw,
      pitch: pos.pitch,
      role,
      players,
      bots,
    };
  });

  // If planet reports bots/players without per-sector colony coordinates, highlight the central node visibly.
  if (colonies.length === 0) {
    const totalBots = summary.botColonies ?? 0;
    const totalPlayers = summary.playerColonies ?? (summary.livingColonies ?? 0);
    if ((totalBots > 0 || totalPlayers > 0) && markers.length > 0) {
      const m0 = markers[0]!;
      markers[0] = {
        ...m0,
        players: Math.max(m0.players ?? 0, totalPlayers),
        bots: Math.max(m0.bots ?? 0, totalBots),
      };
    }
  }

  return markers;
}
