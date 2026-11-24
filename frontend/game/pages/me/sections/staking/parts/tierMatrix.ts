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
  'Compares all 5 staking tiers. Active stake (unbonding excluded) unlocks lower market taker fees (T1 instant; T2–T4 after 24h warmup — crossing <50 → ≥50 NEAR starts a fresh 24h clock), 1 / 3 / 6 / 12 concurrent GLM 5.3 Flash colony slots across planets or distinct sectors, 2x–15x gasless caps, Guild radar, 1.5x DAO votes, and cosmetic 3D prestige. Trade Hub stall cap stays 0–1.00% for all tiers — Zero Pay-to-Win.';

const HEADERS = ['Tier', 'Min stake', 'Taker fee', 'Colonies & AI slots', 'Gas · Perks', 'Prestige'] as const;

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

function tierPerksCell(tier: StakingTierRow): string {
  const parts = [`${tier.gasMultiplier}x gas`, `${tier.botKeys} bot${tier.botKeys === 1 ? '' : 's'}`];
  parts.push(tier.aiColonySlots > 0 ? `${tier.sweepSeconds}s sweep` : 'Script AI after trial');
  if (tier.guildRadarLeadMs > 0) parts.push(`${Math.round(tier.guildRadarLeadMs / 60_000)}m radar`);
  if (tier.daoVoteWeightBp > 10_000) parts.push(`${(tier.daoVoteWeightBp / 10_000).toFixed(1)}x DAO`);
  if (tier.patronEligible) parts.push('Lead Patron (15% Protocol cut)');
  return parts.join(' · ');
}

function tierRow(tier: StakingTierRow, reached: boolean, warmupLabel: string, rowTestIdPrefix: string): HTMLElement {
  const cells = [
    el('th', { className: 'ta-stk-tier-name', aria: { label: `Tier ${tier.id} ${tier.name}` } }, `T${tier.id} · ${tier.name}`),
    el('td', null, `${tier.minStakeNear} NEAR`),
    el('td', null, feeCell(tier, warmupLabel)),
    el('td', null, tier.aiColonySlots === 0 ? '1 colony · 5 free TEE turns' : `${tier.aiColonySlots} colon${tier.aiColonySlots === 1 ? 'y' : 'ies'} · GLM 5.3 Flash`),
    el('td', null, tierPerksCell(tier)),
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
  const rulesFoot = el(
    'p',
    { className: 'ta-stk-sub', style: { margin: '8px 10px' } },
    'Rules: 80% net validator APY · 0% compound fee preserves maturity/warmup clocks · <7d early exit pays 0.25% (0% after 7d) · ~2d unbonding principal excluded from tiers · Daily AI budget = 35% of protocol yield + non-self trade fees (≥65% margin).',
  );
  return el(
    'div',
    {
      className: 'ta-stk-patronage-table-wrap',
      dataset: { testid: ids.matrixTestId ?? 'staking-tier-matrix', reachedTier: reachedId },
    },
    el(
      'div',
      { className: 'ta-stk-scroll' },
      el('table', { className: 'ta-stk-table', aria: { label: 'Orbital Patronage tiers' } }, head, body),
    ),
    rulesFoot,
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
