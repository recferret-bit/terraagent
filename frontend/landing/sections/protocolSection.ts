// Interactive controller & scroll-transition animator for Section 07 (#protocol):
// mounts the TerraAgent Protocol Treasury visual schematic, binds stream filters,
// drives scroll-linked conduit/stage transitions, and hydrates live /v1/near/protocol telemetry.
import { clamp, prefersReducedMotion } from '@terra/render/core/StageHost';
import {
  renderProtocolReceiptsHtml,
  renderProtocolSchematicHtml,
  renderProtocolStagesHtml,
  renderProtocolToolbarHtml,
} from './protocolTemplates';

interface ProtocolTelemetryDto {
  readonly protocolAccountId?: string;
  readonly relayerAccountId?: string;
  readonly feeSchedule?: {
    readonly standardPlatformFeeBp?: number;
    readonly stakerPlatformFeeBp?: number;
    readonly daoCarveOutShareBp?: number;
    readonly protocolNetStandardBp?: number;
    readonly protocolNetStakerBp?: number;
    readonly validatorGrossApyBp?: number;
    readonly stakerNetApyBp?: number;
    readonly protocolStakingYieldBp?: number;
    readonly protocolStakingYieldShareBp?: number;
    readonly minStakeForPerksNear?: string | number;
    readonly escrowSlashProtocolShareBp?: number;
  };
}

let detachScrollListeners: (() => void) | null = null;

function bindStreamFilter(host: HTMLElement): void {
  const schematic = host.querySelector<HTMLElement>('#protocol-schematic');
  const proofs = host.querySelector<HTMLDetailsElement>('[data-proto-proofs]');
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-proto-filter]')];
  if (!schematic || buttons.length === 0) return;

  host.dataset.activeStream = 'all';
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const stream = btn.dataset.protoFilter ?? 'all';
      schematic.dataset.activeStream = stream;
      host.dataset.activeStream = stream;
      if (proofs && stream !== 'all') proofs.open = true;
      for (const b of buttons) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
    });
  }
}

function setPhasedConduitVars(schematic: HTMLElement, progress: number): void {
  const inP = clamp(progress / 0.55, 0, 1);
  const coreP = clamp((progress - 0.25) / 0.5, 0, 1);
  const outP = clamp((progress - 0.45) / 0.55, 0, 1);
  schematic.style.setProperty('--proto-p', progress.toFixed(3));
  schematic.style.setProperty('--in-p', inP.toFixed(3));
  schematic.style.setProperty('--core-p', coreP.toFixed(3));
  schematic.style.setProperty('--out-p', outP.toFixed(3));
}

function bindScrollTransitions(section: HTMLElement, host: HTMLElement): void {
  detachScrollListeners?.();
  detachScrollListeners = null;

  const schematic = host.querySelector<HTMLElement>('#protocol-schematic');
  const stages = [...host.querySelectorAll<HTMLElement>('[data-proto-stage]')];
  if (!schematic) return;

  if (prefersReducedMotion()) {
    setPhasedConduitVars(schematic, 1);
    stages.forEach((s) => s.classList.add('is-active'));
    return;
  }

  section.classList.add('js-proto');
  stages.forEach((s, idx) => s.style.setProperty('--stage-delay', `${idx * 45}ms`));

  const update = (): void => {
    const rect = schematic.getBoundingClientRect();
    const vh = Math.max(innerHeight, 1);
    const progress = clamp((vh * 0.92 - rect.top) / Math.max(rect.height * 0.8, 1), 0, 1);
    setPhasedConduitVars(schematic, progress);

    const stageTrigger = vh * 0.98;
    const anyVisible = stages.some((stage) => stage.getBoundingClientRect().top < stageTrigger);
    if (anyVisible) {
      for (const stage of stages) stage.classList.add('is-active');
    }
  };

  let queued = false;
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  detachScrollListeners = () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
  };
  update();
}

function setText(host: HTMLElement, selector: string, text: string): void {
  const el = host.querySelector<HTMLElement>(selector);
  if (el) el.textContent = text;
}

