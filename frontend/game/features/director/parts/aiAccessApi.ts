import { AiBudgetView } from '@terra/contracts';

export type AiAccessFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `GET /v1/near/staking/ai-access?colonyId=…[&planetId&colonyIndex]` -> the colony's `AiBudgetView` (the slot lets the
 * server find dev-scenario colonies whose row id differs from the sim id). `null` for a 404 (W28 off), any other
 * non-OK status, a network error or a malformed payload: the Director then renders exactly as it did before W28.
 */
export async function fetchAiAccess(
  colonyId: string,
  doFetch: AiAccessFetch = (i, init) => fetch(i, init),
  slot?: { readonly planetId?: string | null; readonly colonyIndex?: number | null },
): Promise<AiBudgetView | null> {
  const qs = new URLSearchParams({ colonyId });
  if (slot?.planetId) qs.set('planetId', slot.planetId);
  if (slot?.colonyIndex !== undefined && slot.colonyIndex !== null && slot.colonyIndex >= 0) qs.set('colonyIndex', String(slot.colonyIndex));
  try {
    const res = await doFetch(`/v1/near/staking/ai-access?${qs.toString()}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { aiBudget?: unknown } | null;
    const parsed = AiBudgetView.safeParse(body?.aiBudget);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
