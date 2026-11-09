import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { perfTelemetry } from '../../../core/perfConfig';
import { EntityProjectorRig } from '../../../lighting/EntityProjectorRig';
import { excludeFromReflection, registerReflectiveWater } from './reflectionRegistry';
import { getReflectionUniforms } from './reflectionUniforms';
import { createWaterReflectionPass, type ReflectionRenderer } from './WaterReflectionPass';

interface RenderCall { camera: THREE.Camera; target: THREE.WebGLRenderTarget | null; waterVisible: boolean; shadowAuto: boolean; shadowNeeds: boolean; autoClear: boolean }

/** A renderer stand-in recording what each `render` saw. */
function fakeRenderer(width = 800, height = 450) {
  let current: THREE.WebGLRenderTarget | null = null;
  const calls: RenderCall[] = [];
  const watch: { water?: THREE.Object3D } = {};
  const r = {
    autoClear: false,
    shadowMap: { autoUpdate: true, needsUpdate: true },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(width, height),
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { current = t; },
    /** Renderer-level viewport / scissor writes (the pass must leave them alone: the rect lives on the target). */
    stateWrites: [] as string[],
    setViewport: () => { r.stateWrites.push('setViewport'); },
    setScissor: () => { r.stateWrites.push('setScissor'); },
    setScissorTest: () => { r.stateWrites.push('setScissorTest'); },
    render: (_scene: THREE.Object3D, camera: THREE.Camera) => {
      calls.push({
        camera, target: current, waterVisible: watch.water?.visible ?? false, shadowAuto: r.shadowMap.autoUpdate,
        shadowNeeds: r.shadowMap.needsUpdate, autoClear: r.autoClear,
      });
    },
  };
  return { renderer: r as unknown as ReflectionRenderer, raw: r, calls, watch, current: () => current };
}

function camera(y = 46): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
  cam.position.set(42, y, 42);
  cam.lookAt(0, 0, 0);
  return cam;
}

