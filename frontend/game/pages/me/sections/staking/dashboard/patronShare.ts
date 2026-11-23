// Share text + links of the Orbital Patron Card. Only self-fill-excluded numbers are ever shared (effective APY and the
// staked total come from the server's wash-trade-proof performance payload).
import { patronagePlanetName, type StakingPerformanceResponse } from '@terra/contracts';
import { buildNearSocialSetTx } from '../../../../../features/deed/deedShare';
import { formatNear, formatPct } from '../stakingMath';
import { totalStakedNear } from './dashboardMath';

export interface PatronShareFacts {
  readonly tierName: string;
  readonly totalStakedNear: number;
  readonly effectiveApyBp: number;
  readonly leadPlanets: readonly string[];
}

export function patronFacts(perf: StakingPerformanceResponse): PatronShareFacts {
  return {
    tierName: perf.perks.tierName,
    totalStakedNear: totalStakedNear(perf.balances),
    effectiveApyBp: perf.effectiveApyBp,
    leadPlanets: perf.perks.leadPatronPlanetIds,
  };
}

export function patronShareText(f: PatronShareFacts): string {
  const planets = f.leadPlanets.length > 0 ? ` · Lead Patron of ${f.leadPlanets.map(patronagePlanetName).join(', ')}` : '';
  return `${f.tierName} on TerraAgent: ${formatNear(f.totalStakedNear)} staked at ${formatPct(f.effectiveApyBp)} effective APY (self-fills excluded)${planets} #NEAR`;
}

export const patronShareUrl = (origin: string): string => `${origin.replace(/\/+$/, '')}/me.html#staking`;

export function patronTwitterIntentUrl(f: PatronShareFacts, origin: string): string {
  const params = new URLSearchParams({ text: patronShareText(f), url: patronShareUrl(origin) });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function patronNearSocialTx(f: PatronShareFacts, origin: string, accountId: string, network: 'testnet' | 'mainnet') {
  return buildNearSocialSetTx(`${patronShareText(f)}\n${patronShareUrl(origin)}`, accountId, network);
}
