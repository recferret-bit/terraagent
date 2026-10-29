import * as THREE from 'three';

/** Cloth-ish parachute: 12 gore panels, GPU billow/flutter, rigging lines updated on CPU (24 verts). */
export interface Canopy {
  group: THREE.Group;           // attach to the pod (origin = pod centre)
  update(time: number, deploy: number, inflate: number, sunDir: THREE.Vector3): void;
  dispose(): void;
}
const GORES = 12;
export function createCanopy(podTopY: number, podRadius: number, colA: THREE.ColorRepresentation, colB: THREE.ColorRepresentation): Canopy {
  const Rc = 5.4, TH = 1.35, lineLen = 7.5;
  const geo = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, TH);
  const u = {
    uTime: { value: 0 }, uInfl: { value: 0 }, uColA: { value: new THREE.Color(colA) }, uColB: { value: new THREE.Color(colB) }, uSun: { value: new THREE.Vector3(0, 1, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */ `
      uniform float uTime, uInfl; varying vec3 vN; varying float vG; varying float vRim; varying vec3 vWP;
      void main(){
        vec3 p = position; vec3 n = normal;
        float rimF = clamp((1.0 - p.y) / (1.0 - cos(${TH.toFixed(3)})), 0.0, 1.0);
        float ang = atan(p.z, p.x);
        float panel = abs(sin(ang * ${(GORES / 2).toFixed(1)}));
        float bulge = (0.10 + 0.07 * sin(uTime * 3.1 + ang * 2.0)) * panel * smoothstep(0.0, 0.5, rimF) * uInfl;
        float flutter = (0.07 + 0.12 * (1.0 - uInfl)) * rimF * rimF * sin(ang * 5.0 + uTime * 7.0 + rimF * 4.0);
        p += n * (bulge + flutter);
        p.y += 0.05 * rimF * sin(ang * 3.0 - uTime * 4.0) * (1.0 + (1.0 - uInfl) * 3.0);
        p *= 1.0 + 0.025 * sin(uTime * 3.3);
        vN = normalize(normalMatrix * n); vG = (ang / 6.28318 + 0.5) * ${GORES.toFixed(1)}; vRim = rimF;
        vec4 w = modelMatrix * vec4(p, 1.0); vWP = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColA, uColB, uSun; varying vec3 vN; varying float vG; varying float vRim; varying vec3 vWP;
      void main(){
        float idx = floor(vG); vec3 base = mod(idx, 2.0) < 0.5 ? uColA : uColB;
        float seam = smoothstep(0.0, 0.06, abs(fract(vG) - 0.5) * 2.0 - 0.0) ; seam = 1.0 - (1.0 - seam) * 0.0;
        float edge = 1.0 - smoothstep(0.0, 0.05, min(fract(vG), 1.0 - fract(vG)));
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        float d = max(dot(N, normalize(uSun)), 0.0);
        float back = pow(max(dot(-N, normalize(uSun)), 0.0), 1.5) * 0.45; // translucent glow
        vec3 c = base * (0.28 + d * 0.8 + back) * (1.0 - edge * 0.45) * (0.85 + 0.15 * vRim);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, mat); dome.castShadow = false; dome.frustumCulled = false;
  const lg = new THREE.BufferGeometry();
  const lp = new Float32Array(GORES * 2 * 3); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lmat = new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.8, fog: false });
  const lines = new THREE.LineSegments(lg, lmat); lines.frustumCulled = false;
  const group = new THREE.Group(); group.add(dome, lines); group.visible = false;
  const rimR = Math.sin(TH);

  return {
    group,
    update(time, deploy, inflate, sunDir) {
      u.uTime.value = time; u.uInfl.value = inflate; u.uSun.value.copy(sunDir);
      const d = THREE.MathUtils.clamp(deploy, 0, 1);
      group.visible = d > 0.001;
      const sxz = THREE.MathUtils.lerp(0.14, 1, inflate) * Rc;
      const sy = THREE.MathUtils.lerp(1.5, 1, inflate) * Rc * 0.62;
      const L = THREE.MathUtils.lerp(2.2, 1, d) * lineLen * (0.15 + 0.85 * d);
      const rimY = podTopY + L;
      dome.scale.set(sxz, sy, sxz);
      dome.position.set(0, rimY - Math.cos(TH) * sy, 0);
      for (let i = 0; i < GORES; i++) {
        const a = (i / GORES - 0.5) * Math.PI * 2 + (Math.PI * 2) / GORES * 0.5 * 0;
        const j = i * 6;
        lp[j] = Math.cos(a) * podRadius * 0.55; lp[j + 1] = podTopY; lp[j + 2] = Math.sin(a) * podRadius * 0.55;
        lp[j + 3] = Math.cos(a) * sxz * rimR; lp[j + 4] = rimY; lp[j + 5] = Math.sin(a) * sxz * rimR;
      }
      lg.attributes.position.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); lg.dispose(); lmat.dispose(); group.removeFromParent(); },
  };
}