function setBarWidth(host: HTMLElement, selector: string, pct: number): void {
  const el = host.querySelector<HTMLElement>(selector);
  if (el) el.style.width = `${pct}%`;
}

function setAttr(host: HTMLElement, selector: string, attr: string, value: string): void {
  const el = host.querySelector<HTMLElement>(selector);
  if (el) el.setAttribute(attr, value);
}

function formatSponsoredTxs(rawTxs: number): string {
  if (rawTxs <= 0) return '0';
  const rounded =
    rawTxs >= 250
      ? Math.round(rawTxs / 50) * 50
      : rawTxs >= 20
        ? Math.round(rawTxs / 10) * 10
        : Math.max(1, Math.round(rawTxs));
  return `~${rounded.toLocaleString('en-US')}`;
}

function hydrateTradeAndBonds(host: HTMLElement, sched: NonNullable<ProtocolTelemetryDto['feeSchedule']>): void {
  const stdBp = Math.max(0, sched.standardPlatformFeeBp ?? 100);
  const stkBp = Math.max(0, sched.stakerPlatformFeeBp ?? Math.floor(stdBp / 2));
  const daoShareBp = sched.daoCarveOutShareBp ?? 2_000;
  const protoShareBp = 10_000 - daoShareBp;
  const daoPct = Math.round(daoShareBp / 100);
  const protoPct = 100 - daoPct;
  const protoStdBp = sched.protocolNetStandardBp ?? Math.floor((stdBp * protoShareBp) / 10_000);
  const protoStkBp = sched.protocolNetStakerBp ?? Math.floor((stkBp * protoShareBp) / 10_000);
  const protoStdPct = (protoStdBp / 100).toFixed(2);
  const protoStkPct = (protoStkBp / 100).toFixed(2);
  const daoStdPct = ((stdBp - protoStdBp) / 100).toFixed(2);
  const daoStkPct = ((stkBp - protoStkBp) / 100).toFixed(2);
  const maxBuyerBp = 100 + stdBp;
  const stallBarPct = Math.round((100 / maxBuyerBp) * 100);
  const remBarPct = 100 - stallBarPct;
  const protoBarPct = stdBp > 0 ? Math.round((remBarPct * protoStdBp) / stdBp) : 0;
  const daoBarPct = remBarPct - protoBarPct;

  setText(host, '[data-proto-svg-fees]', `FEES ${protoPct}%`);
  setText(host, '[data-proto-trade-title]', `${protoPct}% of Platform Trade Fee`);
  setText(host, '[data-proto-trade-rate]', `${protoStdPct}% / ${protoStkPct}%`);
  setText(host, '[data-proto-dao-share-pct]', `${daoPct}%`);
  setText(host, '[data-proto-stage-trade-cap]', `BUYER FEE ALLOCATION (MAX ${(maxBuyerBp / 100).toFixed(2)}% / ${((100 + stkBp) / 100).toFixed(2)}% STAKER)`);
  setText(host, '[data-proto-legend-proto-label]', `■ Protocol Share (${protoPct}%)`);
  setText(host, '[data-proto-legend-proto-val]', `${protoStdPct}% (${protoStkPct}% Staker)`);
  setText(host, '[data-proto-legend-dao-label]', `■ Planet Council (${daoPct}%)`);
  setText(host, '[data-proto-legend-dao-val]', `${daoStdPct}% (${daoStkPct}% Staker)`);
  setText(host, '[data-proto-ex-buyer-total]', `Buyer pays $${(100.5 + stdBp / 100).toFixed(2)} ($${(100.5 + stkBp / 100).toFixed(2)} Staker)`);
  setText(host, '[data-proto-ex-dao]', `+$${daoStdPct} ($${daoStkPct} Stk)`);
  setText(host, '[data-proto-ex-trade]', `+$${protoStdPct} ($${protoStkPct} Stk)`);
  setText(host, '[data-proto-ex-trade-txs]', `${formatSponsoredTxs(protoStdBp / 0.12)} gasless NEP-366 player txs`);
  setBarWidth(host, '[data-proto-bar-trade-stall]', stallBarPct);
  setBarWidth(host, '[data-proto-bar-trade-proto]', protoBarPct);
  setBarWidth(host, '[data-proto-bar-trade-dao]', daoBarPct);
  setAttr(host, '[data-proto-bar-trade]', 'aria-label', `Up to ${stallBarPct}% Stall Owner, ${protoBarPct}% Protocol, ${daoBarPct}% Planet Council DAO`);

  if (sched.escrowSlashProtocolShareBp !== undefined) {
    const slashProtoPct = Math.round(sched.escrowSlashProtocolShareBp / 100);
    const slashVictimPct = 100 - slashProtoPct;
    setText(host, '[data-proto-svg-slash]', `SLASH ${slashProtoPct}%`);
    setText(host, '[data-proto-filter-bonds]', `03 · ${slashVictimPct}/${slashProtoPct} BONDS`);
    setText(host, '[data-proto-slash-title]', `${slashProtoPct}% Bond Arbitration Slash`);
    setText(host, '[data-proto-slash-rate]', `${slashProtoPct}% of Breach`);
    setText(host, '[data-proto-stage-bonds-badge]', `${slashVictimPct} / ${slashProtoPct} SLASH`);
    setText(host, '[data-proto-legend-victim-val]', `${slashVictimPct}% Payout`);
    setText(host, '[data-proto-legend-slash-val]', `${slashProtoPct}% Slash Fee`);
    setText(host, '[data-proto-ex-victim]', `${((20 * slashVictimPct) / 100).toFixed(2)} NEAR (${slashVictimPct}%)`);
    setText(host, '[data-proto-ex-slash]', `${((20 * slashProtoPct) / 100).toFixed(2)} NEAR (${slashProtoPct}%)`);
    setBarWidth(host, '[data-proto-bar-bond-victim]', slashVictimPct);
    setBarWidth(host, '[data-proto-bar-bond-proto]', slashProtoPct);
    setAttr(host, '[data-proto-bar-bond]', 'aria-label', `${slashVictimPct}% to Betrayed Ally or Defender, ${slashProtoPct}% to Protocol`);
  }
}

