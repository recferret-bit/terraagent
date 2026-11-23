import * as THREE from 'three';
import type { VertexColorFn } from '../../KitbashRegistry';

export type MammalCoatPattern = 'countershade' | 'tapirSaddle' | 'oryxMarkings' | 'wolfMask' | 'felineSpots' | 'lemurMask';

export interface TrunkBoundStation {
  z: number;
  yMin: number;
  yMax: number;
  rx: number;
}

export interface MammalBodyColorBounds {
  zMin: number;
  zMax: number;
  yMin: number;
  yMax: number;
  stations?: readonly TrunkBoundStation[];
}

export function computeTrunkBounds(
  stations: readonly { y: number; z: number; rx?: number; ryTop: number; ryBot: number }[],
): MammalBodyColorBounds {
  let zMin = Infinity, zMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  const profile: TrunkBoundStation[] = [];
  for (const st of stations) {
    const sMin = st.y - st.ryBot;
    const sMax = st.y + st.ryTop;
    zMin = Math.min(zMin, st.z);
    zMax = Math.max(zMax, st.z);
    yMin = Math.min(yMin, sMin);
    yMax = Math.max(yMax, sMax);
    profile.push({ z: st.z, yMin: sMin, yMax: sMax, rx: st.rx ?? 0.12 });
  }
  return { zMin, zMax, yMin, yMax, stations: profile };
}

function sampleTrunkProfile(bounds: MammalBodyColorBounds, z: number): { yMin: number; yMax: number; rx: number } {
  const sts = bounds.stations;
  if (!sts || sts.length === 0) return { yMin: bounds.yMin, yMax: bounds.yMax, rx: 0.12 };
  if (z <= sts[0]!.z) return sts[0]!;
  for (let i = 0; i < sts.length - 1; i++) {
    const a = sts[i]!;
    const b = sts[i + 1]!;
    if (z <= b.z) {
      const t = (z - a.z) / Math.max(1e-5, b.z - a.z);
      return {
        yMin: THREE.MathUtils.lerp(a.yMin, b.yMin, t),
        yMax: THREE.MathUtils.lerp(a.yMax, b.yMax, t),
        rx: THREE.MathUtils.lerp(a.rx, b.rx, t),
      };
    }
  }
  return sts[sts.length - 1]!;
}

