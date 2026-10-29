import * as THREE from 'three';
import type { CreateOrbitalStage, OrbitalStage } from './types';
import type { PlanetKind, PlanetSpec } from '../planets/PlanetSpec';
import { createPlanetGlobe, type PlanetGlobe } from '../planets/PlanetGlobe';
import { createSpaceBackdrop } from '../visuals/space/SpaceBackdrop';
import { createSunFlare } from '../visuals/space/SunFlare';
import { createParallaxLayers } from '../visuals/space/ParallaxLayers';
import { createMoon, moonsFor, type Moon } from './Moons';
import { createDropRig, type DropRig } from '../descent/dropRig';
import type { DescentHandoff } from '../descent/types';
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
  let spinRate = 0.025;              // rad/s, see setSpinRate
  const cache = new Map<PlanetKind, PlanetGlobe>();
  const globeFor = (s: PlanetSpec) => {
    let g = cache.get(s.kind);
    if (!g) { g = createPlanetGlobe(s, { radius: R, segments: 128 }); g.setSunDirection(sunDir); g.setSpinRate(spinRate); g.group.visible = false; scene.add(g.group); cache.set(s.kind, g); }
    return g;
  };
  let current = globeFor(spec);
  current.group.visible = true; current.setOpacity(1);
  let outgoing: PlanetGlobe | null = null;
  let fade = 1;
  let fadeDur = FADE;                 // seconds for the current morph (setPlanet opts.duration)
  let continuousSpin = false;        // true: no counter-rotation during a morph, both globes just keep turning forward
  let morphRate = 1;                 // 1 = the menu's default speed; slower morphs scale nebula/moon easing down by this
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

  // ---- deploy: carrier fly-by → bay release → scale-dive into the real planet (ends on the descent's frame)
  const TA = 2.6, TB = 3.6, TC = 9.6;   // dolly | release | dive
  interface Deploy {
    T: number; h: DescentHandoff; rig: DropRig;
    PC: THREE.Vector3; Rs: number; s: number; Q: THREE.Quaternion; ne: THREE.Vector3;
    podEnd: THREE.Vector3; camEnd: THREE.Vector3; tgtEnd: THREE.Vector3; qEnd: THREE.Quaternion;
    p0: THREE.Vector3; t0: THREE.Vector3; up0: THREE.Vector3; holdCam: THREE.Vector3; holdTgt: THREE.Vector3;
    dropDir: THREE.Vector3; released: boolean; tgtHold1: THREE.Vector3;
    P0: THREE.Vector3; q0: THREE.Quaternion; sc0: number; O0: THREE.Vector3; G0: THREE.Vector3; upR: THREE.Vector3; camR: THREE.Vector3; tgtR: THREE.Vector3;
    sunI0: number; sunC0: THREE.Color; hemi0: [THREE.Color, THREE.Color, number]; rim0: number; env0: number; exp0: number; bloom0: number;
    cloudS0: number; shell0: number; near0: number;
  }
  let deploy: Deploy | null = null;
  const lookNow = new THREE.Vector3(0, 0.3, 0);
  const Y_UP = new THREE.Vector3(0, 1, 0);
  const slerpDir = (a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) => {
    const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1), th = Math.acos(dot);
    if (th < 1e-4) return out.copy(a).lerp(b, t).normalize();
    const sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th);
    return out.set(a.x * sa + b.x * sb, a.y * sa + b.y * sb, a.z * sa + b.z * sb).normalize();
  };
  const dA = new THREE.Vector3(), dB = new THREE.Vector3(), dC = new THREE.Vector3(), dQ = new THREE.Quaternion();
  const smoother = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
  const win = (a: number, b: number, x: number) => smoother((x - a) / (b - a));
  const bez = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3) => {
    const u = 1 - t;
    return out.copy(a).multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
  };
  /** Rotation taking frame (x1,y1,x1×y1) to (x2,y2,x2×y2). */
  const frameRot = (x1: THREE.Vector3, y1: THREE.Vector3, x2: THREE.Vector3, y2: THREE.Vector3) => {
    const m1 = new THREE.Matrix4().makeBasis(x1, y1, x1.clone().cross(y1));
    const m2 = new THREE.Matrix4().makeBasis(x2, y2, x2.clone().cross(y2));
    return new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.transpose()));
  };

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
    beginDeploy(h, opts = {}) {
      if (deploy) throw new Error('deploy already running');
      const g = current;
      g.group.scale.setScalar(1); g.setOpacity(1); g.setCloudPresence(1);
      if (outgoing) { outgoing.group.visible = false; outgoing = null; } fade = 1;
      const PC = g.group.position.clone(), Rs = R * g.group.scale.x, s = Rs / h.R;
      // entry point: on the camera-facing lit side, at the same sun elevation the descent uses at its landing site
      const Y = new THREE.Vector3(0, 1, 0), S = sunDir.clone().normalize(), Sd = h.sunDir.clone().normalize();
      const sinEl = Sd.dot(Y), a = Math.acos(THREE.MathUtils.clamp(sinEl, -1, 1));
      carrier.root.updateWorldMatrix(true, true);
      const cBox = new THREE.Box3().setFromObject(carrier.mesh), cCtr = cBox.getCenter(new THREE.Vector3());
      const toC = cCtr.clone().sub(PC).normalize();
      const perp = toC.clone().addScaledVector(S, -toC.dot(S));
      if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0).addScaledVector(S, -S.y);
      perp.normalize();
      const ne = S.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)).normalize();
      // Q maps descent world → stage world directions: +Y (landing up) → ne, and the sun azimuth onto the stage sun
      const xd = Sd.clone().addScaledVector(Y, -Sd.dot(Y)); if (xd.lengthSq() < 1e-8) xd.set(1, 0, 0); xd.normalize();
      const xs = S.clone().addScaledVector(ne, -S.dot(ne)); if (xs.lengthSq() < 1e-8) xs.copy(perp); xs.normalize();
      const Q = frameRot(xd, Y, xs, ne);
      const map = (p: THREE.Vector3) => p.clone().sub(h.centre).applyQuaternion(Q).multiplyScalar(s).add(PC);
      const podEnd = map(h.pod), camEnd = map(h.cam), tgtEnd = map(h.camTarget);
      const qEnd = Q.clone().multiply(h.podQuat);
      // descent globe must show the same surface under the pod: spinWorld_desc = Q⁻¹ · spinWorld_stage
      const qs = g.spin.getWorldQuaternion(new THREE.Quaternion());
      const spinQuat = Q.clone().invert().multiply(qs);

      const rig = createDropRig(carrier.root, { biomeKey: opts.biomeKey ?? 'dune', carrierScale: h.carrierScale, podYaw: h.podYawLocal, attachPod: true });
      rig.setBayGlow(0); rig.setOpen(0); rig.podRig.visible = false;
      for (const m of [rig.pod.root, rig.group]) m.traverse((o) => { const mm = (o as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined; if (mm) mm.fog = false; });
      // hold shot: behind/above the carrier, looking past it at the entry point on the planet
      const toEntry = podEnd.clone().sub(cCtr).normalize();
      const side = toEntry.clone().cross(Y).normalize();
      const holdCam = cCtr.clone().addScaledVector(toEntry, -11.5).addScaledVector(Y, 1.2).addScaledVector(side, 3.2);
      const holdTgt = cCtr.clone().addScaledVector(toEntry, 2.0).addScaledVector(Y, -1.1);
      carrier.root.getWorldQuaternion(dQ);
      const atmU = (g.atmosphere.material as THREE.ShaderMaterial).uniforms;
      deploy = {
        T: 0, h, rig, PC, Rs, s, Q, ne, podEnd, camEnd, tgtEnd, qEnd,
        p0: camera.position.clone(), t0: lookNow.clone(), up0: camera.up.clone(), holdCam, holdTgt,
        dropDir: new THREE.Vector3(0, -1, 0).applyQuaternion(dQ).normalize(), released: false, tgtHold1: new THREE.Vector3(),
        P0: new THREE.Vector3(), q0: new THREE.Quaternion(), sc0: 1, O0: new THREE.Vector3(), G0: new THREE.Vector3(), upR: new THREE.Vector3(),
        camR: new THREE.Vector3(), tgtR: new THREE.Vector3(),
        sunI0: sunLight.intensity, sunC0: sunLight.color.clone(),
        hemi0: [hemi.color.clone(), hemi.groundColor.clone(), hemi.intensity], rim0: rim.intensity,
        env0: scene.environmentIntensity, exp0: viewport.renderer.toneMappingExposure, bloom0: viewport.bloom.strength,
        cloudS0: g.clouds.scale.x, shell0: atmU.uShell.value as number, near0: camera.near,
      };
      return { spinQuat, cloudRotY: g.clouds.rotation.y };
    },
    deployProgress() { return deploy ? Math.min(1, deploy.T / TC) : 0; },
    deployTn() {
      if (!deploy) return 0;
      const T = deploy.T, st = deploy.h.startAt;
      return T < TB ? THREE.MathUtils.lerp(0, 4, T / TB) : THREE.MathUtils.lerp(4, st, Math.min(1, (T - TB) / (TC - TB)));
    },
    setTerraform(stage, smooth) { current.setTerraform(stage, smooth); },
    setSpinRate(r) { spinRate = r; for (const g of cache.values()) g.setSpinRate(r); },
    setPlanet(next, opts = {}) {
      if (next.kind === current.spec.kind) return;
      fadeDur = opts.duration ?? FADE; morphRate = FADE / fadeDur; continuousSpin = !!opts.continuousSpin;
      if (outgoing) outgoing.group.visible = false;
      outgoing = current;
      current = globeFor(next);
      current.group.visible = true;
      current.spin.rotation.y = outgoing.spin.rotation.y + (continuousSpin ? 0 : 0.9); // arrives mid-rotation → reads as a smooth turn
      current.setOpacity(0); current.setCloudPresence(0); current.setTerraform(0);
      fade = 0;
      tintFromSpec(next);
      activeMoons = moonSetFor(next);
    },
    update(dt, time) {
      if (!deploy) place(dt);
      if (fade < 1) {
        fade = Math.min(1, fade + dt / fadeDur);
        // Staggered quintic windows: the new globe dissolves in over the old one (5 → 70 %); the old one, kept slightly
        // smaller so it sits behind, only fades its shells out afterwards (40 → 100 %). No ghosting, no popping.
        const inE = win(0.05, 0.7, fade), outE = win(0.4, 1, fade), e = smoother(fade);
        current.setOpacity(inE);
        current.setCloudPresence(win(0.4, 1, fade));   // new clouds condense out only once the surface is solid
        current.group.scale.setScalar(1.003 - 0.003 * e);
        if (outgoing) {
          outgoing.setOpacity(1 - outE);
          outgoing.setCloudPresence(1 - win(0, 0.5, fade)); // old clouds dissipate first, while the old surface is still solid
          outgoing.group.scale.setScalar(1 - 0.015 * outE);
          if (!continuousSpin) outgoing.spin.rotation.y -= dt * 0.35 * morphRate * (1 - outE);
          if (fade >= 1) { outgoing.group.visible = false; outgoing.group.scale.setScalar(1); outgoing = null; current.group.scale.setScalar(1); }
        }
        if (!continuousSpin) current.spin.rotation.y -= dt * 0.35 * morphRate * (1 - e) * 0.9;
      }
      if (!deploy) for (const g of [current, outgoing]) if (g) { g.group.position.copy(planetPos); g.update(dt, time); }
      nebTint.lerp(nebTarget, 1 - Math.exp(-dt * 1.5 * morphRate)); layers.setNebulaTint(nebTint);
      backdrop.uniforms.uNebA.value.copy(nebTint);

      if (deploy) {
        const d = deploy, g = current;
        d.T = Math.min(TC, d.T + dt);
        const T = d.T;
        if (T <= TB) {
          // A: fly to the hold shot behind the carrier (planet in the background), pod lowers into the bay
          const e = smoother(T / TA);
          camera.position.lerpVectors(d.p0, d.holdCam, e);
          dA.subVectors(d.holdCam, d.p0);
          camera.position.y += Math.sin(Math.PI * e) * dA.length() * 0.1;
          lookNow.lerpVectors(d.t0, d.holdTgt, smoother(Math.min(1, T / TA * 1.15)));
          camera.position.addScaledVector(dB.subVectors(d.holdTgt, d.holdCam).normalize(), 0.35 * win(TA, TB, T)); // slow push-in
          camera.up.lerpVectors(d.up0, Y_UP, e).normalize();
          camera.lookAt(lookNow);
          const podIn = win(0.3, 2.0, T);
          d.rig.podRig.visible = podIn > 0;
          d.rig.podRig.position.copy(d.rig.dockedCentre);
          d.rig.podRig.position.y += (1 - podIn) * d.rig.podH * 0.95 / d.h.carrierScale;
          // B: clamps open, pod drops out of the bay under gravity
          const open = win(TA - 0.3, TA + 0.4, T);
          d.rig.setOpen(open);
          const fall = Math.max(0, T - (TA + 0.25)), drop = 0.5 * 9.0 * fall * fall;
          d.rig.podRig.position.y -= drop * d.rig.podH * 0.35 / d.h.carrierScale;
          d.rig.podRig.rotation.z = 0.25 * fall * fall;
          d.rig.setBayGlow(d.h.bayGlow * win(0.2, 1.6, T) * (1 - 0.5 * win(TA + 0.2, TB, T)));
          // as the clamps let go the camera re-frames from the ship onto the falling pod
          const track = win(TA - 0.5, TB, T);
          if (track > 0) {
            d.rig.podRig.updateWorldMatrix(true, false);
            d.rig.podRig.getWorldPosition(dC);
            lookNow.lerp(dC, track);
            camera.lookAt(lookNow);
          }
        } else {
          // C: the scale-dive. Pod falls toward the real planet along a curve; pod + camera offset shrink together
          // (constant on-screen size) until everything equals the descent frame mapped onto this globe.
          if (!d.released) {
            d.released = true;
            scene.attach(d.rig.podRig);
            d.rig.podRig.getWorldPosition(d.P0); d.rig.podRig.getWorldQuaternion(d.q0);
            d.sc0 = d.rig.podRig.getWorldScale(dA).x;
            // pod centre (rig origin is the pod centre)
            d.O0.subVectors(camera.position, d.P0); d.G0.subVectors(lookNow, d.P0); d.upR.copy(camera.up); d.tgtHold1.copy(lookNow);
            d.camR.subVectors(d.camEnd, d.podEnd); d.tgtR.subVectors(d.tgtEnd, d.podEnd);
          }
          const u = (T - TB) / (TC - TB), e = smoother(u);
          const ep = 0.5 * u + 2 * u * u - 1.5 * u * u * u; // starts at the drop's speed, accelerates, settles (f'(1)=0)
          const L = d.P0.distanceTo(d.podEnd);
          dA.copy(d.P0).addScaledVector(d.dropDir, L * 0.18);
          dB.copy(d.podEnd).addScaledVector(d.ne, L * 0.42);
          bez(d.P0, dA, dB, d.podEnd, ep, dC);
          const sc = Math.exp(THREE.MathUtils.lerp(Math.log(d.sc0), Math.log(d.s), ep));
          d.rig.podRig.position.copy(dC);
          d.rig.podRig.scale.setScalar(sc);
          d.rig.podRig.quaternion.copy(d.q0).slerp(d.qEnd, e);
          // camera offset: direction slerp, length tied to the pod scale
          const k0 = d.O0.length() / d.sc0, k1 = d.camR.length() / d.s;
          dA.copy(d.O0).normalize(); dB.copy(d.camR).normalize();
          slerpDir(dA, dB, e, dA);
          camera.position.copy(dC).addScaledVector(dA, THREE.MathUtils.lerp(k0, k1, e) * sc);
          dB.copy(d.G0).multiplyScalar(1 / d.sc0).lerp(dA.copy(d.tgtR).multiplyScalar(1 / d.s), e).multiplyScalar(sc);
          lookNow.copy(dC).add(dB);
          // ease from the world-fixed hold shot into pod-follow (no velocity kick at release)
          const f = win(0, 0.3, u);
          if (f < 1) {
            dA.subVectors(d.holdTgt, d.holdCam).normalize();
            dB.copy(d.holdCam).addScaledVector(dA, 0.35);
            camera.position.lerpVectors(dB, camera.position, f);
            lookNow.lerpVectors(d.tgtHold1, lookNow, f);
          }
          camera.up.copy(d.upR).lerp(d.ne, e).normalize();
          camera.lookAt(lookNow);
          camera.near = THREE.MathUtils.clamp(camera.position.distanceTo(dC) * 0.02, 0.0004, d.near0);
          camera.fov = THREE.MathUtils.lerp(28, d.h.fov, e);
          camera.updateProjectionMatrix();
          // globe look converges to the descent's: cloud shell height, atmosphere thickness, cloud near-fade
          g.clouds.scale.setScalar(THREE.MathUtils.lerp(d.cloudS0, (1 + 150 / d.h.R) / 1.012, e));
          (g.atmosphere.material as THREE.ShaderMaterial).uniforms.uShell.value = THREE.MathUtils.lerp(d.shell0, 1.035, e);
          g.shared.uCloudNear.value.set(40 * d.s * e, 500 * d.s * e + 0.0001);
          d.rig.setBayGlow(d.h.bayGlow * 0.5 * (1 - win(0, 0.3, u)));
        }
        camera.updateMatrixWorld();
        tickArchetypeMesh(d.rig.pod.mesh, time);
        // lighting / grading converge to the descent's frame (sun direction already identical by construction)
        const l = win(0.5, TC - 0.5, T);
        sunLight.intensity = THREE.MathUtils.lerp(d.sunI0, d.h.sunIntensity, l);
        sunLight.color.copy(d.sunC0).lerp(d.h.sunColor, l);
        hemi.color.copy(d.hemi0[0]).lerp(d.h.hemiColor, l); hemi.groundColor.copy(d.hemi0[1]).lerp(d.h.hemiGround, l);
        hemi.intensity = THREE.MathUtils.lerp(d.hemi0[2], d.h.hemiIntensity, l);
        rim.intensity = d.rim0 * (1 - l);
        scene.environmentIntensity = THREE.MathUtils.lerp(d.env0, d.h.envIntensity, l);
        viewport.renderer.toneMappingExposure = THREE.MathUtils.lerp(d.exp0, d.h.exposure, l);
        viewport.bloom.strength = THREE.MathUtils.lerp(d.bloom0, d.h.bloom, l);
        sunFlare.setFade(1 - win(0.0, 2.0, T));
      } else {
        // camera: slow cinematic sway + mouse-driven parallax (planet/carrier/moons/layers separate by depth)
        mouseS.lerp(mouse, 1 - Math.exp(-dt * 2.5));
        camera.position.set(
          camBase.x + Math.sin(time * 0.05) * 0.9 + mouseS.x * 3.6,
          camBase.y + Math.sin(time * 0.037 + 1.0) * 0.35 + mouseS.y * 2.0,
          camBase.z,
        );
        lookNow.set(planetPos.x * 0.35, 0.3, 0);
        camera.lookAt(lookNow);
        camera.updateMatrixWorld();
      }
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
        ms.k += (target - ms.k) * Math.min(1, dt * 2.2 * morphRate);
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
      if (!deploy) {
      const cx = planetPos.x - 13.5 + Math.sin(time * 0.11) * 1.4;
      const cy = -5.2 + Math.sin(time * 0.17 + 0.6) * 0.45;
      const cz = 12 + Math.sin(time * 0.083) * 2.0;
      carrier.root.position.set(cx, cy, cz);
      carrier.root.rotation.set(0.08 + Math.sin(time * 0.21) * 0.03, 0.9 + Math.sin(time * 0.07) * 0.22, -0.1 + Math.sin(time * 0.13) * 0.04);
      }
      tickArchetypeMesh(carrier.mesh, time);
    },
    dispose() {
      cache.forEach((g) => g.dispose()); cache.clear();
      window.removeEventListener('pointermove', onMove);
      layers.dispose(); moonSets.forEach((ms) => ms.moons.forEach((m) => m.dispose())); moonSets.clear(); sats.forEach((x) => x.model.dispose());
      deploy?.rig.dispose(); deploy = null;
      camera.near = 0.5; camera.fov = 28; camera.updateProjectionMatrix();
      backdrop.dispose(); sunFlare.dispose(); carrier.dispose();
      scene.remove(sunLight, hemi, rim);
      scene.environment = null;
    },
  };
  return api;
};
