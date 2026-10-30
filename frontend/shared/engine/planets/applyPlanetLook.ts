import * as THREE from 'three';
import type { PlanetSpec, PlanetKind } from './PlanetSpec';
import type { ColonyViewport } from '../core/createColonyViewport';

/** Sun direction (towards the sun) per planet; the ColonyViewport shadow follower keeps the key light on its own offset. */
const SUN_DIR: Record<PlanetKind, [number, number, number]> = {
  dune: [38, 52, 22],
  oceanForest: [35, 55, 25],
  forestRock: [28, 50, 34],
};
const BLOOM: Record<PlanetKind, { strength: number; radius: number }> = {
  dune: { strength: 0.35, radius: 0.35 }, oceanForest: { strength: 0.4, radius: 0.35 },
  forestRock: { strength: 0.35, radius: 0.35 },
};

const DOME = 'planetSkyDome';

/**
 * Surface-level look: viewport.applySky(spec) + gradient sky dome (follows the camera, ignores fog),
 * per-planet sun direction and bloom. Call whenever a surface becomes active.
 */
export function applyPlanetLook(viewport: ColonyViewport, spec: PlanetSpec): void {
  viewport.applySky(spec);
  const scene = viewport.scene;

  const sd = SUN_DIR[spec.kind];
  viewport.sun.position.set(...sd);
  viewport.bloom.strength = BLOOM[spec.kind].strength;
  viewport.bloom.radius = BLOOM[spec.kind].radius;

  let dome = scene.getObjectByName(DOME) as THREE.Mesh | undefined;
  if (!dome) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop,uHorizon,uSunCol,uSun; varying vec3 vD;
        void main(){ float h = clamp(vD.y,0.0,1.0); float t = pow(h,0.55);
          vec3 c = mix(uHorizon, uTop, smoothstep(0.0,0.85,t));
          float s = max(dot(normalize(vD), normalize(uSun)),0.0);
          c += uSunCol*(pow(s,48.0)*0.9 + pow(s,6.0)*0.18);
          gl_FragColor = vec4(c,1.0); }`,
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
    dome.name = DOME; dome.renderOrder = -1000; dome.frustumCulled = false;
    dome.onBeforeRender = (_r, _s, cam) => dome!.position.copy(cam.position);
    scene.add(dome);
  }
  const m = dome.material as THREE.ShaderMaterial;
  m.uniforms.uTop.value.set(spec.sky.skyColor);
  m.uniforms.uHorizon.value.set(spec.sky.fogColor);
  m.uniforms.uSun.value.set(...sd);
  m.uniforms.uSunCol.value.set(spec.sky.sunColor).multiplyScalar(0.6);
}