export function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function makeMammalBodyColor(
  pattern: MammalCoatPattern = 'countershade',
  bounds?: MammalBodyColorBounds,
): VertexColorFn {
  return (pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);

    const prof = bounds ? sampleTrunkProfile(bounds, pos.z) : undefined;
    const bodyV = bounds
      ? THREE.MathUtils.clamp((pos.z - bounds.zMin) / Math.max(0.05, bounds.zMax - bounds.zMin), 0, 1)
      : v;
    const bodyY = prof
      ? THREE.MathUtils.clamp((pos.y - prof.yMin) / Math.max(0.04, prof.yMax - prof.yMin), 0, 1)
      : 0.5 + norm.y * 0.5;
    const ny = prof ? THREE.MathUtils.clamp((bodyY - 0.48) * 2.0, -1, 1) : norm.y;
    const latFrac = prof ? Math.abs(pos.x) / Math.max(0.03, prof.rx) : Math.abs(norm.x);
    const ventralFacing = Math.max(smooth01(-0.04, -0.56, norm.y), (1 - smooth01(0.42, 0.86, latFrac)) * 0.85);
    const bellyGate = prof ? (1 - smooth01(0.08, 0.36, bodyY)) * ventralFacing : 1;

    if (pattern === 'tapirSaddle') {
      // Malayan saddleback blanket covering dorsal mid-back & croup while keeping shoulders, lower haunches & legs dark.
      const rearEdge = smooth01(0.14, 0.24, bodyV);
      const frontEdge = 1 - smooth01(0.48, 0.58, bodyV);
      const flankEdge = prof ? smooth01(0.28, 0.46, bodyY) : smooth01(-0.15, 0.20, ny);
      out.lerp(sec, rearEdge * frontEdge * flankEdge * 0.94);
      return;
    }

    if (pattern === 'oryxMarkings') {
      const midBellySpan = smooth01(0.18, 0.30, bodyV) * (1 - smooth01(0.64, 0.76, bodyV));
      const whiteBelly = (1 - smooth01(0.05, 0.18, bodyY)) * ventralFacing * midBellySpan;
      out.lerp(sec, whiteBelly * 0.94);
      const dorsalStripe =
        smooth01(0.74, 0.94, norm.y) *
        (prof ? smooth01(0.84, 0.96, bodyY) : 1) *
        smooth01(0.08, 0.20, bodyV) *
        (1 - smooth01(0.82, 0.94, bodyV));
      const bandBot = smooth01(0.06, 0.16, bodyY);
      const bandTop = 1 - smooth01(0.42, 0.54, bodyY);
      const latMask = smooth01(0.24, 0.62, Math.abs(norm.x));
      const flankBand =
        bandBot *
        bandTop *
        latMask *
        smooth01(0.10, 0.22, bodyV) *
        (1 - smooth01(0.84, 0.94, bodyV));
      const chestBrisket =
        smooth01(0.58, 0.74, bodyV) *
        (1 - smooth01(0.90, 0.99, bodyV)) *
        (1 - smooth01(0.32, 0.46, bodyY));
      out.lerp(dark, Math.min(0.98, Math.max(dorsalStripe * 0.92, flankBand * 0.96, chestBrisket * 0.96)));
      return;
    }

    const ventral = smooth01(-0.06, -0.58, ny) * bellyGate;
    const dorsalShade = 1 - smooth01(0.35, 0.88, ny) * (prof ? smooth01(0.54, 0.84, bodyY) : 1) * 0.14;
    out.multiplyScalar(dorsalShade);
    out.lerp(sec, ventral * (pattern === 'felineSpots' ? 0.58 : pattern === 'lemurMask' ? 0.80 : 0.72));
    if (pattern === 'wolfMask') {
      const saddle =
        smooth01(0.22, 0.78, ny) *
        (prof ? smooth01(0.52, 0.78, bodyY) : 1) *
        smooth01(0.14, 0.40, bodyV) *
        (1 - smooth01(0.80, 0.95, bodyV));
      out.lerp(dark, saddle * 0.46);
    } else if (pattern === 'felineSpots') {
      const dapple = 0.5 + 0.5 * Math.sin(pos.z * 26 + Math.sin(pos.x * 24)) * Math.cos(pos.y * 28);
      out.lerp(dark, dapple * (1 - ventral) * 0.18);
    }
  };
}

export function makeEarColor(hasDarkTip: boolean): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);
    const inner = smooth01(0.15, 0.72, norm.z) * (1 - smooth01(0.75, 0.98, v));
    out.lerp(sec, inner * 0.55);
    if (hasDarkTip) out.lerp(dark, smooth01(0.55, 0.92, v) * 0.85);
  };
}

export function makeMuzzleColor(muzzleBlend?: boolean, pattern?: MammalCoatPattern): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);
    if (muzzleBlend) {
      const lowerMask = smooth01(0.12, -0.52, norm.y);
      const midMask = 1 - smooth01(0.72, 0.96, v);
      out.lerp(sec, lowerMask * midMask * 0.72);
      if (pattern === 'oryxMarkings') {
        out.copy(sec);
        const nasalPatch = smooth01(0.22, 0.72, norm.y) * smooth01(0.04, 0.24, v) * (1 - smooth01(0.55, 0.76, v));
        out.lerp(dark, nasalPatch * 0.96);
        return;
      }
      if (pattern === 'wolfMask' || pattern === 'felineSpots') {
        out.lerp(dark, smooth01(0.32, 0.86, norm.y) * smooth01(0.15, 0.85, v) * 0.32);
      } else if (pattern === 'lemurMask') {
        out.lerp(dark, smooth01(0.25, 0.85, v) * 0.86);
      }
      return;
    }
    const bridge = smooth01(0.35, 0.85, norm.y) * (1 - smooth01(0.35, 0.85, v));
    out.lerp(prim, bridge * 0.55);
  };
}

export function makeJawColor(muzzleBlend?: boolean): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    out.copy(prim);
    if (muzzleBlend) {
      const chinMask = smooth01(-0.04, -0.64, norm.y) * (1 - smooth01(0.75, 0.98, v) * 0.35);
      out.lerp(sec, chinMask * 0.76);
    }
  };
}

