// Top-nav CTA pill `⚡ STAKE · LIVE APY` -> /me.html#staking. Shows the live net APY from `GET /v1/near/staking/overview`
// (W28-05); on 404 / network error / malformed payload it shows the simulated APY from the data table.
import { fallbackApy, parseOverviewApy, pillBadge, type PillApy } from './stakeCalculatorMath';

export const STAKE_PILL_HREF = '/me.html#staking';

export function renderStakePill(apy: PillApy): string {
  return `<a class="stake-pill" data-testid="landing-stake-pill" href="${STAKE_PILL_HREF}" aria-label="Stake NEAR, ${pillBadge(apy)}">
    <span class="stake-pill-bolt" aria-hidden="true">⚡</span><span class="stake-pill-label">STAKE · LIVE APY</span>
    <b class="stake-pill-badge" data-source="${apy.source}">${pillBadge(apy)}</b></a>`;
}

export async function fetchPillApy(fetchFn: typeof fetch = fetch): Promise<PillApy> {
  try {
    const res = await fetchFn('/v1/near/staking/overview', { headers: { accept: 'application/json' } });
    if (!res.ok) return fallbackApy();
    return parseOverviewApy(await res.json());
  } catch {
    return fallbackApy();
  }
}

/** Mounts the pill (fallback APY immediately, live APY when the endpoint answers). */
export function initStakeNavPill(host: HTMLElement | null = document.querySelector<HTMLElement>('.header-right'), fetchFn: typeof fetch = fetch): Promise<void> {
  if (!host) return Promise.resolve();
  host.insertAdjacentHTML('afterbegin', renderStakePill(fallbackApy()));
  return fetchPillApy(fetchFn).then((apy) => {
    const pill = host.querySelector<HTMLElement>('.stake-pill');
    if (pill) pill.outerHTML = renderStakePill(apy);
  });
}
