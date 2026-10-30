import * as THREE from 'three';
import { GLSL_NOISE } from '@terra/render/visuals/space/glslNoise';

/** Stacked cloud layers (soft-faded near the camera) so the pod punches through a deck that "rushes past". */
export interface CloudDeck {
  group: THREE.Group;
  u: { uVis: THREE.IUniform<number>; uCover: THREE.IUniform<number>; uColor: THREE.IUniform<THREE.Color>; uSun: THREE.IUniform<THREE.Vector3>; uCentre: THREE.IUniform<THREE.Vector2>; uTime: THREE.IUniform<number> };
  deckY: number;
  dispose(): void;
}
export function createCloudDeck(deckY: number, cover: number, color: THREE.ColorRepresentation): CloudDeck {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2);
  const u = {
    uVis: { value: 0 }, uCover: { value: cover }, uColor: { value: new THREE.Color(color) }, uSun: { value: new THREE.Vector3(0.486, 0.763, 0.347) },
    uCentre: { value: new THREE.Vector2() }, uTime: { value: 0 },
  };
  const mats: THREE.ShaderMaterial[] = [];
  const offs = [-18, -9, 0, 9, 18];
  offs.forEach((dy, i) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...u, uLayer: { value: i } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: /* glsl */ `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        ${GLSL_NOISE}
        uniform float uVis, uCover, uTime, uLayer; uniform vec3 uColor, uSun; uniform vec2 uCentre; varying vec3 vWP;
        void main(){
          vec2 p = vWP.xz / 240.0 + vec2(uLayer * 7.3, uLayer * 3.1) + vec2(uTime * 0.02, uTime * 0.01) * (1.0 + uLayer * 0.3);
          float n = fbm2(p + fbm2(p * 0.7) * 1.2);
          float thr = mix(0.62, 0.36, uCover);
          float cl = smoothstep(thr, thr + 0.16, n);
          float haze = (uLayer < 0.5 || uLayer > 3.5) ? 0.8 : 0.28;
          float a = max(cl * 0.55, haze * (0.35 + 0.65 * smoothstep(0.2, 0.7, n))) ;
          float dy = abs(cameraPosition.y - vWP.y);
          a *= smoothstep(2.0, 11.0, dy);                                       // never a hard slice at the camera
          float hd = length(vWP.xz - uCentre);
          a *= 1.0 - smoothstep(500.0, 2800.0, hd);
          a *= 1.0 - smoothstep(900.0, 2400.0, distance(cameraPosition, vWP) - 0.0) * 0.0;
          a *= uVis;
          bool above = cameraPosition.y > vWP.y;
          float sunUp = clamp(uSun.y, 0.0, 1.0);
          vec3 top = uColor * (0.55 + 0.5 * sunUp) * (0.85 + 0.25 * n);
          vec3 under = uColor * 0.42 * (0.8 + 0.4 * (1.0 - n));
          vec3 c = above ? top : under;
          gl_FragColor = vec4(c, a);
        }`,
    });
    mats.push(m);
    const mesh = new THREE.Mesh(geo, m); mesh.position.y = deckY + dy; mesh.renderOrder = 10 + i; mesh.frustumCulled = false; group.add(mesh);
  });
  group.visible = false;
  return { group, u, deckY, dispose() { geo.dispose(); mats.forEach((m) => m.dispose()); group.removeFromParent(); } };
}
