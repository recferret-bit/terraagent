import { AiBudgetView } from '@terra/contracts';

export type AiAccessFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `GET /v1/near/staking/ai-access?colonyId=…` -> the colony's `AiBudgetView`. `null` for a 404 (W28 off), any other
 * non-OK status, a network error or a malformed payload: the Director then renders exactly as it did before W28.
 */
export async function fetchAiAccess(colonyId: string, doFetch: AiAccessFetch = (i, init) => fetch(i, init)): Promise<AiBudgetView | null> {
  try {
    const res = await doFetch(`/v1/near/staking/ai-access?colonyId=${encodeURIComponent(colonyId)}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { aiBudget?: unknown } | null;
    const parsed = AiBudgetView.safeParse(body?.aiBudget);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
