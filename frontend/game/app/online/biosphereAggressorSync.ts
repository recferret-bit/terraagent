import type { BiosphereAggressor } from '@terra/render/biosphere';
import type { HexTerrain } from '@terra/render/planets/hex';
import type { EntityMeshRecord } from './EntityMeshRecord';

/**
 * Feeds active colony robot and outpost positions (`owner >= 0`) into the planet biosphere so
 * birds and warm-blooded animals treat robotic conquerors and active work sites as threats.
 */
export function syncBiosphereAggressors(
  terrain: HexTerrain | null,
  records: Iterable<EntityMeshRecord>,
  workingIds: ReadonlySet<number>,
): void {
  if (!terrain) return;
  const aggressors: BiosphereAggressor[] = [];
  for (const rec of records) {
    if (rec.owner < 0 || !rec.mesh.visible) continue;
    aggressors.push({
      x: rec.mesh.position.x,
      z: rec.mesh.position.z,
      radius: 11,
      working: workingIds.has(rec.id) || rec.work > 0.25,
    });
  }
  terrain.biosphere.setAggressors(aggressors);
}