/** A 40 m water plane at the origin (y = 0), as `Liquids.createWater` makes it. */
function waterPlane(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(40, 40);
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function setup(opts: { strength?: number; inScene?: boolean; scale?: number } = {}) {
  const scene = new THREE.Scene();
  const water = waterPlane();
  if (opts.inScene !== false) scene.add(water);
  cleanups.push(registerReflectiveWater({ object: water }));
  const pass = createWaterReflectionPass({ strength: () => opts.strength ?? 0.8, resScale: () => opts.scale ?? 0.5 });
  cleanups.push(() => pass.dispose());
  const fake = fakeRenderer();
  fake.watch.water = water;
  return { scene, water, pass, fake };
}

const u = getReflectionUniforms();

describe('water reflection pass: skips', () => {
  it('does nothing with the strength at 0 (uReflOn 0, no render, no target)', () => {
    const { scene, pass, fake } = setup({ strength: 0 });
    u.uReflOn.value = 1;
    expect(pass.render(fake.renderer, scene, camera())).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(u.uReflOn.value).toBe(0);
    expect(pass.target).toBeNull();
    expect(perfTelemetry.reflectOn).toBe(false);
  });

  it('does nothing without a registered water in the rendered scene', () => {
    const { scene, pass, fake } = setup({ inScene: false });
    u.uReflOn.value = 1;
    expect(pass.render(fake.renderer, scene, camera())).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(u.uReflOn.value).toBe(0);
  });

  it('does nothing while the water or an ancestor is hidden', () => {
    const { scene, water, pass, fake } = setup();
    const parent = new THREE.Group();
    scene.add(parent);
    parent.add(water);
    parent.visible = false;
    expect(pass.render(fake.renderer, scene, camera())).toBe(false);
    parent.visible = true;
    water.visible = false;
    expect(pass.render(fake.renderer, scene, camera())).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it('does nothing when the water is outside the camera frustum, or the camera is under the water', () => {
    const { scene, pass, fake } = setup();
    const away = camera();
    away.lookAt(200, 46, 200); // looking away from the lake
    expect(pass.render(fake.renderer, scene, away)).toBe(false);
    const under = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
    under.position.set(0, -3, 10);
    under.lookAt(0, -3, 0);
    expect(pass.render(fake.renderer, scene, under)).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it('does nothing when the registered parts are all hidden (hex buckets culled to the focus)', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const bucket = waterPlane();
    group.add(bucket);
    scene.add(group);
    cleanups.push(registerReflectiveWater({ object: group, parts: () => [bucket] }));
    const pass = createWaterReflectionPass({ strength: () => 1 });
    cleanups.push(() => pass.dispose());
    const fake = fakeRenderer();
    bucket.visible = false;
    expect(pass.render(fake.renderer, scene, camera())).toBe(false);
    bucket.visible = true;
    expect(pass.render(fake.renderer, scene, camera())).toBe(true);
  });
});

describe('water reflection pass: render', () => {
  it('renders once into a scissored HalfFloat target with the water hidden and frame-old shadows, then restores', () => {
    const { scene, water, pass, fake } = setup({ strength: 0.7, scale: 0.5 });
    const ring = new THREE.Group();
    scene.add(ring);
    cleanups.push(excludeFromReflection(ring));
    let ringSeen = true;
    const render = fake.raw.render;
    fake.raw.render = (s, c) => { ringSeen = ring.visible; render(s, c); };
    expect(pass.render(fake.renderer, scene, camera())).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    const rt = pass.target!;
    expect(call.target).toBe(rt);
    expect(call).toMatchObject({ waterVisible: false, shadowAuto: false, shadowNeeds: false, autoClear: true });
    expect(ringSeen).toBe(false);
    // restored
    expect(water.visible).toBe(true);
    expect(ring.visible).toBe(true);
    expect(fake.raw.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    expect(fake.raw.autoClear).toBe(false);
    expect(fake.current()).toBeNull();
    // target: drawing buffer × scale, linear HDR, scissored to the uniform's rect
    expect([rt.width, rt.height]).toEqual([400, 225]);
    expect(rt.texture.type).toBe(THREE.HalfFloatType);
    expect(rt.scissorTest).toBe(true);
    expect(rt.viewport.equals(rt.scissor)).toBe(true);
    expect(u.uReflTex.value).toBe(rt.texture);
    expect(u.uReflOn.value).toBe(0.7);
    const rect = u.uReflRect.value;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.z).toBeLessThanOrEqual(1);
    expect(rect.x).toBeLessThan(rect.z);
    expect(rect.y).toBeLessThan(rect.w);
    expect(perfTelemetry).toMatchObject({ reflectOn: true, reflectW: 400, reflectH: 225 });
  });

  it('the rect covers the water: the lake centre projects inside uReflRect', () => {
    const { scene, pass, fake } = setup();
    const cam = camera();
    pass.render(fake.renderer, scene, cam);
    const c = new THREE.Vector4(0, 0, 0, 1).applyMatrix4(u.uReflMatrix.value);
    const uv = [c.x / c.w, c.y / c.w];
    const r = u.uReflRect.value;
    expect(uv[0]).toBeGreaterThan(r.x);
    expect(uv[0]).toBeLessThan(r.z);
    expect(uv[1]).toBeGreaterThan(r.y);
    expect(uv[1]).toBeLessThan(r.w);
    const mirror = fake.calls[0]!.camera;
    expect(mirror).not.toBe(cam);
    expect(mirror.position.y).toBeCloseTo(-46, 4);
  });

  it('a small lake far from the view centre gets a rect smaller than the target', () => {
    const scene = new THREE.Scene();
    const pond = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    pond.position.set(6, 0, -6);
    scene.add(pond);
    cleanups.push(registerReflectiveWater({ object: pond }));
    const pass = createWaterReflectionPass({ strength: () => 1, resScale: () => 1 });
    cleanups.push(() => pass.dispose());
    expect(pass.render(fakeRenderer().renderer, scene, camera())).toBe(true);
    expect(perfTelemetry.reflectRect).toBeGreaterThan(0);
    expect(perfTelemetry.reflectRect).toBeLessThan(0.25);
  });

  it('reads the plane level through the water object world matrix (moved parent)', () => {
    const { scene, water, pass, fake } = setup();
    const parent = new THREE.Group();
    parent.position.y = -2;
    scene.add(parent);
    parent.add(water);
    pass.render(fake.renderer, scene, camera());
    expect(fake.calls[0]!.camera.position.y).toBeCloseTo(2 * -2 - 46, 4);
  });

  it('resizes the target with the drawing buffer and frees it when the strength drops to 0', () => {
    let strength = 1;
    const scene = new THREE.Scene();
    const water = waterPlane();
    scene.add(water);
    cleanups.push(registerReflectiveWater({ object: water }));
    const pass = createWaterReflectionPass({ strength: () => strength, resScale: () => 0.25 });
    cleanups.push(() => pass.dispose());
    pass.render(fakeRenderer(800, 400).renderer, scene, camera());
    const rt = pass.target!;
    pass.render(fakeRenderer(1600, 800).renderer, scene, camera());
    expect(pass.target).toBe(rt);
    expect([rt.width, rt.height]).toEqual([400, 200]);
    strength = 0;
    pass.render(fakeRenderer().renderer, scene, camera());
    expect(pass.target).toBeNull();
    expect(u.uReflTex.value).toBeNull();
  });
});

describe('water reflection pass: overlays and state restore', () => {
  /** A lamp rig (beam, pool, lens, halo), a health-bar-like quad and a world mesh in `scene`. */
  function overlays(scene: THREE.Scene) {
    const rig = new EntityProjectorRig('robot.hero');
    rig.setPower(1);
    const bar = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
    const world = new THREE.MeshStandardMaterial();
    scene.add(rig.group, new THREE.Mesh(new THREE.PlaneGeometry(), bar), new THREE.Mesh(new THREE.BoxGeometry(), world));
    cleanups.push(() => rig.dispose());
    const fx = [rig.beamMat, rig.poolMat, rig.lensMat, rig.haloMat, bar];
    return { fx, world };
  }

  it('hides the overlay materials (projector beams and pools, bars) during the mirror render only', () => {
    const { scene, pass, fake } = setup();
    const { fx, world } = overlays(scene);
    let seen: boolean[] = [];
    let worldSeen = false;
    const render = fake.raw.render;
    fake.raw.render = (s, c) => { seen = fx.map((m) => m.visible); worldSeen = world.visible; render(s, c); };
    expect(pass.render(fake.renderer, scene, camera())).toBe(true);
    expect(seen).toEqual(fx.map(() => false));
    expect(worldSeen).toBe(true);
    expect(fx.every((m) => m.visible)).toBe(true);
  });

  it('restores target, autoClear, shadow flags, water and overlays when the mirror render throws', () => {
    const { scene, water, pass, fake } = setup();
    const { fx } = overlays(scene);
    fake.raw.render = () => { throw new Error('lost context'); };
    expect(() => pass.render(fake.renderer, scene, camera())).toThrow('lost context');
    expect(fake.current()).toBeNull();
    expect(fake.raw.autoClear).toBe(false);
    expect(fake.raw.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    expect(water.visible).toBe(true);
    expect(fx.every((m) => m.visible)).toBe(true);
  });

  it('keeps the rect on the target and never writes the renderer viewport / scissor; restores a previous target', () => {
    const { scene, pass, fake } = setup();
    const prev = new THREE.WebGLRenderTarget(64, 64);
    fake.raw.setRenderTarget(prev);
    expect(pass.render(fake.renderer, scene, camera())).toBe(true);
    expect(fake.raw.stateWrites).toEqual([]);
    expect(fake.current()).toBe(prev);
    const rt = pass.target!;
    expect(rt.scissorTest).toBe(true);
    expect(rt.viewport.z * rt.viewport.w).toBeGreaterThan(0);
    prev.dispose();
  });
});