export function makeHeadColor(pattern?: MammalCoatPattern): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);
    if (pattern !== 'tapirSaddle') {
      out.lerp(sec, smooth01(-0.04, -0.55, norm.y) * 0.68);
    }
    if (pattern === 'oryxMarkings') {
      out.copy(sec);
      const foreheadDiamond = smooth01(0.38, 0.82, norm.y) * smooth01(0.22, 0.72, v);
      const eyeCheekStrap = smooth01(0.38, 0.84, Math.abs(norm.x)) * smooth01(0.34, 0.82, v);
      out.lerp(dark, Math.max(foreheadDiamond * 0.94, eyeCheekStrap * 0.95));
    } else if (pattern === 'wolfMask') {
      const cheekLight = smooth01(0.42, 0.88, Math.abs(norm.x)) * smooth01(0.22, 0.75, v) * (1 - smooth01(0.18, 0.55, norm.y));
      const crownDark = smooth01(0.38, 0.88, norm.y);
      out.lerp(sec, cheekLight * 0.65);
      out.lerp(dark, crownDark * 0.36);
    } else if (pattern === 'lemurMask') {
      const cheek = smooth01(0.45, 0.90, Math.abs(norm.x)) * (1 - smooth01(0.75, 0.96, v));
      const eyeMask = smooth01(0.35, 0.85, v) * (1 - smooth01(0.55, 0.95, Math.abs(norm.x)));
      out.lerp(sec, cheek * 0.86);
      out.lerp(dark, eyeMask * 0.82);
    }
  };
}

export function makeLimbColor(
  sockMix: boolean,
  pattern?: MammalCoatPattern,
  bounds?: MammalBodyColorBounds,
): VertexColorFn {
  const bodyFn = bounds ? makeMammalBodyColor(pattern ?? 'countershade', bounds) : undefined;
  return (pos, norm, u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);
    if (!sockMix && bodyFn) {
      if (pattern === 'oryxMarkings') {
        bodyFn(pos, norm, u, v, zones, out);
        out.lerp(dark, smooth01(0.18, 0.56, v) * 0.96);
        return;
      }
      if (pattern === 'tapirSaddle') {
        bodyFn(pos, norm, u, v, zones, out);
        out.lerp(prim, smooth01(0.16, 0.52, v) * 0.96);
        return;
      }
      // Keep outer lateral shoulder/thigh matched to hullPrimary flank; soft countershade only on medial inner face.
      const medialInner = pos.x * norm.x < 0 ? smooth01(0.05, 0.65, -Math.sign(pos.x) * norm.x) : 0;
      out.lerp(sec, medialInner * (1 - smooth01(0.45, 0.85, v)) * 0.42);
      if (pattern === 'felineSpots') {
        const dapple = 0.5 + 0.5 * Math.sin(pos.z * 26 + Math.sin(pos.x * 24)) * Math.cos(pos.y * 28);
        out.lerp(dark, dapple * (1 - medialInner) * 0.16);
      }
      return;
    }
    const medialInner = pos.x * norm.x < 0 ? smooth01(0.05, 0.65, -Math.sign(pos.x) * norm.x) : 0;
    out.lerp(sec, medialInner * smooth01(0.18, 0.52, v) * 0.28);
    if (pattern === 'oryxMarkings') {
      if (sockMix) {
        const upperCuff = 1 - smooth01(0.18, 0.42, v);
        out.copy(sec).lerp(dark, upperCuff * 0.95);
      } else {
        const lowerGuard = smooth01(0.22, 0.62, v);
        out.lerp(dark, lowerGuard * 0.94);
      }
      return;
    }
    if (sockMix) out.lerp(sec, smooth01(0.45, 0.88, v) * 0.85);
  };
}

export function makeTailBandColor(bands: number): VertexColorFn {
  return (_pos, _norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    const wave = Math.sin(v * Math.PI * (bands * 2 + 1));
    out.copy(prim).lerp(wave > 0 ? sec : dark, Math.abs(wave) > 0.2 ? 0.82 : 0.3);
  };
}