function hydrateStakingStage(host: HTMLElement, sched: NonNullable<ProtocolTelemetryDto['feeSchedule']>): void {
  const yieldShareBp = sched.protocolStakingYieldShareBp ?? 2_000;
  const yieldProtoPct = Math.round(yieldShareBp / 100);
  const yieldPilotPct = 100 - yieldProtoPct;
  const grossApyBp = sched.validatorGrossApyBp ?? 900;
  const grossApyPct = (grossApyBp / 100).toFixed(1);
  const protoApyBp = sched.protocolStakingYieldBp ?? Math.floor((grossApyBp * yieldShareBp) / 10_000);
  const netApyBp = sched.stakerNetApyBp ?? (grossApyBp - protoApyBp);
  const netApyPct = (netApyBp / 100).toFixed(2);
  const protoApyPct = (protoApyBp / 100).toFixed(2);
  const minStake = sched.minStakeForPerksNear ?? '10';
  const stkFeeBp = sched.stakerPlatformFeeBp ?? Math.floor((sched.standardPlatformFeeBp ?? 100) / 2);
  const stkFeePct = (stkFeeBp / 100).toFixed(2);
  const protoStakeYr = (50 * protoApyBp) / 10_000;
  const stakeTxsLabel = formatSponsoredTxs(protoStakeYr / 0.0003);

  setText(host, '[data-proto-svg-yield]', `YIELD ${yieldProtoPct}%`);
  setText(host, '[data-proto-filter-staking]', `02 · ${yieldPilotPct}/${yieldProtoPct} STAKING`);
  setText(host, '[data-proto-yield-title]', `${yieldProtoPct}% of Validator Yield`);
  setText(host, '[data-proto-yield-rate]', `${protoApyPct}% APY Slice`);
  setText(host, '[data-proto-pilot-net-apy]', `${netApyPct}%`);
  setText(host, '[data-proto-min-stake]', `≥${minStake} NEAR`);
  setText(host, '[data-proto-ai-min-stake]', `≥${minStake} NEAR`);
  setText(host, '[data-proto-stage-staking-title]', `${yieldPilotPct} / ${yieldProtoPct} Yield Split · Zero Pay-to-Win`);
  setText(host, '[data-proto-stage-pool-apy]', `${grossApyPct}% VALIDATOR POOL YIELD SPLIT`);
  setText(host, '[data-proto-stage-min-stake]', `≥${minStake} NEAR`);
  setText(host, '[data-proto-legend-pilot-label]', `■ Pilot Net Yield (${yieldPilotPct}%)`);
  setText(host, '[data-proto-legend-pilot-apy]', `${netApyPct}% Net APY`);
  setText(host, '[data-proto-legend-yield-label]', `■ Protocol Slice (${yieldProtoPct}%)`);
  setText(host, '[data-proto-legend-yield-apy]', `${protoApyPct}% APY`);
  setText(host, '[data-proto-legend-perks-label]', `★ Perks at ≥${minStake} NEAR`);
  setText(host, '[data-proto-legend-perks-val]', `Managed AI + ${stkFeePct}% Fee`);
  setText(host, '[data-proto-ex-pilot-yield]', `+${((50 * netApyBp) / 10_000).toFixed(2)} NEAR / yr`);
  setText(host, '[data-proto-ex-proto-yield]', `+${protoStakeYr.toFixed(2)} NEAR / yr`);
  setText(host, '[data-proto-ex-perks]', `Managed AI + ${stkFeePct}% Fee`);
  setText(
    host,
    '[data-proto-ex-stake-foot]',
    `+${protoStakeYr.toFixed(2)} NEAR/yr sponsors ${stakeTxsLabel} meta-txs with zero principal risk.`,
  );
  setBarWidth(host, '[data-proto-bar-stake-pilot]', yieldPilotPct);
  setBarWidth(host, '[data-proto-bar-stake-proto]', yieldProtoPct);
  setAttr(host, '[data-proto-bar-stake]', 'aria-label', `${yieldPilotPct}% Net APY to Pilot, ${yieldProtoPct}% APY to Protocol`);
}

