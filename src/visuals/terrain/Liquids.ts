import * as THREE from 'three';
import { createHydroWaterMaterial } from '../TerrainAndWaterShaders';
import { NOISE_GLSL } from './glsl';

export interface LiquidResult { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform>; dispose(): void }

interface Common { level: number; heightTex: THREE.Texture; span: number; coverage: number }

function plane(c: Common, seg: number) {
  const g = new THREE.PlaneGeometry(c.coverage, c.coverage, seg, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Animated shallow->deep water built on createHydroWaterMaterial; depth from the baked terrain height texture. */
export function createWater(c: Common, shallow: number, deep: number, sky: number): LiquidResult {
  const { material, uniforms } = createHydroWaterMaterial();
  uniforms.uShallowColor.value.set(shallow);
  uniforms.uDeepColor.value.set(deep);
  uniforms.uFoamColor.value.set(0xf4fdff);
  material.roughness = 0.14; material.metalness = 0.15; material.opacity = 1; material.envMapIntensity = 1.2;
  const extra: Record<string, THREE.IUniform> = {
    uHeightTex: { value: c.heightTex }, uSpan: { value: c.span }, uLevelW: { value: c.level },
    uSky: { value: new THREE.Color(sky) },
  };
  const orig = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    orig.call(material, sh, r);
    Object.assign(sh.uniforms, extra);
    sh.vertexShader = sh.vertexShader.replace('transformed.y += wave1 + wave2;',
      'transformed.y += wave1 * 1.2 + wave2 + sin(wp.x*0.7 + wp.z*0.9 + uTime*1.1) * 0.05;');
    sh.fragmentShader = sh.fragmentShader
      .replace('varying vec3 vWaterWorldPos;', `varying vec3 vWaterWorldPos;
uniform sampler2D uHeightTex; uniform float uSpan, uLevelW; uniform vec3 uSky;
float gFresnelK;
${NOISE_GLSL}`)
      .replace('diffuseColor.rgb = mix(waterCol, uFoamColor, foamCrest * 0.45);', `{
  vec2 p = vWaterWorldPos.xz;
  float th = texture2D(uHeightTex, p/uSpan + 0.5).r;
  float depth = max(uLevelW - th, 0.0);
  float sh = 1.0 - smoothstep(0.0, 2.4, depth);
  vec3 wc = mix(uDeepColor, uShallowColor, sh*sh*0.6 + sh*0.4);
  wc = mix(wc, uShallowColor*1.25, (1.0 - smoothstep(0.0, 0.9, depth))*0.5);
  float t = uTime;
  float fn = vnoise(p*1.3 + vec2(t*0.25, -t*0.18));
  float edge = 0.30 + 0.22*sin(t*1.4 + p.x*0.7 + p.y*0.5) + 0.1*fn;
  float foam = (1.0 - smoothstep(0.0, edge, depth)) * (0.55 + 0.45*fn);
  foam += smoothstep(0.82, 1.0, ripple*0.5+0.5) * 0.12 * sh;
  diffuseColor.rgb = mix(wc, uFoamColor, clamp(foam,0.0,1.0));
  diffuseColor.a = clamp(0.35 + depth*0.55, 0.0, 0.94) + foam*0.3;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ vec2 q = vWaterWorldPos.xz; float tt = uTime;
  vec3 g = vec3(cos(q.x*1.8+tt*2.2)*0.2 + cos(q.x*4.5+tt*3.0+q.y*1.7)*0.06, 0.0, -sin(q.y*2.3-tt*1.7)*0.18 + sin(q.y*5.1-tt*2.6+q.x*1.3)*0.06);
  normal = normalize(normal + (viewMatrix*vec4(g,0.0)).xyz*0.5); }`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
#ifdef USE_FOG
  { float eg = smoothstep(0.5, 0.93, length(vWaterWorldPos.xz) / (uSpan * 0.5)); // same radial fade as the terrain edge
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, eg); gl_FragColor.a = mix(gl_FragColor.a, 1.0, eg); }
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ float fr = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0); totalEmissiveRadiance += uSky*fr*0.55; }`);
  };
  const mesh = new THREE.Mesh(plane(c, 160), material);
  mesh.name = 'water'; mesh.position.y = c.level; mesh.receiveShadow = true; mesh.renderOrder = 1;
  return { mesh, uniforms: { ...uniforms, ...extra }, dispose() { mesh.geometry.dispose(); material.dispose(); } };
}
