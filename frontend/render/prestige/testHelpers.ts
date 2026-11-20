import { buildingCableAnchor } from '../lighting/gridCables/cableAnchors';

/** Spec helper: where a cable ends on `archetypeId` (a hub variant must resolve to the hub's port). */
export function cableAnchorFor(archetypeId: string) {
  return buildingCableAnchor(archetypeId, null, 1, 0, 0.14);
}
