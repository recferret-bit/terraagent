import type { FeatureContext, RendererInstance } from '../../core/registry/types';
import { GhostRig3D } from './GhostRig3D';

/** While the pointer rests, the tile under it is re-picked at most this often (the camera may pan under it). */
export const GHOST_IDLE_PICK_MS = 150;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The 3D placement ghost and its hover: the tile under the pointer is picked when the pointer moves over the canvas
 * (and every `GHOST_IDLE_PICK_MS` while it rests), never on every frame; the ghost re-evaluates only when that tile
 * changes. This is the only hover path of the placement ghost (FF-15, XC-17).
 */
export function createHubGhostRenderer(ctx: FeatureContext): RendererInstance {
  const s3 = ctx.services.scene3d;
  if (!s3) return { update() {}, dispose() {} };
  const rig = new GhostRig3D(s3);
  const canvas = (ctx.services.surface ?? ctx.services.canvas) as HTMLElement | null | undefined;
  let pointer: { x: number; y: number } | null = null;
  let moved = false;
  let lastPickAt = -Infinity;
  let lastTile = '';
  const onMove = (e: PointerEvent) => {
    pointer = !canvas || e.target === canvas ? { x: e.clientX, y: e.clientY } : null;
    moved = true;
  };
  window.addEventListener('pointermove', onMove);
  const idle = { isPlacementActive: () => false, getGhostState: () => null as never };

  const hoverUnderPointer = (hp: NonNullable<FeatureContext['services']['hubPlacement']>) => {
    const t = now();
    if (!pointer || !ctx.services.pickTile || (!moved && t - lastPickAt < GHOST_IDLE_PICK_MS)) return;
    moved = false;
    lastPickAt = t;
    const tile = ctx.services.pickTile(pointer.x, pointer.y, canvas);
    const key = tile ? `${tile.q},${tile.r}` : '';
    if (tile && key !== lastTile) {
      lastTile = key;
      hp.hoverTile(tile.q, tile.r);
    }
  };

  return {
    update(_view, dt) {
      const hp = ctx.services.hubPlacement;
      if (!hp) {
        rig.update(idle, dt);
        return;
      }
      if (hp.isPlacementActive()) hoverUnderPointer(hp);
      else lastTile = '';
      rig.update({ isPlacementActive: () => hp.isPlacementActive(), getGhostState: () => hp.peekGhostState() }, dt);
    },
    dispose() {
      window.removeEventListener('pointermove', onMove);
      rig.dispose();
    },
  };
}
