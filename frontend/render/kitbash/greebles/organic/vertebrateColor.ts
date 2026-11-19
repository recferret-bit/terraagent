import * as THREE from 'three';
import type { VertexColorFn } from '../../KitbashRegistry';

export type MammalCoatPattern = 'countershade' | 'tapirSaddle' | 'oryxMarkings' | 'wolfMask' | 'felineSpots' | 'lemurMask';

export function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function makeMammalBodyColor(pattern: MammalCoatPattern = 'countershade'): VertexColorFn {
  return (pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);

    if (pattern === 'tapirSaddle') {
      // Malayan saddleback blanket covering mid-back & ribcage while keeping rump/haunches and shoulders dark.
      const frontEdge = smooth01(0.32, 0.40, v);
      const rearEdge = 1 - smooth01(0.64, 0.72, v);
      const flankEdge = smooth01(-0.30, 0.12, norm.y);
      out.lerp(sec, frontEdge * rearEdge * flankEdge * 0.94);
      return;
    }

    if (pattern === 'oryxMarkings') {
      const dorsalStripe = smooth01(0.64, 0.90, norm.y) * smooth01(0.10, 0.25, v) * (1 - smooth01(0.84, 0.96, v));
      const flankBand = smooth01(-0.42, -0.14, norm.y) * (1 - smooth01(-0.02, 0.24, norm.y)) * smooth01(0.16, 0.30, v) * (1 - smooth01(0.72, 0.86, v));
      out.lerp(dark, Math.max(dorsalStripe * 0.72, flankBand * 0.82));
      return;
    }

    const ventral = smooth01(-0.06, -0.58, norm.y);
    const dorsalShade = 1 - smooth01(0.35, 0.88, norm.y) * 0.14;
    out.multiplyScalar(dorsalShade);
    out.lerp(sec, ventral * (pattern === 'felineSpots' ? 0.52 : pattern === 'lemurMask' ? 0.76 : 0.68));
    if (pattern === 'wolfMask') {
      const saddle = smooth01(0.38, 0.85, norm.y) * smooth01(0.18, 0.45, v) * (1 - smooth01(0.75, 0.92, v));
      out.lerp(dark, saddle * 0.22);
    } else if (pattern === 'felineSpots') {
      const dapple = 0.5 + 0.5 * Math.sin(pos.z * 26 + Math.sin(pos.x * 24)) * Math.cos(pos.y * 28);
      out.lerp(dark, dapple * (1 - ventral) * 0.16);
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
    if (hasDarkTip) out.lerp(dark, smooth01(0.68, 0.96, v) * 0.75);
  };
}

export function makeMuzzleColor(muzzleBlend?: boolean, pattern?: MammalCoatPattern): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);
    if (muzzleBlend) {
      const lowerMask = smooth01(0.05, -0.58, norm.y);
      const midMask = 1 - smooth01(0.68, 0.94, v);
      out.lerp(sec, lowerMask * midMask * 0.65);
      if (pattern === 'oryxMarkings') {
        const blaze = smooth01(0.36, 0.86, norm.y) * smooth01(0.12, 0.78, v);
        out.lerp(dark, blaze * 0.88);
      }
      if (pattern === 'wolfMask' || pattern === 'felineSpots') {
        out.lerp(dark, smooth01(0.76, 0.98, v) * 0.35);
      } else if (pattern === 'lemurMask') {
        out.lerp(dark, smooth01(0.35, 0.88, v) * 0.80);
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
      const chinMask = smooth01(-0.08, -0.68, norm.y) * (1 - smooth01(0.72, 0.98, v) * 0.45);
      out.lerp(sec, chinMask * 0.68);
    }
  };
}

export function makeHeadColor(pattern?: MammalCoatPattern): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    const dark = new THREE.Color(zones.rubberDark.color);
    out.copy(prim);
    out.lerp(sec, smooth01(-0.08, -0.58, norm.y) * 0.65);
    if (pattern === 'oryxMarkings') {
      out.lerp(dark, smooth01(0.30, 0.85, norm.y) * 0.55);
    } else if (pattern === 'lemurMask') {
      const cheek = smooth01(0.45, 0.90, Math.abs(norm.x)) * (1 - smooth01(0.75, 0.96, v));
      const eyeMask = smooth01(0.35, 0.85, v) * (1 - smooth01(0.55, 0.95, Math.abs(norm.x)));
      out.lerp(sec, cheek * 0.82);
      out.lerp(dark, eyeMask * 0.72);
    }
  };
}

export function makeLimbColor(sockMix: boolean): VertexColorFn {
  return (_pos, norm, _u, v, zones, out) => {
    const prim = new THREE.Color(zones.hullPrimary.color);
    const sec = new THREE.Color(zones.hullSecondary.color);
    out.copy(prim);
    out.lerp(sec, smooth01(0.15, -0.45, norm.y) * 0.35);
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
