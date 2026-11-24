import { MANAGED_AI_MODEL } from '@terra/contracts';
import { providerNotice } from '../ai/provider/fallback-reason.js';
import {
  isTeeAttestationRejected,
  llmFailureOf,
  type LlmAttestation,
  type LlmFailureKind,
  type LlmProviderPort,
  type LlmResponse,
} from '../ports/llm-provider.port.js';

/** Result of the `/me` TEE enclave check. */
export interface EnclaveCheck {
  readonly ok: boolean;
  readonly model: string;
  readonly managedStaker: boolean;
  readonly usedPlayerKey: boolean;
  readonly attestation: LlmAttestation | null;
  /** Set when the provider refused the probe (`unfunded`, `unauthorized`, …): `message` tells the player. */
  readonly providerFailure?: LlmFailureKind;
  readonly message?: string;
}

/**
 * One tiny completion that asks the provider for an attestation. A provider refusal (no balance, bad key, …) is an
 * answer for the player, not a server error.
 */
export async function probeEnclave(
  llm: LlmProviderPort | undefined,
  env: Record<string, string | undefined>,
  p: { readonly model: string; readonly apiKey?: string; readonly hasKey: boolean; readonly stakerActive: boolean },
): Promise<EnclaveCheck> {
  const { model, hasKey } = p;
  if (!llm) return { ok: false, model, managedStaker: p.stakerActive, usedPlayerKey: hasKey, attestation: null };
  const managedStaker = !hasKey && p.stakerActive;
  let res: LlmResponse;
  try {
    res = await llm.complete({
      system: 'Reply strictly with JSON {"ok":true} for a TEE attestation probe.',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 24,
      temperature: 0,
      json: true,
      model,
      ...(hasKey && p.apiKey ? { apiKey: p.apiKey } : {}),
    });
  } catch (err) {
    const failure = llmFailureOf(err);
    if (!failure) throw err;
    const base = { ok: false, model, managedStaker, usedPlayerKey: hasKey, attestation: null };
    return { ...base, providerFailure: failure.kind, message: providerNotice(failure.kind, hasKey) };
  }
  const ok = res.attestation
    ? Boolean(res.attestation.verified) && !isTeeAttestationRejected(res.attestation)
    : env.AI_PROVIDER !== 'nearai';
  return { ok, model: hasKey ? res.model : MANAGED_AI_MODEL, managedStaker, usedPlayerKey: hasKey, attestation: res.attestation ?? null };
}
