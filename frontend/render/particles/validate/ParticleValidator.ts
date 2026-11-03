import { getParticleGeometryTriCount } from '../geometries';
import type { ParticleLayerSpec, ParticlePresetSpec, ParticleRole } from '../types';

export type ParticleIssueSeverity = 'error' | 'warn' | 'info';

export type ParticleIssueCode =
  | 'FEW_LAYERS'
  | 'FLAT_GEOMETRY_VARIETY'
  | 'MISSING_ROLE'
  | 'ROLE_RATIO_SKEW'
  | 'LOW_LAYER_CONTRAST'
  | 'EMISSIVE_TOO_LOW'
  | 'PRIMARY_EMISSIVE_BLOWOUT'
  | 'NO_GROUND_BOUNCE'
  | 'PHYSICS_INVALID'
  | 'PARTICLE_BUDGET';

export interface ParticleValidationIssue {
  severity: ParticleIssueSeverity;
  code: ParticleIssueCode;
  message: string;
  fix?: string;
}

export interface ParticleValidationReport {
  id: string;
  label: string;
  targetKind: string;
  layerCount: number;
  distinctGeometries: number;
  totalInstances: number;
  totalTriangles: number;
  roleShares: Record<ParticleRole, number>;
  primarySecondaryDeltaE: number;
  issues: ParticleValidationIssue[];
  errors: number;
  warnings: number;
  pass: boolean;
  passed: boolean;
}

/** Convert 24-bit sRGB hex to CIE L*a*b* (D65) for perceptual contrast checks. */
export function hexToLab(hex: number): [number, number, number] {
  const srgb = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE76(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function meanRoleLab(layers: ParticleLayerSpec[], role: ParticleRole): [number, number, number] | null {
  let wSum = 0;
  let lSum = 0;
  let aSum = 0;
  let bSum = 0;
  for (const layer of layers) {
    if (layer.role !== role || layer.count <= 0) continue;
    const [l, a, b] = hexToLab(layer.color);
    wSum += layer.count;
    lSum += l * layer.count;
    aSum += a * layer.count;
    bSum += b * layer.count;
  }
  if (wSum <= 0) return null;
  return [lSum / wSum, aSum / wSum, bSum / wSum];
}

function checkLayerPhysics(layer: ParticleLayerSpec, add: (s: ParticleIssueSeverity, c: ParticleIssueCode, m: string, f?: string) => void): void {
  const nums = [
    layer.count,
    layer.sizeRange[0],
    layer.sizeRange[1],
    layer.speedRange[0],
    layer.speedRange[1],
    layer.upwardBias[0],
    layer.upwardBias[1],
    layer.spreadCone,
    layer.gravity,
    layer.drag,
    layer.bounce,
    layer.spinSpeed,
    layer.lifetimeRange[0],
    layer.lifetimeRange[1],
  ];
  if (nums.some((n) => !Number.isFinite(n))) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" contains NaN or non-finite kinematic parameters.`);
    return;
  }
  if (layer.count <= 0) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" has count ${layer.count} (must be >= 1).`);
  }
  if (layer.sizeRange[0] <= 0 || layer.sizeRange[0] > layer.sizeRange[1] || layer.sizeRange[1] > 0.8) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" has invalid sizeRange [${layer.sizeRange[0]}, ${layer.sizeRange[1]}] (must be in (0, 0.8]).`);
  }
  if (layer.speedRange[0] < 0 || layer.speedRange[0] > layer.speedRange[1] || layer.speedRange[1] <= 0) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" has invalid speedRange [${layer.speedRange[0]}, ${layer.speedRange[1]}].`);
  }
  if (layer.lifetimeRange[0] <= 0.05 || layer.lifetimeRange[0] > layer.lifetimeRange[1] || layer.lifetimeRange[1] > 6.0) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" has invalid lifetimeRange [${layer.lifetimeRange[0]}, ${layer.lifetimeRange[1]}] (must be in (0.05, 6.0]).`);
  }
  if (layer.spreadCone <= 0 || layer.spreadCone > Math.PI + 1e-4) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" spreadCone ${layer.spreadCone.toFixed(2)} must be in (0, PI].`);
  }
  if (layer.drag < 0 || layer.drag > 15) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" drag ${layer.drag} must be in [0, 15].`);
  }
  if (layer.bounce < 0 || layer.bounce > 0.95) {
    add('error', 'PHYSICS_INVALID', `Layer "${layer.name}" bounce ${layer.bounce} must be in [0, 0.95].`);
  }
  if (layer.role !== 'accent' && layer.gravity >= 5.0 && layer.geometry !== 'dustCloud' && layer.bounce <= 0.05) {
    add(
      'warn',
      'NO_GROUND_BOUNCE',
      `Heavy ballistic layer "${layer.name}" (gravity ${layer.gravity} m/s^2) has bounce ${layer.bounce} and will sink through the hex ground without bouncing.`,
      'Set bounce >= 0.2 on heavy physical chunks so debris visibly bounces and skitters on the terrain.',
    );
  }
}

