import type { AiDownshiftReason } from '@terra/contracts';
import type { LlmFailureKind } from '../../ports/llm-provider.port.js';

/** The Director downshift reason shown for a provider failure (`/v1/near/staking/ai-access`, decision feed). */
export function downshiftForFailure(kind: LlmFailureKind): AiDownshiftReason {
  if (kind === 'unfunded') return 'provider_unfunded';
  if (kind === 'unauthorized') return 'provider_unauthorized';
  return 'provider_unavailable';
}

/** One plain sentence for the player (no key, no provider body). `byok` = the player's own key failed. */
export function providerNotice(kind: LlmFailureKind, byok: boolean): string {
  if (byok && kind === 'unfunded') return 'Your NEAR.AI key has no balance. Your colonies run on the rule-based autopilot until you top it up.';
  if (byok && kind === 'unauthorized') return 'Your NEAR.AI key was rejected. Your colonies run on the rule-based autopilot until you save a valid key.';
  return 'The AI provider is unavailable right now. Your colonies run on the rule-based autopilot meanwhile.';
}
