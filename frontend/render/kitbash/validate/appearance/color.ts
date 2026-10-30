// Colour science (sRGB to CIE L*a*b*, dust-shaded colour, ΔE) and the part roles inferred from names.

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** sRGB hex to CIE L*a*b* (D65). */
export function labOfHex(hex: number): [number, number, number] {
  const r = lin(((hex >> 16) & 255) / 255), g = lin(((hex >> 8) & 255) / 255), b = lin((hex & 255) / 255);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
/** The colour a surface actually shows on a planet: mirrors the fragment shader of UnifiedColonyMaterial (biome dust blended into the
 *  lowest `weatheringHeight` metres, then the top-down gradient). `y` is the height of the surface in model space. Returns L*a*b*. */
export function shadedLab(hex: number, y: number, biome: { dustColor: number; weatheringHeight: number; weatheringIntensity: number }): [number, number, number] {
  const c = [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
  const d = [lin(((biome.dustColor >> 16) & 255) / 255), lin(((biome.dustColor >> 8) & 255) / 255), lin((biome.dustColor & 255) / 255)];
  const t = Math.min(1, Math.max(0, y / biome.weatheringHeight)), smooth = t * t * (3 - 2 * t);
  const mix = Math.min(1, (1 - smooth) * biome.weatheringIntensity); // the shader's grain term (0.75..1.25) averages to 1
  const grad = 0.78 + (1.08 - 0.78) * Math.min(1, Math.max(0, y * 0.6));
  const out = c.map((v, k) => (v * (1 - mix) + d[k] * mix) * grad);
  const back = (v: number) => { const x = Math.min(1, Math.max(0, v)); return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255); };
  return labOfHex((back(out[0]) << 16) | (back(out[1]) << 8) | back(out[2]));
}
/** The worlds the model is judged on: the raw zone colour and the three biomes of the game. */
export const BIOMES = ['dune', 'oceanForest', 'forestRock'] as const;

export const deltaE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------- roles (inferred from part names)

export type Role = 'power' | 'locomotion' | 'sensor' | 'manipulator' | 'platform' | 'other';
const ROLE_PATTERNS: [Role, RegExp][] = [
  ['power', /solar|photovolt|battery|capacitor/i],
  ['locomotion', /wheel|tyre|tire|tread|track|hub|rim|leg|foot|feet|bogie|skid|caster/i],
  ['sensor', /radar|dish|antenna|visor|lens|camera|scanner|sensor/i],
  ['manipulator', /arm|boom|jib|claw|finger|crane|ram\b|torch|gripper|drill|manipulator|hydraulic|turntable|bucket|piston/i],
  ['platform', /chassis|platform|body|hull|cabin|deck|plinth|base|housing|skirt|stripe|frame|plate/i],
];
export const roleOf = (name: string): Role => ROLE_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? 'other';
