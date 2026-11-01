import * as THREE from 'three';
import type { KitbashBuilder, MaterialZoneId, PartOptions } from '../KitbashRegistry';

/**
 * The kits' one "tube through points" helper (a power cable unless `opts.name` says otherwise): a `TubeGeometry` along a
 * CatmullRom curve through `pts`, `seg.along` segments along it and `seg.radial` around it. The building kit
 * (`kit.tube` / `kit.cable`) uses 4 around, the unit parts (`cable` / `sag`) 5, the `saggingCable` greeble 12 × 6.
 */
export function tubeThrough(
  b: KitbashBuilder, pts: readonly THREE.Vector3[], r: number, zone: MaterialZoneId,
  seg: { along: number; radial: number }, opts: PartOptions = {},
): void {
  const curve = new THREE.CatmullRomCurve3([...pts]);
  b.addPart(new THREE.TubeGeometry(curve, seg.along, r, seg.radial, false), zone, { name: 'power cable', ...opts });
}
