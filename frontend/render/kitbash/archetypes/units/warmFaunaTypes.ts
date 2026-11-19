import type { MaterialZoneId, MaterialZoneSpec } from '../../KitbashRegistry';
import type { MammalBuildSpec } from '../../greebles/organic/vertebrateLimbs';

const surface = (color: number, roughness: number): MaterialZoneSpec => ({
  color,
  roughness,
  metalness: 0,
  emissiveIntensity: 0,
});

export function warmPalette(
  coat: number,
  accentCoat: number,
  padAndClaw: number,
  roughness = 0.68,
): Partial<Record<MaterialZoneId, MaterialZoneSpec>> {
  return {
    hullPrimary: surface(coat, roughness),
    hullSecondary: surface(accentCoat, Math.min(0.84, roughness + 0.04)),
    frameGunmetal: surface(padAndClaw, 0.72),
    rubberDark: surface(0x362f2a, 0.78),
    glassVisor: surface(0x181614, 0.14),
  };
}

export type WarmFurRuffKind = 'wolfCape' | 'stagMane' | 'oryxRidge' | 'camelHumpTuft' | 'lynxCheek';

export interface WarmFaunaEntry {
  id: string;
  label: string;
  notes: string;
  zones: Partial<Record<MaterialZoneId, MaterialZoneSpec>>;
  spec: MammalBuildSpec;
  antlers?: { brow: [number, number, number]; spread: number; height: number; tines?: number };
  horns?: { brow: [number, number, number]; length: number; sweepBack?: number; flare?: number };
  furRuff?: WarmFurRuffKind;
}
