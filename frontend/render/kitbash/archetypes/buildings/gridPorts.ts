import type { KitbashBuilder } from '../../KitbashRegistry';
import { cyl, lamp, type V3 } from './kit';

/** Shared model-space terminals: both geometry and the grid renderer use these anchors. */
export const GRID_PORTS: Readonly<Record<string, V3>> = {
  'building.commandHub': [1.35, 6.4, -1.75],
  'building.solar': [0.15, 3.6, -1.7],
  'building.wind': [0, 6.6, 0],
  'building.capacitor': [0, 3.65, 0.45],
  'building.mine': [0, 6.5, 0],
  'building.supplyDepot': [0.4, 3.8, -0.8],
  'building.coalGen': [-0.9, 6.1, 0.5],
  'building.waterPump': [0, 4.2, -0.2],
};

export function gridPort(b: KitbashBuilder, id: string, baseY: number): void {
  const [x, y, z] = GRID_PORTS[id];
  cyl(b, 'frameGunmetal', 0.065, 0.09, y - baseY, [x, baseY, z], { seg: 6, name: 'grid antenna mast' });
  cyl(b, 'hullSecondary', 0.12, 0.12, 0.18, [x, y - 0.22, z], { seg: 6, name: 'grid terminal collar' });
  lamp(b, 'energyCyan', 0.09, [x, y, z], { seg: 6, hSeg: 3, name: 'grid terminal light' });
}