async function hydrateProtocolTelemetry(host: HTMLElement): Promise<void> {
  try {
    const res = await fetch('/v1/near/protocol', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const body = (await res.json()) as ProtocolTelemetryDto;
    if (body.protocolAccountId) setText(host, '[data-protocol-account]', body.protocolAccountId);
    if (body.relayerAccountId) setText(host, '[data-relayer-account]', body.relayerAccountId);
    if (!body.feeSchedule) return;
    hydrateTradeAndBonds(host, body.feeSchedule);
    hydrateStakingStage(host, body.feeSchedule);
  } catch {
    // Static / offline preview keeps Testnet defaults.
  }
}

export function initProtocolSection(): void {
  const host = document.getElementById('protocol-board');
  if (!host) return;

  host.innerHTML = `<div class="sec-head">
      <div>
        <p class="eyebrow">07 · PROTOCOL TREASURY</p>
        <h2 class="h1">Self-funded servers,<br><span class="sub-blue">gas, and offline AI.</span></h2>
      </div>
      <p><code>protocol.terraagent.*</code> is an open treasury on NEAR. Small slices from trades, validator yield, and broken-treaty bonds pay directly for player gas and offline colony AI.</p>
    </div>
    ${renderProtocolToolbarHtml()}
    ${renderProtocolSchematicHtml()}
    ${renderProtocolStagesHtml()}
    ${renderProtocolReceiptsHtml()}`;

  const section = host.closest<HTMLElement>('#protocol') ?? host;
  bindStreamFilter(host);
  bindScrollTransitions(section, host);
  void hydrateProtocolTelemetry(host);
}
