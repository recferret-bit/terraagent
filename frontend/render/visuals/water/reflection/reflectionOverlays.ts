import type * as THREE from 'three';

/**
 * What the water mirror leaves out without anyone tagging it: game overlays and light effects are not part of the
 * world, and mirrored they float under the surface (a projector pool or beam, a health bar, a selection ring, a
 * placement ghost, a terraform highlight, the territory border, particles).
 *
 * The rule is the one property they all share and world surfaces never have: a material that is `transparent` AND
 * writes no depth (`depthWrite === false`). Opaque surfaces, alpha-tested foliage and the sky dome (opaque, no depth
 * write) stay in. The rule works per MATERIAL (`material.visible`, which three checks per draw and which does not
 * cascade to children), so a mixed multi-material mesh keeps its world parts and an overlay's world children stay.
 * Explicit opt-outs that the rule cannot see (e.g. an opaque debug line) use `excludeFromReflection`.
 */
export function isMirrorOverlay(m: THREE.Material): boolean {
  if (m.userData?.waterReflect === true) return false;
  return m.transparent && !m.depthWrite;
}

const stack: THREE.Object3D[] = [];

function hideIfOverlay(m: THREE.Material | undefined, out: THREE.Material[]): void {
  if (m && m.visible && isMirrorOverlay(m)) {
    m.visible = false;
    out.push(m);
  }
}

/**
 * Hides (`visible = false`) every overlay material used under `root` by a shown object and appends it to `out` (each
 * once: a shared material is hidden on its first use). Hidden subtrees are skipped: three would not draw them either,
 * so hide the water and the explicit exclusions first. Allocation-free; restore with `showMaterials(out)`.
 */
export function hideOverlayMaterials(root: THREE.Object3D, out: THREE.Material[]): THREE.Material[] {
  stack.length = 0;
  stack.push(root);
  while (stack.length > 0) {
    const o = stack.pop()!;
    if (!o.visible) continue;
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (let i = 0; i < mat.length; i++) hideIfOverlay(mat[i], out);
    else hideIfOverlay(mat, out);
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) stack.push(ch[i]!);
  }
  return out;
}

/** Shows the materials `hideOverlayMaterials` hid again and empties the list. */
export function showMaterials(hidden: THREE.Material[]): void {
  for (let i = 0; i < hidden.length; i++) hidden[i]!.visible = true;
  hidden.length = 0;
}
