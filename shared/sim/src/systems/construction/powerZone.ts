import { globalTileToSector } from '../../atlas/partition';
import type { CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { resolveHubT1Row, rowNum } from '../rows';
import type { PlacementWorld } from './placement';

/**
 * The colony power zone (W03, owner feedback "Protoss pylons"): only the Command Hub may stand anywhere on terraformed
 * ground; every other building must stand with its whole footprint inside the union of the zones of the colony's Command
 * Hubs and Power Pylons. A zone is the hex disk of radius `powerZoneRadius` (its source's row) around the source's anchor
 * tile. One rule, three readers: `evaluatePlacement` (may this site be built), the power graph (`power-core/graph.ts`:
 * which relay powers a building, which relays link) and the client's zone highlight.
 *
 * Placement counts every alive own source, also one under construction or still an open build order (a player chains
 * pylons without waiting for each to finish); the power graph only counts completed ones, so a building inside the zone
 * of an unfinished pylon stays `offline: no grid` until that pylon is built.
 *
 * The rule exists from the W03 grid on (the `grid.pylon` row): a W02-only planet has no pylon to extend a zone with, so
 * there it places as before.
 */

/** One zone source: a Command Hub or Power Pylon (built, under construction or ordered). */
export interface PowerZoneSource {
  kind: number;
  q: number;
  r: number;
  radius: number;
  sectorId?: string;
  sectorRadius?: number;
}

/** The `grid.pylon` row of `data`, or `null` when the W03 grid is off (no power zone rule). */
function pylonRow(data?: CompiledDataLike): CompiledRow | null {
  return (data?.tables?.grid as Record<string, CompiledRow> | undefined)?.pylon ?? null;
}

/** Whether the power zone rule applies with `data` (the W03 grid is compiled in). */
export function powerZoneActive(data?: CompiledDataLike): boolean {
  return pylonRow(data) !== null;
}

/** Zone radius (tiles from the anchor) of a zone source's balance row (`hub.t1` / `grid.pylon` `powerZoneRadius`). */
export const powerZoneRadiusOf = (row: CompiledRow): number => rowNum(row, 'powerZoneRadius');

/** Whether `kind` is a zone source (Command Hub or Power Pylon). */
export const isPowerZoneSourceKind = (kind: number): boolean => kind === ENTITY_KIND.commandHub || kind === ENTITY_KIND.pylon;

/** Whether tile `(q, r)` lies inside the zone of `src`. */
export const inSourceZone = (
  src: { q: number; r: number; radius: number; sectorId?: string; sectorRadius?: number },
  q: number,
  r: number,
): boolean =>
  hexDistance(src.q, src.r, q, r) <= src.radius &&
  (!src.sectorId || !src.sectorRadius || globalTileToSector(q, r, src.sectorRadius).sectorId === src.sectorId);

/** Whether tile `(q, r)` lies inside the union of `sources`. */
export const inPowerZone = (sources: readonly PowerZoneSource[], q: number, r: number): boolean =>
  sources.some((s) => inSourceZone(s, q, r));

/**
 * The zone sources of colony `colonyId` in `world` for placement: every alive own Command Hub and Power Pylon (built or
 * under construction) plus every open Power Pylon build order (`world.plannedSites`). `[]` when the rule is off.
 */
export function placementPowerZoneSources(world: PlacementWorld, colonyId: number, data?: CompiledDataLike): PowerZoneSource[] {
  const pylon = pylonRow(data);
  if (!pylon) return [];
  const hubR = powerZoneRadiusOf(resolveHubT1Row(data)), pylonR = powerZoneRadiusOf(pylon);
  const sectorRadius = world.sectorRadius;
  const out: PowerZoneSource[] = [];
  for (const e of world.entities) {
    if (e.owner !== colonyId || !isPowerZoneSourceKind(e.kind) || (e.hpMax > 0 && e.hp <= 0)) continue;
    const secProps = sectorRadius
      ? { sectorId: globalTileToSector(e.q, e.r, sectorRadius).sectorId, sectorRadius }
      : {};
    out.push({ kind: e.kind, q: e.q, r: e.r, radius: e.kind === ENTITY_KIND.pylon ? pylonR : hubR, ...secProps });
  }
  for (const p of world.plannedSites ?? []) {
    if (p.owner === colonyId && p.building === 'pylon') {
      const secProps = sectorRadius
        ? { sectorId: globalTileToSector(p.q, p.r, sectorRadius).sectorId, sectorRadius }
        : {};
      out.push({ kind: ENTITY_KIND.pylon, q: p.q, r: p.r, radius: pylonR, ...secProps });
    }
  }
  return out;
}

/**
 * The tiles `(q, r)` of the union of `sources` (each once), for the zone highlight. Pure axial coordinates; the caller
 * drops tiles outside its map.
 */
export function powerZoneTiles(sources: readonly PowerZoneSource[]): Array<{ q: number; r: number }> {
  const seen = new Set<string>();
  const out: Array<{ q: number; r: number }> = [];
  for (const s of sources) {
    for (let dq = -s.radius; dq <= s.radius; dq++) {
      for (let dr = Math.max(-s.radius, -dq - s.radius); dr <= Math.min(s.radius, -dq + s.radius); dr++) {
        const q = s.q + dq, r = s.r + dr, key = `${q},${r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ q, r });
      }
    }
  }
  return out;
}
