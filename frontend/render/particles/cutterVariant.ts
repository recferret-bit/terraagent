import { ParticlePresetRegistry } from './ParticlePresetRegistry';
import { cyanCutterPresetId } from './presetsPrestige';
import type { InteractionTargetKind } from './types';

/**
 * The preset id a work site should use: the target kind's default, or its cyan cutter variant (Tier 2+ staking
 * cosmetic, W28-12). `undefined` means "let the registry resolve the target kind" (the unchanged default path).
 */
export function workPresetIdFor(targetKind: InteractionTargetKind, cyanCutters: boolean): string | undefined {
  if (!cyanCutters || targetKind === 'combat') return undefined;
  const variantId = cyanCutterPresetId(ParticlePresetRegistry.getByTargetKind(targetKind).id);
  return ParticlePresetRegistry.getWork(variantId) ? variantId : undefined;
}
