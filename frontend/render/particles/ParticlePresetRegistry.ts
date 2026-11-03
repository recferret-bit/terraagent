import { BUILTIN_PARTICLE_PRESETS } from './presets';
import type { InteractionTargetKind, ParticlePresetSpec } from './types';

export interface ResolveTargetKindParams {
  terrainKey?: string | null;
  biomeKey?: string | null;
  depositKind?: string | null;
  mode?: string | null;
}

class ParticlePresetRegistryImpl {
  private readonly byId = new Map<string, ParticlePresetSpec>();
  private readonly byTarget = new Map<InteractionTargetKind, ParticlePresetSpec>();

  constructor() {
    for (const preset of BUILTIN_PARTICLE_PRESETS) {
      this.register(preset);
    }
  }

  register(preset: ParticlePresetSpec): void {
    this.byId.set(preset.id, preset);
    this.byTarget.set(preset.targetKind, preset);
  }

  get(id: string): ParticlePresetSpec | undefined {
    return this.byId.get(id);
  }

  getByTargetKind(targetKind: InteractionTargetKind): ParticlePresetSpec {
    return this.byTarget.get(targetKind) ?? this.byId.get('work.flat')!;
  }

  list(): ParticlePresetSpec[] {
    return Array.from(this.byId.values());
  }

  resolveTargetKind(params: ResolveTargetKindParams): InteractionTargetKind {
    const mode = (params.mode ?? '').toLowerCase();
    const deposit = (params.depositKind ?? '').toLowerCase();
    const terrain = (params.terrainKey ?? '').toLowerCase();
    const biome = (params.biomeKey ?? '').toLowerCase();
    const isDuneBiome = biome === 'dune' || biome === 'desert';

    // `dismantle` (W02 terraform op) takes a building apart: the same cutting / welding sparks as repair.
    if (mode === 'repair' || mode === 'construct' || mode === 'constructing' || mode === 'build' || mode === 'dismantle') {
      return 'repair';
    }
    if (deposit === 'metals' || deposit === 'metal') return 'metals';
    if (deposit === 'minerals' || deposit === 'mineral' || deposit === 'crystal') return 'minerals';
    if (deposit === 'oil') return 'oil';

    if (terrain === 'forest' || mode === 'clear' || terrain === 'tree' || terrain === 'clear') {
      return isDuneBiome ? 'rock' : 'tree';
    }
    if (terrain === 'rock' || mode === 'break' || terrain === 'break') {
      return 'rock';
    }
    if (terrain === 'slope' || terrain === 'dune' || mode === 'flatten' || terrain === 'flatten') {
      return 'dune';
    }
    if (terrain === 'hole' || mode === 'fill' || terrain === 'fill') {
      return 'hole';
    }
    if (isDuneBiome) {
      return 'dune';
    }
    return 'flat';
  }
}

export const ParticlePresetRegistry = new ParticlePresetRegistryImpl();
