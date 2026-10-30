// Per-part measurements for the appearance checks: face areas by direction, colour as shown on each biome, role.
import { DEFAULT_MATERIAL_ZONES } from '../../KitbashRegistry';
import { triArea } from '../math';
import { BiomeMaterialRegistry } from '../../../visuals/UnifiedColonyMaterial';
import '../../../visuals/biomes';
import { BIOMES, labOfHex, roleOf, shadedLab, type Role } from './color';
import type { P } from '../types';

export interface Face { n: [number, number, number]; area: number; c: [number, number, number] }
export interface Stat {
  p: P; i: number; name: string; zone: string; area: number; faces: Face[]; faceMax: number;
  /** thin plate: two opposite faces carry most of the area */ plate: boolean;
  lab: [number, number, number]; role: Role; emissive: boolean; curved: boolean; tube: boolean;
  /** area-weighted mean height of the part's surface */ y: number;
  /** colour as shown per variant: [raw, ...BIOMES] */ shown: [number, number, number][];
}
const CURVED = /Cylinder|Sphere|Lathe|Capsule|Torus|Cone|Icosahedron|Circle/;

export function measure(p: P): Stat {
  const t = p.tris, bins = new Map<string, Face>(); let area = 0, ya = 0;
  for (let k = 0; k < p.n; k++) {
    const o = k * 9;
    const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2], e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const l = Math.hypot(nx, ny, nz);
    const a = triArea(t, o); area += a; ya += a * (t[o + 1] + t[o + 4] + t[o + 7]) / 3;
    if (l < 1e-12) continue;
    nx /= l; ny /= l; nz /= l;
    const key = `${nx.toFixed(2)},${ny.toFixed(2)},${nz.toFixed(2)}`;
    let f = bins.get(key); if (!f) bins.set(key, (f = { n: [nx, ny, nz], area: 0, c: [0, 0, 0] }));
    f.area += a;
    f.c[0] += a * (t[o] + t[o + 3] + t[o + 6]) / 3; f.c[1] += a * (t[o + 1] + t[o + 4] + t[o + 7]) / 3; f.c[2] += a * (t[o + 2] + t[o + 5] + t[o + 8]) / 3;
  }
  const faces = [...bins.values()].map((f) => ({ ...f, c: [f.c[0] / f.area, f.c[1] / f.area, f.c[2] / f.area] as [number, number, number] })).sort((a, b) => b.area - a.area);
  const top2 = (faces[0]?.area ?? 0) + (faces[1]?.area ?? 0);
  const d = p.def;
  const hex = d.color ?? DEFAULT_MATERIAL_ZONES[d.zone as keyof typeof DEFAULT_MATERIAL_ZONES]?.color ?? 0x808080;
  const y = area ? ya / area : 0;
  return {
    p, i: d.index, name: d.name, zone: d.zone, area, faces, faceMax: faces[0]?.area ?? 0,
    plate: area > 0 && top2 / area >= 0.75 && (faces[0]?.area ?? 0) >= 0.01,
    lab: labOfHex(hex), y, shown: [labOfHex(hex), ...BIOMES.map((b) => shadedLab(hex, y, BiomeMaterialRegistry.getBiome(b)))],
    role: roleOf(d.name), emissive: d.emissive >= 1, curved: CURVED.test(d.kind), tube: d.kind === 'TubeGeometry',
  };
}
