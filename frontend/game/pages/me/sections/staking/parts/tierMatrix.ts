import type { StakingTierKey, StakingTierRow } from '@terra/contracts/staking/tiers';
import { stakingTierFor } from '@terra/contracts/staking/tiers';
import { el } from '../../../dom';
import { formatPct } from '../stakingMath';

/** Cosmetic copy only (NEAR_STAKING_SPEC §3 "3D Diorama & Skybox Prestige"); no balance numbers live here. */
export const PRESTIGE_COPY: Readonly<Record<StakingTierKey, string>> = {
  cadet: 'Standard Colony Hull',
  scout: 'Cyan Orbital Uplink Beam + Quantum Dish',
  commander: 'Plasma Drop-Pod Trail + Faction Livery',
  archon: 'Gold-Anodized Command Hub + Rocket Plume',
  patron: 'Named Flagship Orbital Carrier',
};

const HEADERS = ['Tier', 'Min stake', 'Taker fee', 'AI colony slots', 'Gas cap', 'Prestige'] as const;

export function feeCell(tier: StakingTierRow, warmupHours: number): string {
  const fee = formatPct(tier.takerFeeBp);
  return tier.warmupRequired ? `${fee} · after ${warmupHours}h warmup` : fee;
}

function tierRow(tier: StakingTierRow, reached: boolean, warmupHours: number): HTMLElement {
  const cells = [
    el('th', { className: 'ta-stk-tier-name', aria: { label: `Tier ${tier.id} ${tier.name}` } }, `T${tier.id} · ${tier.name}`),
    el('td', null, `${tier.minStakeNear} NEAR`),
    el('td', null, feeCell(tier, warmupHours)),
    el('td', null, tier.aiColonySlots === 0 ? 'Script AI' : `${tier.aiColonySlots} slot${tier.aiColonySlots === 1 ? '' : 's'}`),
    el('td', null, `${tier.gasMultiplier}x`),
    el('td', { className: 'ta-stk-prestige' }, PRESTIGE_COPY[tier.key]),
  ];
  return el(
    'tr',
    {
      className: reached ? 'ta-stk-row is-reached' : 'ta-stk-row',
      dataset: { testid: `staking-tier-row-${tier.id}`, tier: tier.id, reached: reached ? '1' : '0' },
    },
    ...cells,
  );
}

/** The 4-Tier Orbital Patronage matrix (+ Cadet baseline). The tier the amount reaches is highlighted. */
export function renderTierMatrix(tiers: readonly StakingTierRow[], amount: number, feeWarmupMs: number): HTMLElement {
  const reachedId = stakingTierFor(amount).id;
  const warmupHours = Math.round(feeWarmupMs / 3_600_000);
  const head = el('thead', null, el('tr', null, ...HEADERS.map((h) => el('th', null, h))));
  const body = el('tbody', null, ...tiers.map((t) => tierRow(t, t.id === reachedId, warmupHours)));
  return el(
    'div',
    { className: 'ta-stk-block', dataset: { testid: 'staking-tier-matrix', reachedTier: reachedId } },
    el('h3', { className: 'label ta-stk-h' }, 'ORBITAL PATRONAGE TIERS'),
    el(
      'div',
      { className: 'ta-stk-scroll' },
      el('table', { className: 'ta-stk-table', aria: { label: 'Orbital Patronage tiers' } }, head, body),
    ),
  );
}
