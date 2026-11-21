// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlasmaTrail, TRAIL_LENGTH } from '@terra/render/descent/PlasmaTrail';
import { buildTrailFragment } from '@terra/render/descent/plasmaTrailGlsl';
import { FrameState, type DescentContext } from './parts/FrameState';
import { ReentryFx } from './parts/ReentryFx';

function mock2dCanvas(): void {
  const grad = { addColorStop: () => {} };
  const base: Record<string, unknown> = { createRadialGradient: () => grad, createLinearGradient: () => grad };
  const ctx = new Proxy(base, {
    get: (target, prop: string) => (prop in target ? target[prop] : () => {}),
    set: (target, prop: string, val) => { target[prop] = val; return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as RenderingContext);
}

beforeEach(() => mock2dCanvas());

function makeCtx(prestige?: DescentContext['prestige']): DescentContext {
  return { spec: { seed: 7, orbital: { atmosphereColor: 0x88aaff } }, root: new THREE.Group(), prestige } as unknown as DescentContext;
}
function frame(tn: number): FrameState {
  const f = new FrameState();
  f.tn = tn; f.dtn = 0.016; f.setEnvelopes(0.8); f.podCenter.set(1, 50, 2); f.camPos.set(0, 60, 10);
  return f;
}
const trailOf = (ctx: DescentContext) => ctx.root.children.find((c) => c.name === 'prestige:plasmaTrail') as THREE.Group | undefined;

describe('W28-12 plasma drop-pod trail (unit)', () => {
  it('builds a hidden sheath + core + sparks that dispose cleanly', () => {
    const t = createPlasmaTrail(1.2, 3.4);
    expect(t.group.visible).toBe(false);
    expect(t.group.children.length).toBe(3);
    const top = Math.max(...t.group.children.map((c) => ((c as THREE.Mesh).geometry as THREE.BufferGeometry).boundingBox ?? new THREE.Box3()).map((b) => b.max.y));
    expect(top).toBeLessThanOrEqual(TRAIL_LENGTH);
    const parent = new THREE.Group(); parent.add(t.group);
    t.dispose();
    expect(t.group.parent).toBeNull();
  });

  it('composes the fragment from named chunks (no copy of the plasma shader)', () => {
    const src = buildTrailFragment();
    for (const fn of ['trailRim', 'trailLanes', 'void main']) expect(src).toContain(fn);
    expect(src.match(/void main/g)).toHaveLength(1);
  });
});

describe('W28-12 ReentryFx prestige trail (integration)', () => {
  it('tier 0 / no prestige: no trail object is ever created', () => {
    const ctx = makeCtx();
    const fx = new ReentryFx(ctx, 1.2, 3.4);
    fx.update(frame(18));
    expect(trailOf(ctx)).toBeUndefined();
    fx.dispose();
  });

  it('prestige.plasmaTrail:false: still none', () => {
    const ctx = makeCtx({ plasmaTrail: false });
    const fx = new ReentryFx(ctx, 1.2, 3.4);
    fx.update(frame(18));
    expect(trailOf(ctx)).toBeUndefined();
    fx.dispose();
  });

  it('tier 2+: the trail shows during re-entry, follows the pod, and is hidden before and after', () => {
    const ctx = makeCtx({ plasmaTrail: true });
    const fx = new ReentryFx(ctx, 1.2, 3.4);
    fx.update(frame(5));
    expect(trailOf(ctx)!.visible).toBe(false);
    fx.update(frame(18));
    const g = trailOf(ctx)!;
    expect(g.visible).toBe(true);
    expect(g.position.toArray()).toEqual([1, 50, 2]);
    fx.update(frame(30));
    expect(g.visible).toBe(false);
    fx.dispose();
    expect(g.parent).toBeNull();
  });

  it('accepts a getter, read every frame (own tier known only after the descent was prepared)', () => {
    let tier2 = false;
    const ctx = makeCtx(() => (tier2 ? { plasmaTrail: true } : undefined));
    const fx = new ReentryFx(ctx, 1.2, 3.4);
    fx.update(frame(18));
    expect(trailOf(ctx)).toBeUndefined();
    tier2 = true;
    fx.update(frame(18));
    expect(trailOf(ctx)!.visible).toBe(true);
    fx.dispose();
  });

  it('a prestige that arrives late (setPrestige-style ctx update) builds the trail on the next frame; clearing hides it', () => {
    const ctx = makeCtx();
    const fx = new ReentryFx(ctx, 1.2, 3.4);
    fx.update(frame(18));
    expect(trailOf(ctx)).toBeUndefined();
    ctx.prestige = { plasmaTrail: true };
    fx.update(frame(18));
    expect(trailOf(ctx)!.visible).toBe(true);
    ctx.prestige = undefined;
    fx.update(frame(18));
    expect(trailOf(ctx)!.visible).toBe(false);
    fx.dispose();
  });
});

describe('W28-12 DescentFlagship skybox carrier (integration)', () => {
  it('mounts ISS flagship in orbital skybox (tn < 14.5), hides below exosphere, and allocates nothing without a Lead Patron', async () => {
    const { DescentFlagship } = await import('./parts/DescentFlagship');
    const makeShipCtx = (prestige?: DescentContext['prestige']) =>
      ({ spec: { seed: 7, biomeKey: 'dune', orbital: { atmosphereColor: 0x88aaff } }, root: new THREE.Group(), prestige } as unknown as DescentContext);

    // Negative: no patron -> zero mesh allocated.
    const emptyCtx = makeShipCtx({ plasmaTrail: true });
    const emptyShip = new DescentFlagship(emptyCtx);
    emptyShip.update(frame(6));
    expect(emptyCtx.root.children.find((c) => c.name === 'descent:flagshipCarrier')).toBeUndefined();
    emptyShip.dispose();

    // Positive + boundary: Lead Patron mounts ship at tn=6, hides at tn=14.5, disposes cleanly.
    const patronCtx = makeShipCtx({ flagshipCarrierName: 'ISS whale.near' });
    const ship = new DescentFlagship(patronCtx);
    ship.update(frame(6));
    const mesh = patronCtx.root.children.find((c) => c.name === 'descent:flagshipCarrier')!;
    expect(mesh).toBeDefined();
    expect(mesh.visible).toBe(true);
    expect(ship.activeName).toBe('ISS whale.near');

    ship.update(frame(14.5));
    expect(mesh.visible).toBe(false);
    ship.dispose();
    expect(patronCtx.root.children.find((c) => c.name === 'descent:flagshipCarrier')).toBeUndefined();
  });
});
