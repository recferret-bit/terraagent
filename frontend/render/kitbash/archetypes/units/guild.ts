import * as THREE from 'three';
import type { KitbashBuilder, MaterialZoneId, MaterialZoneSpec } from '../../KitbashRegistry';
import { cyl, mirror } from '../../greebles/unitParts';
import { register } from './common';
import { buildCarrierHull } from './ships';

/** Faction Plate `--ta-blue-hi`. Satin accent, not a light. */
const GUILD_BLUE: MaterialZoneSpec = { color: 0x5b8cff, roughness: 0.46, metalness: 0.12, emissiveIntensity: 0 };

/** A few hull-primary plates that take the Guild stripe. The main hull, nose and wing vanes stay primary. */
const ACCENT_PLATES = new Set(['dorsal cargo tank', 'racked drop pod']);

const guildZone = (name: string, stock: MaterialZoneId): MaterialZoneId =>
  stock === 'hullPrimary' && ACCENT_PLATES.has(name) ? 'hullSecondary' : stock;

// Side canisters on the main hull. Overlap is authored in carrier metres, then scaled by 0.35.
function addCargoPods(b: KitbashBuilder): void {
  mirror((s) => {
    for (const z of [1.0, 6.8]) {
      const x = 5.0 * s;
      b.addPart(cyl(0.72, 0.72, 2.0, 5), 'hullPrimary', {
        name: 'guild cargo pod', position: [x, 0.35, z], rotation: [Math.PI / 2, 0, 0],
      });
      // Outer clamp: 12 cm into the canister at its +X vertex (about 4 cm after scale).
      b.addPart(new THREE.BoxGeometry(0.2, 0.62, 0.48), 'hullSecondary', {
        name: 'guild cargo strap', position: [5.7 * s, 0.35, z + 0.42],
      });
    }
  });
}

register({
  id: 'ship.guildTrader',
  label: 'Guild Trader',
  category: 'ship',
  footprint: [3, 7],
  scale: 0.35,
  snap: true,
  zones: { hullSecondary: GUILD_BLUE },
  notes: 'Guild trader: carrier hull at 0.35, blue livery on the accent plates, four side cargo pods. Skids sit at y = 0.',
  build: (b) => {
    buildCarrierHull(b, { zoneFor: guildZone, roundSeg: 6 });
    addCargoPods(b);
  },
});
