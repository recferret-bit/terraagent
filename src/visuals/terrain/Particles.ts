import * as THREE from 'three';
import { mulberry32 } from './noise';

export interface ParticleOpts {
  count: number; box: number; height: number; size: number;
  color: THREE.Color; drift: THREE.Vector3; wobble: number; additive: boolean; alpha: number; seed: number;
}

/** GPU-animated drifting points (dust / embers / pollen). All motion is in the vertex shader. */
export function createParticles(o: ParticleOpts) {
  const r = mulberry32(o.seed);
  const pos = new Float32Array(o.count * 3), seed = new Float32Array(o.count * 4);
  for (let i = 0; i < o.count; i++) {
    pos[i * 3] = (r() - 0.5) * o.box; pos[i * 3 + 1] = r() * o.height; pos[i * 3 + 2] = (r() - 0.5) * o.box;
    seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, o.height / 2, 0), o.box);
  const uniforms = {
    uTime: { value: 0 }, uBox: { value: o.box }, uH: { value: o.height }, uSize: { value: o.size },
    uColor: { value: o.color }, uDrift: { value: o.drift }, uWob: { value: o.wobble }, uAlpha: { value: o.alpha },
  };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime,uBox,uH,uSize,uWob; uniform vec3 uDrift; attribute vec4 aSeed; varying float vA; varying float vS;
      void main(){
        vec3 p = position + uDrift*uTime*(0.5+aSeed.x);
        p.x += sin(uTime*(0.5+aSeed.y)+aSeed.z*6.28)*uWob; p.z += cos(uTime*(0.4+aSeed.x)+aSeed.w*6.28)*uWob;
        p.xz = mod(p.xz + uBox*0.5, uBox) - uBox*0.5;
        p.y = mod(p.y, uH);
        float life = p.y/uH; vA = smoothstep(0.0,0.1,life)*(1.0-smoothstep(0.65,1.0,life)); vS = aSeed.w;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_PointSize = uSize*(0.6+aSeed.z)*420.0/-mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; varying float vA; varying float vS;
      void main(){ vec2 d=gl_PointCoord-0.5; float a=1.0-smoothstep(0.1,0.5,length(d)); if(a<0.01) discard;
        gl_FragColor = vec4(uColor*(0.8+0.4*vS), a*vA*uAlpha); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; pts.name = 'particles'; pts.renderOrder = 5;
  return { points: pts, uniforms, dispose() { g.dispose(); m.dispose(); } };
}
