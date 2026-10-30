import * as THREE from 'three';
import { makeGlowTexture, makeStreakTexture, makeRaysTexture, makeRingTexture } from './flareTextures';

/** Procedural lens-flare-ish sun: HDR core glow + streak + ghost rings along the sun→screen-centre line. */
export interface SunFlare {
  readonly group: THREE.Group;
  /** World position of the sun (glow core sits here, depth-tested so the planet can eclipse it). */
  setPosition(p: THREE.Vector3): void;
  /** Planet that can occlude the sun (world centre + radius) — ghosts fade when the sun is behind it. */
  setOccluder(centre: THREE.Vector3, radius: number): void;
  /** 0..1 — how strongly the viewer is "interacting" with the sun (mouse proximity). Smoothly brightens/expands the flare. */
  setExcite(k: number): void;
  /** Pointer in NDC (-1..1). Only the lens glow reacts: ghost axis pivots on it, streak leans toward it. */
  setPointer(x: number, y: number): void;
  /** 0..1 overall flare visibility (deploy dolly fades it out). */
  setFade(f: number): void;
  update(camera: THREE.PerspectiveCamera, time: number): void;
  dispose(): void;
}

export function createSunFlare(color: THREE.ColorRepresentation = 0xfff0d8): SunFlare {
  const group = new THREE.Group();
  group.name = 'SunFlare';
  const base = new THREE.Color(color);
  const glowTex = makeGlowTexture(), streakTex = makeStreakTexture();
  const raysA = makeRaysTexture(11, 22), raysB = makeRaysTexture(97, 14);
  const ringTex = makeRingTexture();
  const mk = (tex: THREE.Texture, depthTest: boolean) => new THREE.SpriteMaterial({
    map: tex, color: base.clone(), transparent: true, blending: THREE.AdditiveBlending, depthTest, depthWrite: false, toneMapped: false, fog: false,
  });
  const coreMat = mk(glowTex, true), haloMat = mk(glowTex, true), streakMat = mk(streakTex, true);
  const core = new THREE.Sprite(coreMat), halo = new THREE.Sprite(haloMat), streak = new THREE.Sprite(streakMat);
  core.renderOrder = 5; halo.renderOrder = 4; streak.renderOrder = 4;
  const raysAMat = mk(raysA, true), raysBMat = mk(raysB, true);
  const rayA = new THREE.Sprite(raysAMat), rayB = new THREE.Sprite(raysBMat);
  rayA.renderOrder = 3; rayB.renderOrder = 3;
  group.add(halo, rayA, rayB, streak, core);
  let fadeK = 1;
  let excite = 0, exciteS = 0, px = 0, py = 0, pxS = 0, pyS = 0;
  const ghostMats: THREE.SpriteMaterial[] = [];
  const ghosts: { s: THREE.Sprite; k: number; size: number; a: number }[] = [];
  const GH = [[-0.45, 0.07, 0.05], [-0.9, 0.12, 0.03], [0.55, 0.05, 0.04], [1.4, 0.18, 0.025], [-1.35, 0.04, 0.05], [0.25, 0.09, 0.03]];
  for (const [k, size, a] of GH) {
    const m = mk(ringTex, false); ghostMats.push(m);
    const s = new THREE.Sprite(m); s.renderOrder = 6; group.add(s); ghosts.push({ s, k, size, a });
  }
  const sun = new THREE.Vector3(), occC = new THREE.Vector3(), tmpV = new THREE.Vector3(), ndc = new THREE.Vector3();
  let occR = 0;

  return {
    group,
    setPosition(p) { sun.copy(p); group.position.copy(p); core.position.set(0, 0, 0); halo.position.set(0, 0, 0); streak.position.set(0, 0, 0); },
    setPointer(x, y) { px = x; py = y; },
    setFade(f) { fadeK = Math.min(1, Math.max(0, f)); group.visible = fadeK > 0.002; },
    setExcite(k) { excite = THREE.MathUtils.clamp(k, 0, 1); },
    setOccluder(c, r) { occC.copy(c); occR = r; },
    update(camera, time) {
      const dist = camera.position.distanceTo(sun);
      const fovK = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 2 * dist; // world height covered at sun distance
      exciteS += (excite - exciteS) * 0.08; pxS += (px - pxS) * 0.08; pyS += (py - pyS) * 0.08;
      const flick = 1 + 0.05 * Math.sin(time * 1.7) + 0.035 * Math.sin(time * 4.9 + 1.3) + 0.02 * Math.sin(time * 11.0);
      const pulse = flick * (1 + 0.35 * exciteS);
      core.scale.setScalar(fovK * 0.07 * pulse); halo.scale.setScalar(fovK * (0.38 + 0.12 * exciteS) * (0.97 + 0.03 * flick));
      streak.scale.set(fovK * (0.9 + 0.5 * exciteS), fovK * 0.12, 1);
      rayA.scale.setScalar(fovK * (0.55 + 0.2 * exciteS) * flick); rayB.scale.setScalar(fovK * (0.42 + 0.15 * exciteS) * (2 - flick));
      raysAMat.rotation = time * 0.035 + exciteS * 0.4; raysBMat.rotation = -time * 0.05 - exciteS * 0.3;
      const k = 1 + 0.9 * exciteS;
      coreMat.color.copy(base).multiplyScalar(2.6 * k); haloMat.color.copy(base).multiplyScalar(0.7 * k); streakMat.color.copy(base).multiplyScalar(0.45 * k);
      raysAMat.color.copy(base).multiplyScalar(0.5 * k * flick); raysBMat.color.copy(base).multiplyScalar(0.35 * k);
      // occlusion by planet: distance of camera→sun ray from the planet centre
      let vis = 1;
      if (occR > 0) {
        tmpV.copy(sun).sub(camera.position); const L = tmpV.length(); tmpV.divideScalar(L);
        const oc = occC.clone().sub(camera.position); const t = oc.dot(tmpV);
        if (t > 0 && t < L) { const d = Math.sqrt(Math.max(oc.lengthSq() - t * t, 0)); vis = THREE.MathUtils.smoothstep(d, occR * 0.97, occR * 1.06); }
      }
      // ghosts along line sun → screen centre (in NDC), placed on a plane 30 units in front of the camera
      ndc.copy(sun).project(camera);
      const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 1.4 && Math.abs(ndc.y) < 1.4;
      const edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), 0.9, 1.4);
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i];
        g.s.visible = onScreen && vis > 0.01;
        if (!g.s.visible) continue;
        tmpV.set(pxS + (ndc.x - pxS) * g.k, pyS + (ndc.y - pyS) * g.k, 0.5).unproject(camera);
        tmpV.sub(camera.position).normalize();
        g.s.position.copy(camera.position).addScaledVector(tmpV, 30).sub(group.position);
        g.s.scale.setScalar(g.size * 30 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 2);
        ghostMats[i].color.copy(base).multiplyScalar(g.a * 2.2 * (1 + 1.2 * exciteS) * vis * edge);
      }
      for (const m of [coreMat, haloMat, streakMat, raysAMat, raysBMat, ...ghostMats]) m.color.multiplyScalar(fadeK);
      streakMat.rotation = Math.atan2(pyS - ndc.y, pxS - ndc.x) * 0.22 * exciteS; streakMat.opacity = vis; haloMat.opacity = 0.5 + 0.5 * vis; raysAMat.opacity = raysBMat.opacity = 0.35 + 0.65 * vis;
    },
    dispose() {
      glowTex.dispose(); raysA.dispose(); raysB.dispose(); raysAMat.dispose(); raysBMat.dispose(); streakTex.dispose(); ringTex.dispose();
      coreMat.dispose(); haloMat.dispose(); streakMat.dispose(); ghostMats.forEach((m) => m.dispose());
      group.removeFromParent();
    },
  };
}
