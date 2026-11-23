import type { StakingTierKey, StakingTierRow } from '@terra/contracts/staking/tiers';
import { stakingTierFor } from '@terra/contracts/staking/tiers';
import { el } from '../../../dom';
import { createBlockHelpTip } from '../../../parts/helpTip';
import { formatPct } from '../stakingMath';

/** Cosmetic copy only (NEAR_STAKING_SPEC §3 "3D Diorama & Skybox Prestige"); no balance numbers live here. */
export const PRESTIGE_COPY: Readonly<Record<StakingTierKey, string>> = {
  cadet: 'Standard Colony Hull',
  scout: 'Cyan Orbital Uplink Beam + Quantum Dish',
  commander: 'Plasma Drop-Pod Trail + Faction Livery',
  archon: 'Gold-Anodized Command Hub + Rocket Plume',
  patron: 'Named Flagship Orbital Carrier',
};

export const ORBITAL_PATRONAGE_DESCRIPTION =
  'Compares all 5 staking tiers. Perks unlock lower market taker fees, managed NEAR.AI TEE colony slots, higher gasless relayer caps, and cosmetic 3D prestige — never sim combat or harvest advantages (Zero Pay-to-Win).';

const HEADERS = ['Tier', 'Min stake', 'Taker fee', 'AI colony slots', 'Gas cap', 'Prestige'] as const;

export function formatWarmupDuration(feeWarmupMs: number): string {
  if (feeWarmupMs >= 3_600_000) return `${Math.round(feeWarmupMs / 3_600_000)}h`;
  if (feeWarmupMs >= 60_000) return `${Math.round(feeWarmupMs / 60_000)}m`;
  return `${Math.max(1, Math.round(feeWarmupMs / 1000))}s`;
}

export function feeCell(tier: StakingTierRow, warmupLabel: string | number): string {
  const fee = formatPct(tier.takerFeeBp);
  const label = typeof warmupLabel === 'number' ? `${warmupLabel}h` : warmupLabel;
  return tier.warmupRequired ? `${fee} · after ${label} warmup` : fee;
}

function tierRow(tier: StakingTierRow, reached: boolean, warmupLabel: string, rowTestIdPrefix: string): HTMLElement {
  const cells = [
    el('th', { className: 'ta-stk-tier-name', aria: { label: `Tier ${tier.id} ${tier.name}` } }, `T${tier.id} · ${tier.name}`),
    el('td', null, `${tier.minStakeNear} NEAR`),
    el('td', null, feeCell(tier, warmupLabel)),
    el('td', null, tier.aiColonySlots === 0 ? 'Script AI' : `${tier.aiColonySlots} slot${tier.aiColonySlots === 1 ? '' : 's'}`),
    el('td', null, `${tier.gasMultiplier}x`),
    el('td', { className: 'ta-stk-prestige' }, PRESTIGE_COPY[tier.key]),
  ];
  return el(
    'tr',
    {
      className: reached ? 'ta-stk-row is-reached' : 'ta-stk-row',
      dataset: { testid: `${rowTestIdPrefix}${tier.id}`, tier: tier.id, reached: reached ? '1' : '0' },
    },
    ...cells,
  );
}

export interface TierMatrixIds {
  readonly matrixTestId?: string;
  readonly rowTestIdPrefix?: string;
}

/** Builds the complete 5-tier Orbital Patronage comparison table (100% of matrix content for hover popups). */
export function buildTierMatrixContent(
  tiers: readonly StakingTierRow[],
  amount: number,
  feeWarmupMs: number,
  ids: TierMatrixIds = {},
): HTMLElement {
  const reachedId = stakingTierFor(amount).id;
  const warmupLabel = formatWarmupDuration(feeWarmupMs);
  const rowPrefix = ids.rowTestIdPrefix ?? 'staking-tier-row-';
  const head = el('thead', null, el('tr', null, ...HEADERS.map((h) => el('th', null, h))));
  const body = el('tbody', null, ...tiers.map((t) => tierRow(t, t.id === reachedId, warmupLabel, rowPrefix)));
  return el(
    'div',
    {
      className: 'ta-stk-scroll ta-stk-patronage-table-wrap',
      dataset: { testid: ids.matrixTestId ?? 'staking-tier-matrix', reachedTier: reachedId },
    },
    el('table', { className: 'ta-stk-table', aria: { label: 'Orbital Patronage tiers' } }, head, body),
  );
}

export interface PatronageHoverTriggerOptions {
  readonly id: string;
  readonly labelText: string;
  readonly tiers: readonly StakingTierRow[];
  readonly amount: number;
  readonly feeWarmupMs: number;
  readonly buttonTestId?: string;
  readonly matrixTestId?: string;
  readonly rowTestIdPrefix?: string;
}

/** Hover + click trigger pill displaying `[?] <labelText>` with 100% Orbital Patronage tiers in a top-layer popup. */
export function createPatronageHoverTrigger(opts: PatronageHoverTriggerOptions): HTMLElement {
  const matrixEl = buildTierMatrixContent(opts.tiers, opts.amount, opts.feeWarmupMs, {
    matrixTestId: opts.matrixTestId,
    rowTestIdPrefix: opts.rowTestIdPrefix,
  });
  const pill = el('div', { className: 'ta-stk-patronage-pill' });
  const tip = createBlockHelpTip({
    id: opts.id,
    title: 'ORBITAL PATRONAGE TIERS',
    description: ORBITAL_PATRONAGE_DESCRIPTION,
    body: matrixEl,
    openOnHover: true,
    floating: true,
    wide: true,
    hoverTrigger: pill,
    buttonTestId: opts.buttonTestId,
    buttonTitle: 'Hover or click to inspect all Orbital Patronage Tiers',
  });
  pill.append(tip.button, el('span', { className: 'ta-stk-patronage-label' }, opts.labelText));
  return el('span', { className: 'ta-stk-patronage-wrap' }, pill, tip.panel);
}
