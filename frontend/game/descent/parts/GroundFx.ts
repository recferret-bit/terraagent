import * as THREE from 'three';
import { smoothstep } from '../math';
import { createGroundFX, type GroundFX } from '../fx/GroundFX';
import { D2R } from '../constants';
import type { DescentContext, FramePart, FrameState } from './FrameState';

/** Dust/exhaust on the ground under the pod, plus the single pooled light that tints the scene during plasma and retro burn. */
export class GroundFx implements FramePart {
  private gfx: GroundFX;
  private light = new THREE.PointLight(0xff7a2a, 0, 70, 2);
  private tmp = new THREE.Vector3(); private col = new THREE.Color();

  constructor(private ctx: DescentContext) {
    this.gfx = createGroundFX(ctx.spec.kind, ctx.spec.seed);
    ctx.root.add(this.gfx.group);
    ctx.root.add(this.light);
  }

  update(f: FrameState) {
    const { viewport, camera, surface } = this.ctx, tn = f.tn, thr = f.thr;
    const gx = f.podBase.x, gz = f.podBase.z;
    this.tmp.set(gx, surface.heightAt(gx, gz), gz);
    const pxScale = viewport.renderer.domElement.height / (2 * Math.tan(camera.fov * D2R * 0.5));
    this.gfx.update(tn, this.tmp, thr * smoothstep(30, 3, f.yRel) + 0.0, pxScale);
    const lightI = 24 * f.plasmaI + 22 * thr;
    this.light.intensity = lightI; this.light.visible = lightI > 0.1;
    this.light.color.setRGB(1, 0.5, 0.18).lerp(this.col.setRGB(1, 0.75, 0.5), thr);
    this.light.position.set(f.podBase.x, f.podBase.y - 1.0, f.podBase.z);
  }

  dispose() { this.gfx.dispose(); this.light.dispose?.(); }
}
