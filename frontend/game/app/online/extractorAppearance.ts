import type * as THREE from 'three';
import { DEPOSIT, ENTITY_KIND, hexIndex } from '@terra/sim';
import type { ClientView, EntityRow } from '../../store/replica/viewCodec';

export function syncExtractorAppearance(mesh: THREE.Object3D | undefined, entity: EntityRow, view: ClientView): void {
  if (!mesh || entity.kind !== ENTITY_KIND.metalsExtractor || !view.tiles) return;
  const index = hexIndex(view.planet?.radius ?? 16);
  let metals = false, minerals = false;
  for (let dr = 0; dr < 2; dr++) {
    for (let dq = 0; dq < 2; dq++) {
      const i = index.indexOf(entity.q + dq, entity.r + dr);
      const dep = view.tiles.deposit?.[i];
      metals ||= dep === DEPOSIT.metals;
      minerals ||= dep === DEPOSIT.minerals;
    }
  }
  const material = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
  material.color?.setHex(!metals && minerals ? 0xb8a0ff : 0xffffff);
}
