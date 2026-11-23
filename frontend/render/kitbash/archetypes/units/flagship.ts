import type { KitbashBuilder, MaterialZoneId, MaterialZoneSpec } from '../../KitbashRegistry';
import { cyl, mirror } from '../../greebles/unitParts';
import { register } from './common';
import { buildCarrierHull } from './ships';

/** Gold-anodized livery, the same metal as the Tier 3+ Command Hub trim (`HUB_GOLD_TRIM`). */
const FLAGSHIP_GOLD: MaterialZoneSpec = { color: 0xe0b030, roughness: 0.3, metalness: 0.9, emissiveIntensity: 0 };

/** Plates that take the gold stripe on top of the accent zone (`hullSecondary`, which is gold on this hull). */
const GOLD_PLATES = new Set(['dorsal cargo tank', 'racked drop pod']);

const flagshipZone = (name: string, stock: MaterialZoneId): MaterialZoneId =>
  stock === 'hullPrimary' && GOLD_PLATES.has(name) ? 'hullSecondary' : stock;

/** Command crest on the bridge roof and a cyan stripe along each flank (carrier metres, before the 0.35 scale). */
function addFlagshipMarks(b: KitbashBuilder): void {
  // Crest: a four-sided blade sunk 0.25 m into the bridge roof (top y 5.9), so it is bolted to it.
  b.addPart(cyl(0.18, 0.55, 2.4, 4), 'hullSecondary', {
    name: 'flagship command crest', position: [0, 6.85, 10.4], rotation: [0, Math.PI / 4, 0], scale: [0.55, 1, 1.5],
  });
  mirror((s) => {
    // Flank stripe: a thin cyan bar seated 8 cm into the flat of the hull side (x = 4.5).
    b.addPart(cyl(0.11, 0.11, 12.4, 5), 'energyCyan', {
      name: 'flagship flank stripe light', position: [4.52 * s, -0.9, 5], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4,
    });
  });
}

register({
  id: 'ship.flagshipCarrier',
  label: 'Flagship Orbital Carrier',
  category: 'ship',
  footprint: [8, 20],
  snap: true,
  scale: 0.35,
  zones: { hullSecondary: FLAGSHIP_GOLD },
  notes: 'W28-12 Lead Patron flagship (named ISS plus the pilot handle in the orbit menu): the carrier hull in gold-anodized livery with a command crest and cyan flank stripes. Parked in the orbit-menu skybox.',
  build: (b) => {
    buildCarrierHull(b, { zoneFor: flagshipZone, roundSeg: 6, dishSeg: 8 });
    addFlagshipMarks(b);
  },
});
