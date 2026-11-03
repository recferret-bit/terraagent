import * as THREE from 'three';
import { getWindUniforms, WIND_GLSL } from '../../core/windConfig';
import { mulberry32 } from './noise';

export interface ParticleOpts {
  count: number; box: number; height: number; size: number; color: THREE.Color;
  /** Own drift (m/s) on top of the wind, e.g. a slow rise; keep it ~0 in xz so the wind decides the direction. */
  drift: THREE.Vector3;
  wobble: number; additive: boolean; alpha: number; seed: number;
  /** How strongly the layer rides the shared wind (`uWindDrift` × this × (0.5 + seed)); 0 = ignores the wind. */
  windDrift?: number;
  /**
   * Fraction (0..1) of the box half-size over which points fade out toward the box edge (0 = no fade). Use it with a
   * moving `uCenter`: the box then wraps around the centre and a point wrapping at the faded edge never pops.
   */
  edgeFade?: number;
}

/**
 * GPU-animated drifting points (dust / embers / pollen). All motion is in the vertex shader: the wind part reads the
 * CPU-integrated `uWindDrift`, so moving a wind slider bends the paths instead of teleporting the particles. The
 * wrap box is centred on `uniforms.uCenter` (local xz, default the origin): moving it keeps every point at its world
 * spot and only re-wraps the points that leave the box (fade them with `edgeFade`).
 */
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
    uWindK: { value: o.windDrift ?? 0 }, uCenter: { value: new THREE.Vector2() }, uEdge: { value: o.edgeFade ?? 0 },
  };
  const m = new THREE.ShaderMaterial({
    // The shared wind objects by reference (never copies), so every layer follows the one F8 WIND state.
    uniforms: { ...uniforms, ...getWindUniforms() }, transparent: true, depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime,uBox,uH,uSize,uWob,uWindK,uEdge; uniform vec3 uDrift; uniform vec2 uCenter; attribute vec4 aSeed; varying float vA; varying float vS;
      ${WIND_GLSL}
      void main(){
        float sp = 0.5+aSeed.x;
        vec3 p = position + uDrift*uTime*sp + vec3(uWindDrift.x, 0.0, uWindDrift.y)*uWindK*sp;
        float wob = uWob*(0.45 + 1.1*uWindTurb);
        p.x += sin(uTime*(0.5+aSeed.y)+aSeed.z*6.28)*wob; p.z += cos(uTime*(0.4+aSeed.x)+aSeed.w*6.28)*wob;
        p.xz = uCenter + mod(p.xz - uCenter + uBox*0.5, uBox) - uBox*0.5;
        p.y = mod(p.y, uH);
        float life = p.y/uH; vA = smoothstep(0.0,0.1,life)*(1.0-smoothstep(0.65,1.0,life)); vS = aSeed.w;
        if (uEdge > 0.0) { vec2 e = abs(p.xz - uCenter) / (uBox*0.5); vA *= 1.0 - smoothstep(1.0 - uEdge, 1.0, max(e.x, e.y)); }
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
