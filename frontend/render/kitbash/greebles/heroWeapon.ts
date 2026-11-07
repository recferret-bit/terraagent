import type { KitbashBuilder } from '../KitbashRegistry';
import { cyl, rbox } from './unitParts';

/** HQ's independent helmet-mounted defense weapon; it can guard while the hands work. */
export function addHeroDefenseWeapon(b: KitbashBuilder): void {
  b.addPart(cyl(0.12, 0.14, 0.10, 8), 'frameGunmetal', {
    name: 'defense gun bearing', position: [0, 2.04, 0.01], animType: 8,
  });
  b.addPart(rbox(0.24, 0.14, 0.22, 0.03, 1), 'hullSecondary', {
    name: 'defense gun housing', position: [0, 2.13, 0.01], animType: 8,
  });
  b.addPart(cyl(0.035, 0.045, 0.32, 8), 'frameGunmetal', {
    name: 'defense gun barrel', position: [0, 2.13, 0.25], rotation: [Math.PI / 2, 0, 0], animType: 8,
  });
}
