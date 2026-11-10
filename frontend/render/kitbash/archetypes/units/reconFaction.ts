// Mercenary paint for the shared robot.recon mesh. Zone colours are baked into vertices, so a
// faction is chosen before the build (playground `?faction=`), not by forking an archetype id.
import type { KitbashBuilder, MaterialZoneId, MaterialZoneSpec } from '../../KitbashRegistry';
import { ArchetypeCatalog } from '../../catalog';
import { cyl, rbox } from '../../greebles/unitParts';

export type ReconFactionId = 'default' | 'mercenary';

export interface ReconFactionPalette {
  id: ReconFactionId;
  /** Overrides on top of the default kitbash zones. Empty keeps the default hull. */
  zones: Partial<Record<MaterialZoneId, MaterialZoneSpec>>;
  /** Roof emblem and emissive marker, mercenary only. */
  marks: boolean;
}

/** Light grey-teal armor. Green leads blue so it is not the default cool grey. */
const MERCENARY_HULL: MaterialZoneSpec = {
  color: 0xa3cfc7, roughness: 0.48, metalness: 0.14, emissiveIntensity: 0,
};

/** Pure: mercenary differs; any other string, or a missing query, is the default palette. */
export function reconFactionPalette(query: string | null | undefined): ReconFactionPalette {
  const key = query?.trim().toLowerCase() ?? '';
  if (key === 'mercenary') return { id: 'mercenary', marks: true, zones: { hullPrimary: { ...MERCENARY_HULL } } };
  return { id: 'default', zones: {}, marks: false };
}

let preview: string | null = null;

/** Playground preview. Null (and any unknown value) builds the default recon. Drops the cached mesh. */
export function setReconFactionPreview(query: string | null): void {
  preview = query;
  ArchetypeCatalog.dropGeometry('robot.recon');
}

export function reconFactionPreview(): string | null {
  return preview;
}

export function activeReconPalette(): ReconFactionPalette {
  return reconFactionPalette(preview);
}

/**
 * Diamond rank plate on the turret roof, plus a cyan stud.
 * The plate is sunk 1.2 cm into the roof (y = 0.99) and stands 1 cm proud; the stud overlaps the plate by 1.2 cm.
 * Both sit forward of the commander hatch so they clear it.
 */
export function stampMercenaryMarks(b: KitbashBuilder): void {
  const roofY = 0.99;
  const thick = 0.022;
  const sink = 0.012;
  const y = roofY - sink + thick / 2;
  b.addPart(rbox(0.072, thick, 0.072, 0.005), 'hullSecondary', {
    name: 'merc emblem', position: [0, y, 0.155], rotation: [0, Math.PI / 4, 0],
  });
  const markH = 0.03;
  const markY = y + thick / 2 + markH / 2 - sink;
  b.addPart(cyl(0.013, 0.013, markH, 8), 'energyCyan', {
    name: 'merc marker light', position: [0, markY, 0.155], emissiveIntensity: 3.6,
  });
}
