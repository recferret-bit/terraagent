// Data shapes of the validator: input model, issues, report and tunable options.
import type { Box } from './math';
import type { RoleSummary } from './appearance';

export interface PartDef {
  index: number; name: string; zone: string; kind: string;
  /** 0 static · 1 spinY · 2 bobY · 3 recoilZ · 4 bipedLeg · 5 bipedArm · 6 spiderLeg · 7 wheelSpin (see UnifiedColonyMaterial). */
  animType: number;
  pivot: [number, number, number];
  emissive: number;
  /** Zone surface (sRGB hex, roughness, metalness). Optional: falls back to the zone's default. */
  color?: number; roughness?: number; metalness?: number;
  tris: Float32Array;
}
export interface ModelInput { id: string; label: string; source: 'builder' | 'components'; parts: PartDef[] }

export type Severity = 'error' | 'warn' | 'info';
export interface Issue {
  severity: Severity; code: string; message: string;
  /** Part indices involved (first = the one to fix). */
  parts: number[]; at?: [number, number, number]; hint?: string;
}
export interface PartStat { index: number; name: string; zone: string; kind: string; animType: number; tris: number; box: Box; closed: boolean }
export interface PairStat { a: number; b: number; dist: number; crossing: boolean; zfight: number; embedA: number; embedB: number; depth: number }
export interface Report {
  id: string; label: string; source: ModelInput['source'];
  partCount: number; triCount: number; box: Box; minY: number;
  issues: Issue[]; errors: number; warnings: number; pass: boolean;
  parts: PartStat[]; zoneArea: Record<string, number>;
  /** Appearance summary (colour of each functional group, mean lightness); absent when the appearance checks did not run. */
  roles?: RoleSummary[]; meanL?: number; pairs?: PairStat[]; ms: number;
}

export interface ValidatorOptions {
  /** Surfaces closer than this count as touching (m). */ contactTol: number;
  /** A gap up to this is reported as a "hairline gap" (an almost-attachment) rather than a float (m). */ nearMiss: number;
  /** Parts reaching down to this height are the model's ground contact (m). */ groundTol: number;
  /** An animated part must keep this much clearance from parts it does not rest against (m). */ clearance: number;
  /** Ground-standing models (robots, buildings, deposits, fauna) must touch y = 0. Ships and props in orbit are not grounded. */ grounded: boolean;
  /** How far a foundation may sink below the ground for sloped terrain (m). */ foundationDepth: number;
  triBudget: number; minParts: number;
  /** Embedded fraction (0..1) above which a part is "buried" inside another. */ buriedFrac: number;
  /** Two parts "cut through" each other when BOTH have this fraction inside the other and the depth exceeds cutDepth (m).
   *  A joint sunk into a hull (one-sided) is normal kitbashing and is never reported. */ cutDepth: number; cutFrac: number;
  /** Nearly parallel faces closer than this (m) while their surfaces cross shimmer like z-fighting. */ grazeDist: number;
  /** Keep every pair's stats in the report (debugging / calibration). */ keepPairs: boolean;
  /** Run the colour / material / surface-detail checks (skipped for models whose parts are guessed from islands). */ appearance: boolean;
  /** Face areas below are relative to the model's longest side squared (so a 40 m carrier and a 1.3 m robot are judged alike; the Builder T1 is ≈ 2.1 m²).
   *  Faces at least `flatFace` of that need surface features; the need grows at 2.5x, 5x and 10x. */ flatFace: number;
  /** Inset plates (face ≥ insetMin, relative) must differ from what they sit on by this CIE ΔE; functional groups (≥ groupShare of the surface) by groupContrast. */ insetContrast: number; insetMin: number; groupContrast: number; groupShare: number;
  /** Solar panels: at least this many cells, each with a face smaller than cellMaxFace (relative). */ minCells: number; cellMaxFace: number;
  /** One zone above this surface share is a flat palette; a mean L* below minMeanL reads as a dark blob. */ dominantZone: number; minMeanL: number;
}
export const DEFAULT_OPTIONS: ValidatorOptions = {
  contactTol: 0.004, nearMiss: 0.06, groundTol: 0.02, clearance: 0.01, grounded: true, foundationDepth: 0.105, triBudget: 3500, minParts: 7,
  buriedFrac: 0.92, cutDepth: 0.04, cutFrac: 0.15, grazeDist: 0.003, keepPairs: false,
  appearance: true, flatFace: 0.045, insetContrast: 12, insetMin: 0.014, groupContrast: 14, groupShare: 0.04, minCells: 6, cellMaxFace: 0.028, dominantZone: 0.7, minMeanL: 30,
};

export interface P { def: PartDef; n: number; tris: Float32Array; tb: Float32Array; box: Box; closed: boolean; label: string }
