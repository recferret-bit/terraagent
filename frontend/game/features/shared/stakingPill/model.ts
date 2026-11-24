// Pure model + fetchers of the W28 stake pill (`/play.html` HUD, `/trade.html` header) and the trade fee pill.
// Every number comes from the endpoints or the W28 data table (`STAKING_TIERS`); nothing is hardcoded here (D-35).
import { ApyView, STAKING_TIERS, StakerPerksResponse, type EvaluatedStakerPerksV2 } from '@terra/contracts';
import { fallbackOverview, formatPct } from '../../../pages/me/sections/staking/stakingMath';

export const STAKING_HREF = '/me.html#staking';

export type PillFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PillQuery {
  readonly accountId?: string | null;
  readonly colonyId?: string | null;
  /** Optional bearer; the perks route is public but a token keeps the call attributable. */
  readonly token?: string;
}

/** `off` = the W28 wave is off (404); `error` = transport / malformed payload; `none` = no wallet or colony to ask about. */
export type PerksResult =
  | { readonly status: 'ok'; readonly data: StakerPerksResponse }
  | { readonly status: 'off' | 'error' | 'none' };

export async function fetchPerks(doFetch: PillFetch, q: PillQuery): Promise<PerksResult> {
  const qs = new URLSearchParams();
  const account = q.accountId?.trim();
  const colony = q.colonyId?.trim();
  if (account) qs.set('accountId', account);
  else if (colony) qs.set('colonyId', colony);
  else if (!q.token) return { status: 'none' };
  // token only: the server resolves the Bearer pilot's linked wallet (`GET /v1/near/staking/perks`)
  try {
    const res = await doFetch(`/v1/near/staking/perks${qs.size > 0 ? `?${qs.toString()}` : ''}`, {
      headers: { accept: 'application/json', ...(q.token ? { authorization: `Bearer ${q.token}` } : {}) },
    });
    if (res.status === 404) return { status: 'off' };
    if (!res.ok) return { status: 'error' };
    const parsed = StakerPerksResponse.safeParse(await res.json());
    return parsed.success ? { status: 'ok', data: parsed.data } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Net APY from `GET /v1/near/staking/overview`; the simulated table APY (badged `Sim`) when it is missing. */
export async function fetchApy(doFetch: PillFetch): Promise<ApyView> {
  try {
    const res = await doFetch('/v1/near/staking/overview', { headers: { accept: 'application/json' } });
    if (res.ok) {
      const parsed = ApyView.safeParse(((await res.json()) as { apy?: unknown } | null)?.apy);
      if (parsed.success) return parsed.data;
    }
  } catch { /* fall through to the local simulated APY */ }
  return fallbackOverview(0).apy;
}

export interface PillView {
  readonly tier: number;
  readonly label: string;
  readonly apyText: string;
  readonly sim: boolean;
  readonly title: string;
}

/** Tier 0 = `⚡ STAKE · 7.20% APY` CTA; Tier 1..4 = `⚡ TIER N · 7.20% APY`. */
export function pillView(perks: EvaluatedStakerPerksV2 | null, apy: ApyView): PillView {
  const tier = perks?.tier ?? 0;
  const apyText = `${formatPct(apy.netApyBp)} APY`;
  const label = tier === 0 ? '⚡ STAKE' : `⚡ TIER ${tier}`;
  const name = perks?.tierName ?? STAKING_TIERS[0]!.name;
  const title = tier === 0
    ? `Stake NEAR (${STAKING_TIERS[1]!.minStakeNear}–${STAKING_TIERS[4]!.minStakeNear}+ NEAR): 80% net validator APY, 0.65%→0.25% market fees & 1–12 Managed NEAR.AI slots`
    : `${name} · ${apyText}${apy.source === 'sim' ? ' (simulated)' : ''} · open the staking dashboard`;
  return { tier, label, apyText, sim: apy.source === 'sim', title };
}

/** `3h 12m`, `45m`, `<1m` (never negative). */
export function formatCountdown(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  if (mins < 1) return '<1m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export interface FeePillView {
  readonly text: string;
  readonly warmup: boolean;
  readonly title: string;
}

/** Active taker fee (`perks.platformFeeBp`), with the warmup countdown to the tier's full fee while it is pending. */
export function feePillView(perks: EvaluatedStakerPerksV2, nowMs: number): FeePillView {
  const fee = (bp: number): string => formatPct(bp);
  const ladder = STAKING_TIERS.slice(1).map((t) => fee(t.takerFeeBp)).join(' / ');
  const title = `Taker fee ladder (Tier 1..${STAKING_TIERS.length - 1}): ${ladder} (T1 instant; T2–T4 after 24h warmup)`;
  const readyAt = perks.feeWarmupReadyAtMs;
  if (readyAt !== null && readyAt > nowMs) {
    const target = STAKING_TIERS[perks.tier]?.takerFeeBp ?? perks.platformFeeBp;
    return { text: `FEE ${fee(perks.platformFeeBp)} → ${fee(target)} in ${formatCountdown(readyAt - nowMs)}`, warmup: true, title };
  }
  return { text: `FEE ${fee(perks.platformFeeBp)}`, warmup: false, title };
}