function checkRolesAndHierarchy(
  preset: ParticlePresetSpec,
  roleShares: Record<ParticleRole, number>,
  add: (s: ParticleIssueSeverity, c: ParticleIssueCode, m: string, f?: string) => void,
): number {
  for (const role of ['primary', 'secondary', 'accent'] as const) {
    if (roleShares[role] <= 0) {
      add(
        'error',
        'MISSING_ROLE',
        `Preset "${preset.id}" has 0 instances in the '${role}' role (must enforce 60/30/10 primary/secondary/accent hierarchy).`,
        `Add at least one '${role}' layer.`,
      );
    }
  }
  if (roleShares.primary > 0 && (roleShares.primary < 0.42 || roleShares.primary > 0.75)) {
    add(
      'warn',
      'ROLE_RATIO_SKEW',
      `Primary role share is ${Math.round(roleShares.primary * 100)}% (target ~60%, allowed 42%..75%).`,
      'Rebalance layer counts toward 60% primary target matter, 30% secondary contrast/dust, 10% HDR accent.',
    );
  }
  if (roleShares.secondary > 0 && (roleShares.secondary < 0.16 || roleShares.secondary > 0.45)) {
    add(
      'warn',
      'ROLE_RATIO_SKEW',
      `Secondary role share is ${Math.round(roleShares.secondary * 100)}% (target ~30%, allowed 16%..45%).`,
    );
  }
  if (roleShares.accent > 0 && (roleShares.accent < 0.04 || roleShares.accent > 0.25)) {
    add(
      'warn',
      'ROLE_RATIO_SKEW',
      `Accent role share is ${Math.round(roleShares.accent * 100)}% (target ~10%, allowed 4%..25%).`,
    );
  }

  const labPrimary = meanRoleLab(preset.layers, 'primary');
  const labSecondary = meanRoleLab(preset.layers, 'secondary');
  const de = labPrimary && labSecondary ? deltaE76(labPrimary, labSecondary) : 0;
  if (labPrimary && labSecondary && de < 15.0) {
    add(
      'error',
      'LOW_LAYER_CONTRAST',
      `Primary vs secondary matter colour difference ΔE76 is ${de.toFixed(1)} (< 15.0); chunks will blend into monochrome mud.`,
      'Separate primary and secondary colours in lightness/hue (e.g. green canopy vs brown bark, light granite vs dark basalt).',
    );
  }
  return de;
}

function checkBeamAndBounce(
  preset: ParticlePresetSpec,
  issues: ReadonlyArray<ParticleValidationIssue>,
  add: (sev: ParticleIssueSeverity, code: ParticleIssueCode, message: string, fix?: string) => void,
): void {
  if (!preset.layers.some((l) => l.role !== 'accent' && l.bounce >= 0.15) && !issues.some((i) => i.code === 'NO_GROUND_BOUNCE')) {
    add(
      'warn',
      'NO_GROUND_BOUNCE',
      `Preset "${preset.id}" has no primary or secondary layer with bounce >= 0.15.`,
      'Enable bounce >= 0.25 on at least one physical chunk layer so debris rebounds on the terrain.',
    );
  }
  const b = preset.toolBeam;
  if (!Number.isFinite(b.beamRadius) || b.beamRadius <= 0 || b.sweepRadius < 0 || b.pulseFreq <= 0) {
    add(
      'error',
      'PHYSICS_INVALID',
      `Tool beam on "${preset.id}" has invalid beamRadius (${b.beamRadius}), sweepRadius (${b.sweepRadius}), or pulseFreq (${b.pulseFreq}).`,
      'Ensure toolBeam.beamRadius > 0, sweepRadius >= 0, and pulseFreq > 0.',
    );
  }
  if (b.emissiveIntensity < 3.0) {
    add(
      'error',
      'EMISSIVE_TOO_LOW',
      `Tool beam on "${preset.id}" has emissiveIntensity ${b.emissiveIntensity} (< 3.0).`,
      'Set toolBeam.emissiveIntensity >= 3.0.',
    );
  }
}