export function makeSmoothBrushTailColor(tipZone: 'hullSecondary' | 'rubberDark' | 'frameGunmetal', tipStart = 0.52): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const tip = new THREE.Color(zones[tipZone].color);
    const dorsalShade = smooth01(0.10, 0.88, norm.y) * 0.24;
    out.copy(prim).lerp(tip, dorsalShade);
    out.lerp(tip, smooth01(tipStart, 0.95, v) * 0.90);
  };
}

export function makeBirdPlumageColor(opts: {
  breastBib?: boolean;
  mantleTint?: number;
  bellyTint?: number;
}): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    out.copy(prim);
    if (opts.bellyTint !== undefined) {
      const belly = new THREE.Color(opts.bellyTint);
      const ventral = smooth01(0.18, -0.42, norm.y);
      const dorsal = smooth01(0.28, 0.85, norm.y);
      out.lerp(belly, ventral * 0.80);
      if (opts.mantleTint !== undefined) out.lerp(new THREE.Color(opts.mantleTint), dorsal * 0.72);
      return;
    }
    if (opts.mantleTint !== undefined) {
      out.lerp(new THREE.Color(opts.mantleTint), smooth01(0.25, 0.85, norm.y) * 0.68);
    }
    if (opts.breastBib) {
      const ventral = smooth01(0.12, -0.35, norm.y);
      const chestMask = smooth01(0.18, 0.62, v);
      out.lerp(sec, ventral * (0.45 + 0.55 * chestMask));
    }
  };
}

export function makeBirdBeakColor(baseTint?: number): VertexColorFn | undefined {
  if (baseTint === undefined) return undefined;
  return (_pos, _norm, _u, v, zones, out) => {
    const dark = new THREE.Color(zones.rubberDark.color);
    out.setHex(baseTint).lerp(dark, smooth01(0.36, 0.66, v));
  };
}

export function makeBirdWingColor(isOuter: boolean, darkTips: boolean, mantleTint?: number): VertexColorFn {
  return (_pos, _norm, s, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    out.copy(prim);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    if (!isOuter) {
      const covertColor = mantleTint !== undefined ? new THREE.Color(mantleTint) : sec;
      const covertMix = (1 - smooth01(0.28, 0.62, s)) * (mantleTint !== undefined ? 0.68 : 0.42);
      out.lerp(covertColor, covertMix);
    } else {
      const tipBlend = smooth01(0.15, 0.85, v) * 0.72;
      out.lerp(darkTips ? dark : sec, tipBlend);
    }
  };
}

export function makeBirdCovertColor(mantleTint?: number): VertexColorFn {
  return (_pos, _norm, s, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const covert = mantleTint !== undefined ? new THREE.Color(mantleTint) : new THREE.Color(zones.hullSecondary.color);
    const leadFade = 1 - smooth01(0.0, 0.25, s);
    const edgeFade = smooth01(0.24, 0.92, s);
    const tipFade = smooth01(0.45, 0.95, v);
    out.copy(covert).lerp(prim, Math.max(leadFade * 0.45, edgeFade * 0.80, tipFade * 0.72));
  };
}

export function makeBirdHeadColor(
  opts: { bibCrownDark?: boolean; breastBib?: boolean; bellyTint?: number; mantleTint?: number },
  isNeck = false,
): VertexColorFn | undefined {
  if (!opts.bibCrownDark && !(isNeck && (opts.breastBib || opts.bellyTint !== undefined))) return undefined;
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    if (opts.bibCrownDark) {
      const topMask = smooth01(-0.08, 0.30, norm.y);
      out.copy(sec).lerp(prim, topMask);
      return;
    }
    out.copy(prim);
    if (isNeck && opts.bellyTint !== undefined) {
      const belly = new THREE.Color(opts.bellyTint);
      const dorsal = smooth01(0.18, 0.72, norm.y);
      const neckRoot = 1 - smooth01(0.10, 0.75, v);
      out.lerp(belly, smooth01(0.18, -0.35, norm.y) * 0.74);
      if (opts.mantleTint !== undefined) out.lerp(new THREE.Color(opts.mantleTint), dorsal * neckRoot * 0.55);
      return;
    }
    if (isNeck && opts.breastBib) {
      const ventral = smooth01(0.16, -0.32, norm.y);
      const throatFade = 1 - smooth01(0.28, 0.88, v);
      out.lerp(sec, ventral * throatFade * 0.88);
    }
  };
}
