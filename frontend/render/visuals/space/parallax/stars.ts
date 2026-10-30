import * as THREE from 'three';
import { STAR_VERT, STAR_FRAG } from './shaders';
import type { ParallaxCtx, ParallaxPart } from './types';

interface PointData { pos: Float32Array; sz: Float32Array; sd: Float32Array; col: Float32Array }

const pointData = (count: number): PointData => ({
  pos: new Float32Array(count * 3), sz: new Float32Array(count), sd: new Float32Array(count), col: new Float32Array(count * 3),
});

/** Additive twinkling point sprites (shared by star layers and foreground motes). */
function pointsLayer(ctx: ParallaxCtx, d: PointData, bright: number, order: number): ParallaxPart {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(d.sz, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(d.sd, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(d.col, 3));
  const m = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: Math.min(window.devicePixelRatio, 2) }, uBright: { value: bright } },
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = order; ctx.group.add(p);
  return { update(_dt, time) { m.uniforms.uTime.value = time; }, dispose() { g.dispose(); m.dispose(); } };
}

function starLayer(ctx: ParallaxCtx, depth: number, count: number, size: number, bright: number, tint: THREE.Color, order: number) {
  const { rnd } = ctx;
  const { w, h } = ctx.slab(depth);
  const d = pointData(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    d.pos[i * 3] = (rnd() * 2 - 1) * w; d.pos[i * 3 + 1] = (rnd() * 2 - 1) * h; d.pos[i * 3 + 2] = -depth + (rnd() - 0.5) * depth * 0.08;
    d.sz[i] = size * (0.5 + Math.pow(rnd(), 3) * 2.2); d.sd[i] = rnd();
    c.setHSL(rnd() < 0.2 ? 0.07 : rnd() < 0.4 ? 0.6 : 0.58, 0.35 * rnd(), 0.78 + rnd() * 0.2).lerp(tint, 0.25);
    d.col.set([c.r, c.g, c.b], i * 3);
  }
  return pointsLayer(ctx, d, bright, order);
}

/** far (z≈-640) → mid (-330) → near (-150) star layers. */
export function createStarLayers(ctx: ParallaxCtx): ParallaxPart[] {
  return [
    starLayer(ctx, 640, 2600, 2.2, 0.9, new THREE.Color(0xffffff), -80),
    starLayer(ctx, 330, 900, 3.4, 1.4, new THREE.Color(0xbfd4ff), -79),
    starLayer(ctx, 150, 160, 6.5, 2.6, new THREE.Color(0xffe2bf), -78),
  ];
}

/** Foreground motes: huge soft out-of-focus specks very near the camera (strongest parallax). */
export function createMotes(ctx: ParallaxCtx): ParallaxPart {
  const { rnd } = ctx;
  const count = 34;
  const d = pointData(count);
  for (let i = 0; i < count; i++) {
    const z = 26 + rnd() * 22; const { w, h } = ctx.slab(-z);
    d.pos.set([(rnd() * 2 - 1) * w * 0.7, (rnd() * 2 - 1) * h * 0.9, z], i * 3); d.sz[i] = 10 + rnd() * 26; d.sd[i] = rnd(); d.col.set([0.6, 0.7, 0.9], i * 3);
  }
  return pointsLayer(ctx, d, 0.05, 20);
}
