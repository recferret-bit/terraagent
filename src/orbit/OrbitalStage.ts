import * as THREE from 'three';
import type { CreateOrbitalStage, OrbitalStage } from './types';
import type { PlanetKind, PlanetSpec } from '../planets/PlanetSpec';
import { createPlanetGlobe, type PlanetGlobe } from '../planets/PlanetGlobe';
import { createSpaceBackdrop } from '../visuals/space/SpaceBackdrop';
import { createSunFlare } from '../visuals/space/SunFlare';
import { createParallaxLayers } from '../visuals/space/ParallaxLayers';
import { createMoon, moonsFor, type Moon } from './Moons';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '../visuals/space/placeholders';

const R = 9.5;            // globe radius (world units)
const CAM_DIST = 62;
const FADE = 1.2;         // crossfade seconds
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Interactive menu backdrop: procedural planet globe (right of frame, UI-safe left), nebula + stars, a sun with
 * lens-flare glow and the ship.carrier hovering in orbit. Own scene + 28° telephoto camera — hand them to
 * `viewport.setView(stage.scene, stage.camera)`.
 */
export const createOrbitalStage: CreateOrbitalStage = (viewport, spec) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01020a);
  scene.environment = viewport.environment;
  scene.environmentIntensity = 0.4;

  const sc = viewport.renderer.domElement;
  const aspect = () => (sc.clientWidth || window.innerWidth) / Math.max(1, sc.clientHeight || window.innerHeight);
  const camera = new THREE.PerspectiveCamera(28, aspect(), 0.5, 4000);
  const camBase = new THREE.Vector3(0, 1.4, CAM_DIST);
  camera.position.copy(camBase);

  const sunDir = new THREE.Vector3(0.62, 0.3, 0.55).normalize();
  const backdrop = createSpaceBackdrop({ seed: 4242, sunDir });
  scene.add(backdrop.group);
  const sunFlare = createSunFlare(0xfff0d8);
  // Sun is FIXED on screen (placed far along a camera-space direction every frame); only the lens glow reacts to the mouse.
  const SUN_NDC = new THREE.Vector2(0.86, 0.84);
  const sunPos = new THREE.Vector3(), sunDirCam = new THREE.Vector3();
  const mouse = new THREE.Vector2(0, 0), mouseS = new THREE.Vector2(0, 0);
  const onMove = (e: PointerEvent) => { mouse.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)); };
  window.addEventListener('pointermove', onMove);
  scene.add(sunFlare.group);

  // ---- parallax depth layers (3 star layers, nebula planes, distant planets, asteroids, foreground motes)
  const layers = createParallaxLayers({ seed: 9091, camDist: CAM_DIST, sunDir, aspect });
  scene.add(layers.group);

  // lights (stage-owned scene → free to own lights)
  const sunLight = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sunLight.position.copy(sunDir).multiplyScalar(60);
  const hemi = new THREE.HemisphereLight(0x6f8fd0, 0x14101c, 0.35);
  const rim = new THREE.DirectionalLight(0x7aa8ff, 0.9);
  rim.position.set(-30, 10, -25);
  scene.add(sunLight, hemi, rim);

  // ---- globes (cached per kind: the shader program is shared, so swapping never recompiles)
  const cache = new Map<PlanetKind, PlanetGlobe>();
  const globeFor = (s: PlanetSpec) => {
    let g = cache.get(s.kind);
    if (!g) { g = createPlanetGlobe(s, { radius: R, segments: 128 }); g.setSunDirection(sunDir); g.group.visible = false; scene.add(g.group); cache.set(s.kind, g); }
    return g;
  };
  let current = globeFor(spec);
  current.group.visible = true; current.setOpacity(1);
  let outgoing: PlanetGlobe | null = null;
  let fade = 1;
  const planetPos = new THREE.Vector3();

  // ---- carrier
  const carrier: FittedModel = acquireModel('ship.carrier', 'dune', { size: 6.0, mode: 'max', minRatio: 0.8, maxRatio: 1.25 });
  carrier.root.rotation.order = 'YXZ';
  scene.add(carrier.root);

  // ---- moons (distinct per planet) + artificial satellites
  interface MoonSet { moons: Moon[]; group: THREE.Group; k: number }
  const moonSets = new Map<string, MoonSet>();
  const moonSetFor = (sp: PlanetSpec): MoonSet => {
    let ms = moonSets.get(sp.kind);
    if (!ms) {
      const group = new THREE.Group(); group.name = `Moons:${sp.kind}`;
      const moons = moonsFor(sp.kind).map((d, i) => { const m = createMoon(d, sunDir, sp.seed + i * 13); group.add(m.group); return m; });
      scene.add(group); ms = { moons, group, k: 0 }; moonSets.set(sp.kind, ms);
    }
    return ms;
  };
  let activeMoons = moonSetFor(spec); activeMoons.k = 1;

  interface Sat { model: FittedModel; orbit: number; period: number; incline: number; node: number; phase: number; plane: THREE.Euler }
  const sats: Sat[] = [];
  const satDefs: [string, number, number, number, number, number, number][] = [
    // id, size, orbit, period(s), incline, node, phase
    ['prop.satComms', 1.8, 11.6, 34, 1.15, 0.2, 0.4],
    ['prop.satSolar', 2.1, 12.4, -48, 0.5, 1.9, 2.6],
    ['prop.stationRing', 2.5, 13.2, 70, -0.85, -0.7, 4.4],
    ['prop.satComms', 1.5, 12.0, -29, -0.3, 2.7, 5.5],
  ];
  for (const [id, size, orbit, period, incline, node, phase] of satDefs) {
    const model = acquireModel(id, 'dune', { size, mode: 'max', force: true });
    model.root.rotation.order = 'YXZ';
    scene.add(model.root);
    sats.push({ model, orbit, period, incline, node, phase, plane: new THREE.Euler(incline, node, 0, 'YXZ') });
  }
  const satTmp = new THREE.Vector3(), satAhead = new THREE.Vector3(), satUp = new THREE.Vector3();

  const nebTint = new THREE.Color();
  const nebTarget = new THREE.Color();
  const tintFromSpec = (s: PlanetSpec) => nebTarget.set(s.orbital.atmosphereColor).lerp(new THREE.Color(0x30408a), 0.55);
  backdrop.uniforms.uNebA.value.copy(tintFromSpec(spec)); nebTint.copy(backdrop.uniforms.uNebA.value); layers.setNebulaTint(nebTint);

  let layoutX = 0, lx = NaN;
  const place = (dt: number) => {
    const a = aspect();
    const halfW = Math.tan(THREE.MathUtils.degToRad(14)) * CAM_DIST * a;
    const target = a > 1.15 ? Math.min(halfW * 0.38, halfW - R - 1.5) : 0; // planet right of centre, leaving the left for UI
    layoutX = Number.isNaN(lx) ? target : layoutX + (target - layoutX) * Math.min(1, dt * 4);
    lx = layoutX;
    planetPos.set(layoutX, 0, 0);
  };

  const api: OrbitalStage = {
    scene, camera,
    setPlanet(next) {
      if (next.kind === current.spec.kind) return;
      if (outgoing) outgoing.group.visible = false;
      outgoing = current;
      current = globeFor(next);
      current.group.visible = true;
      current.spin.rotation.y = outgoing.spin.rotation.y + 0.9; // arrives mid-rotation → reads as a smooth turn
      current.setOpacity(0);
      fade = 0;
      tintFromSpec(next);
      activeMoons = moonSetFor(next);
    },
    update(dt, time) {
      place(dt);
      if (fade < 1) {
        fade = Math.min(1, fade + dt / FADE);
        const e = ease(fade);
        current.setOpacity(Math.min(1, e * 1.15));
        current.group.scale.setScalar(0.95 + 0.05 * e);
        if (outgoing) {
          outgoing.setOpacity(1 - e);
          outgoing.group.scale.setScalar(1 + 0.05 * e);
          outgoing.spin.rotation.y -= dt * 0.35 * (1 - e);
          if (fade >= 1) { outgoing.group.visible = false; outgoing.group.scale.setScalar(1); outgoing = null; current.group.scale.setScalar(1); }
        }
        current.spin.rotation.y -= dt * 0.35 * (1 - e) * 0.9;
      }
      for (const g of [current, outgoing]) if (g) { g.group.position.copy(planetPos); g.update(dt, time); }
      nebTint.lerp(nebTarget, 1 - Math.exp(-dt * 1.5)); layers.setNebulaTint(nebTint);
      backdrop.uniforms.uNebA.value.copy(nebTint);

      // camera: slow cinematic sway + mouse-driven parallax (planet/carrier/moons/layers separate by depth)
      mouseS.lerp(mouse, 1 - Math.exp(-dt * 2.5));
      camera.position.set(
        camBase.x + Math.sin(time * 0.05) * 0.9 + mouseS.x * 3.6,
        camBase.y + Math.sin(time * 0.037 + 1.0) * 0.35 + mouseS.y * 2.0,
        camBase.z,
      );
      camera.lookAt(planetPos.x * 0.35, 0.3, 0);
      camera.updateMatrixWorld();
      backdrop.update(camera, time);
      layers.update(dt, time);

      // fixed-on-screen sun: far along a constant camera-space direction
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      sunDirCam.set(SUN_NDC.x * tanH * camera.aspect, SUN_NDC.y * tanH, -1).normalize().applyQuaternion(camera.quaternion);
      sunPos.copy(camera.position).addScaledVector(sunDirCam, 700);
      sunFlare.setPosition(sunPos);
      sunFlare.setOccluder(planetPos, R * 1.0);
      // lens glow only reacts to the mouse (ghost axis pivots on the cursor, flare excites as it nears the sun)
      sunFlare.setPointer(mouseS.x, mouseS.y);
      const dd = Math.hypot((mouseS.x - SUN_NDC.x) * camera.aspect, mouseS.y - SUN_NDC.y);
      sunFlare.setExcite(1 - THREE.MathUtils.smoothstep(dd, 0.15, 1.6));
      sunFlare.update(camera, time);

      // moons: active set grows in, others shrink away; all orbit the planet
      for (const ms of moonSets.values()) {
        const target = ms === activeMoons ? 1 : 0;
        ms.k += (target - ms.k) * Math.min(1, dt * 2.2);
        ms.group.visible = ms.k > 0.01;
        if (!ms.group.visible) continue;
        ms.group.scale.setScalar(1); // scale is applied per moon below so orbits keep their radius
        for (const m of ms.moons) { m.update(planetPos, time); m.group.scale.setScalar(Math.max(ms.k, 0.001)); }
      }
      // satellites: low fast orbits, nose along the velocity vector, solar wings broadside
      for (const st of sats) {
        const a = st.phase + (time / st.period) * Math.PI * 2;
        const dir = Math.sign(st.period);
        satTmp.set(Math.cos(a) * st.orbit, 0, Math.sin(a) * st.orbit).applyEuler(st.plane);
        satAhead.set(Math.cos(a + 0.05 * dir) * st.orbit, 0, Math.sin(a + 0.05 * dir) * st.orbit).applyEuler(st.plane);
        satUp.copy(satTmp).normalize();
        st.model.root.position.copy(planetPos).add(satTmp);
        st.model.root.up.copy(satUp);
        st.model.root.lookAt(satAhead.add(planetPos));
        tickArchetypeMesh(st.model.mesh, time);
      }

      // carrier hover drift (lower-left of the planet, between camera and globe)
      const cx = planetPos.x - 13.5 + Math.sin(time * 0.11) * 1.4;
      const cy = -5.2 + Math.sin(time * 0.17 + 0.6) * 0.45;
      const cz = 12 + Math.sin(time * 0.083) * 2.0;
      carrier.root.position.set(cx, cy, cz);
      carrier.root.rotation.set(0.08 + Math.sin(time * 0.21) * 0.03, 0.9 + Math.sin(time * 0.07) * 0.22, -0.1 + Math.sin(time * 0.13) * 0.04);
      tickArchetypeMesh(carrier.mesh, time);
    },
    dispose() {
      cache.forEach((g) => g.dispose()); cache.clear();
      window.removeEventListener('pointermove', onMove);
      layers.dispose(); moonSets.forEach((ms) => ms.moons.forEach((m) => m.dispose())); moonSets.clear(); sats.forEach((x) => x.model.dispose());
      backdrop.dispose(); sunFlare.dispose(); carrier.dispose();
      scene.remove(sunLight, hemi, rim);
      scene.environment = null;
    },
  };
  return api;
};
