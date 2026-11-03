import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getViewFocusEdgesUniform, getViewFocusUniform } from '../../core/viewFocus';
import { getWindUniforms } from '../../core/windConfig';
import { createFoliageMaterial, foliageTreeTraits, FOLIAGE_TREE } from './Scatter';

type FakeShader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };

function compileBoth(timeU: THREE.IUniform, sway: number): { color: FakeShader; dep: FakeShader; mat: THREE.MeshStandardMaterial } {
  const mat = createFoliageMaterial(timeU, sway);
  const depth = mat.userData.depthMaterial as THREE.MeshDepthMaterial;
  const color: FakeShader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  const dep: FakeShader = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  mat.onBeforeCompile(color as never, null as never);
  depth.onBeforeCompile(dep as never, null as never);
  return { color, dep, mat };
}

/** The whole displacement block, from the instance read to the instance-space write. */
const swayBlock = (src: string) => src.slice(src.indexOf('mat3 fwM'), src.indexOf('transformed += fwL') + 40);

describe('foliage wind (per-tree inertia sway)', () => {
  it('injects the identical displacement chunk and trait hash into the colour and the shadow-depth program', () => {
    const { color, dep, mat } = compileBoth({ value: 0 }, 0.7);
    const block = swayBlock(color.vertexShader);
    expect(block.length).toBeGreaterThan(500);
    expect(block).toBe(swayBlock(dep.vertexShader));
    // the shadow-map program keeps every caster swaying (off-screen trees can shadow the screen), the colour one fades
    expect(dep.vertexShader).toContain('#define TA_FOCUS_SHADOW_PASS');
    expect(color.vertexShader).not.toContain('#define TA_FOCUS_SHADOW_PASS');
    for (const sh of [color, dep]) {
      expect(sh.vertexShader).toContain('vec4 foliageTraits(vec2 p)');
      expect(sh.vertexShader).toContain('float viewFocusWeight(vec2 p, float fade)');
      expect(sh.vertexShader).toContain('if (fwVw > 0.0)');
      // Inertia reads the gust that already passed the tree: downwind of it (fronts travel +uWindDir with uWindPhase).
      expect(sh.vertexShader).toContain('windGustAt(fwP + uWindDir * fwLag)');
      expect(sh.vertexShader).not.toMatch(/uWindStrength\s*\*\s*uTime|uTime\s*\*\s*uWindStrength/);
    }
    mat.dispose();
  });

  it('shares the view-focus, wind and clock uniforms by reference in both programs', () => {
    const timeU = { value: 2 };
    const { color, dep, mat } = compileBoth(timeU, 1.0);
    for (const sh of [color, dep]) {
      expect(sh.uniforms.uViewFocus).toBe(getViewFocusUniform());
      expect(sh.uniforms.uViewFocusEdges).toBe(getViewFocusEdgesUniform());
      expect(sh.uniforms.uWindGust).toBe(getWindUniforms().uWindGust);
      expect(sh.uniforms.uWindTime).toBe(getWindUniforms().uWindTime);
      expect(sh.uniforms.uTime).toBe(timeU);
    }
    expect(color.uniforms.uSway).toBe(dep.uniforms.uSway);
    mat.dispose();
  });

  // The TS mirror models the GPU hash in float32 steps; it shows the traits decorrelate, it does not prove GPU values.
  it('gives neighbouring trees their own frequency, phase and lag (stable per position)', () => {
    const a = foliageTreeTraits(12.4, -33.1);
    expect(foliageTreeTraits(12.4, -33.1)).toEqual(a);
    const pts: Array<[number, number]> = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) pts.push([40 + i * 2.1, -20 + j * 1.7]);
    const traits = pts.map(([x, z]) => foliageTreeTraits(x, z));
    let closeOmega = 0, closePhase = 0;
    for (let i = 1; i < traits.length; i++) {
      const t = traits[i]!, n = traits[i - 1]!;
      if (Math.abs(t.omega - n.omega) < 0.02) closeOmega++;
      const dp = Math.abs(t.phase - n.phase) % (Math.PI * 2);
      if (Math.min(dp, Math.PI * 2 - dp) < 0.15) closePhase++;
    }
    expect(closeOmega).toBeLessThan(6);
    expect(closePhase).toBeLessThan(6);
    // Phases spread around the whole circle: the mean resultant length of a uniform spread is ~0.
    const c = traits.reduce((s, t) => s + Math.cos(t.phase), 0) / traits.length;
    const s = traits.reduce((s2, t) => s2 + Math.sin(t.phase), 0) / traits.length;
    expect(Math.hypot(c, s)).toBeLessThan(0.35);
    for (const t of traits) {
      expect(t.omega).toBeGreaterThanOrEqual(FOLIAGE_TREE.omega0 * 0.8 - 1e-6);
      expect(t.omega).toBeLessThanOrEqual(FOLIAGE_TREE.omega0 * 1.2 + 1e-6);
      expect(t.lag).toBeGreaterThanOrEqual(1);
      expect(t.lag).toBeLessThanOrEqual(12);
    }
  });

  it('makes bigger trees sway slower (f ~ 1/sqrt(height)) and lag more', () => {
    const small = foliageTreeTraits(5, 7, 0.35), big = foliageTreeTraits(5, 7, 1.4);
    expect(big.omega).toBeLessThan(small.omega);
    expect(small.omega / big.omega).toBeCloseTo(Math.sqrt(1.4 / 0.35), 1);
    expect(big.lag).toBeGreaterThan(small.lag);
  });
});