export function validateParticlePreset(preset: ParticlePresetSpec): ParticleValidationReport {
  const issues: ParticleValidationIssue[] = [];
  const add = (severity: ParticleIssueSeverity, code: ParticleIssueCode, message: string, fix?: string) => {
    issues.push({ severity, code, message, fix });
  };

  if (preset.layers.length < 3) {
    add(
      'error',
      'FEW_LAYERS',
      `Preset "${preset.id}" only has ${preset.layers.length} layer(s) (minimum 3 required; 5+ recommended).`,
      'Combine primary object chunks, secondary contrast/dust chunks, and HDR accent sparks.',
    );
  }

  const geoSet = new Set(preset.layers.map((l) => l.geometry));
  if (geoSet.size < 3) {
    add(
      'warn',
      'FLAT_GEOMETRY_VARIETY',
      `Preset "${preset.id}" only uses ${geoSet.size} distinct 3D geometry kind(s) (< 3).`,
      'Mix distinct 3D chunk geometries (e.g. leafCluster + barkSlab + woodSplinter + weldSpark).',
    );
  }

  let totalInstances = 0;
  let totalTriangles = 0;
  const roleCounts: Record<ParticleRole, number> = { primary: 0, secondary: 0, accent: 0 };

  for (const layer of preset.layers) {
    checkLayerPhysics(layer, add);
    const c = Math.max(0, layer.count);
    totalInstances += c;
    totalTriangles += c * getParticleGeometryTriCount(layer.geometry);
    roleCounts[layer.role] = (roleCounts[layer.role] ?? 0) + c;

    if (layer.role === 'accent' && (layer.emissiveIntensity ?? 0) < 3.0) {
      add(
        'error',
        'EMISSIVE_TOO_LOW',
        `Accent layer "${layer.name}" has emissiveIntensity ${layer.emissiveIntensity ?? 0} (< 3.0) and will not trigger selective HDR bloom.`,
        'Set emissiveIntensity >= 3.0 on accent layers.',
      );
    }
    if (layer.role !== 'accent' && (layer.emissiveIntensity ?? 0) >= 1.5) {
      add(
        'warn',
        'PRIMARY_EMISSIVE_BLOWOUT',
        `Non-accent layer "${layer.name}" (${layer.role}) has emissiveIntensity ${layer.emissiveIntensity}; physical debris should be lit by sun/shadows, not self-glowing.`,
      );
    }
  }

  checkBeamAndBounce(preset, issues, add);

  const denom = Math.max(1, totalInstances);
  const roleShares: Record<ParticleRole, number> = {
    primary: roleCounts.primary / denom,
    secondary: roleCounts.secondary / denom,
    accent: roleCounts.accent / denom,
  };
  const primarySecondaryDeltaE = checkRolesAndHierarchy(preset, roleShares, add);

  if (totalInstances > 180 || totalTriangles > 3500) {
    add(
      'error',
      'PARTICLE_BUDGET',
      `Preset "${preset.id}" uses ${totalInstances} instances / ${totalTriangles} tris (budget: <= 180 instances, <= 3,500 tris).`,
      'Reduce layer instance counts or use lighter 3D chunk geometries.',
    );
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warn').length;

  const pass = errors === 0;
  return {
    id: preset.id,
    label: preset.label,
    targetKind: preset.targetKind,
    layerCount: preset.layers.length,
    distinctGeometries: geoSet.size,
    totalInstances,
    totalTriangles,
    roleShares,
    primarySecondaryDeltaE,
    issues,
    errors,
    warnings,
    pass,
    passed: pass && warnings === 0,
  };
}

export function formatParticleReport(
  r: ParticleValidationReport,
  opts: { quiet?: boolean } = {},
): string {
  const status = r.pass && r.warnings === 0 ? 'PASS' : r.pass ? 'WARN' : 'FAIL';
  const roles = `${Math.round(r.roleShares.primary * 100)}/${Math.round(r.roleShares.secondary * 100)}/${Math.round(r.roleShares.accent * 100)}`;
  const head = `${status}  ${r.id.padEnd(14)} (${r.targetKind.padEnd(8)}) · ${r.layerCount} layers · ${r.distinctGeometries} geos · ${r.totalInstances} inst / ${r.totalTriangles} tris · 60/30/10=${roles} · ΔE76=${r.primarySecondaryDeltaE.toFixed(1)} · ${r.errors} err, ${r.warnings} warn`;
  if (opts.quiet || r.issues.length === 0) return head;
  const lines = [head];
  for (const iss of r.issues) {
    lines.push(`  [${iss.severity.toUpperCase()}] ${iss.code}: ${iss.message}`);
    if (iss.fix) lines.push(`    fix: ${iss.fix}`);
  }
  return lines.join('\n');
}
