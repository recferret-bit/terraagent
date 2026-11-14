// Interactive controller & scroll-transition animator for Section 07 (#protocol):
// mounts the TerraAgent Protocol Treasury visual schematic, binds stream filters,
// drives scroll-linked conduit/stage transitions, and hydrates live /v1/near/protocol telemetry.
import { clamp, prefersReducedMotion } from '@terra/render/core/StageHost';
import {
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
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-proto-filter]')];
  if (!schematic || buttons.length === 0) return;

  host.dataset.activeStream = 'all';
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const stream = btn.dataset.protoFilter ?? 'all';
      schematic.dataset.activeStream = stream;
      host.dataset.activeStream = stream;
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
  stages.forEach((s, idx) => s.style.setProperty('--stage-delay', `${idx * 100}ms`));

  const update = (): void => {
    const rect = schematic.getBoundingClientRect();
    const vh = Math.max(innerHeight, 1);
    const progress = clamp((vh * 0.86 - rect.top) / Math.max(rect.height * 0.85, 1), 0, 1);
    setPhasedConduitVars(schematic, progress);

    const stageTrigger = vh * 0.86;
    for (const stage of stages) {
      if (stage.getBoundingClientRect().top < stageTrigger) {
        stage.classList.add('is-active');
      }
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

function hydrateTradeAndBonds(host: HTMLElement, sched: NonNullable<ProtocolTelemetryDto['feeSchedule']>): void {
  const stdBp = sched.standardPlatformFeeBp ?? 100;
  const stkBp = sched.stakerPlatformFeeBp ?? 50;
  const daoShareBp = sched.daoCarveOutShareBp ?? 2_000;
  const daoPct = Math.round(daoShareBp / 100);
  const protoPct = 100 - daoPct;
  const protoStdPct = ((sched.protocolNetStandardBp ?? Math.round((stdBp * protoPct) / 100)) / 100).toFixed(2);
  const protoStkPct = ((sched.protocolNetStakerBp ?? Math.round((stkBp * protoPct) / 100)) / 100).toFixed(2);
  const daoStdPct = ((stdBp - (sched.protocolNetStandardBp ?? 80)) / 100).toFixed(2);
  const daoStkPct = ((stkBp - (sched.protocolNetStakerBp ?? 40)) / 100).toFixed(2);

  setText(host, '[data-proto-trade-title]', `${protoPct}% of Platform Trade Fee`);
  setText(host, '[data-proto-trade-rate]', `${protoStdPct}% / ${protoStkPct}%`);
  setText(host, '[data-proto-dao-share-pct]', `${daoPct}%`);
  setText(host, '[data-proto-stage-trade-cap]', `BUYER FEE ALLOCATION (MAX ${((100 + stdBp) / 100).toFixed(2)}% / ${((100 + stkBp) / 100).toFixed(2)}% STAKER)`);
  setText(host, '[data-proto-legend-proto-label]', `■ TerraAgent Protocol (${protoPct}% of platform)`);
  setText(host, '[data-proto-legend-proto-val]', `${protoStdPct}% (${protoStkPct}% Staker)`);
  setText(host, '[data-proto-legend-dao-label]', `■ Planet Council DAO (${daoPct}% of platform)`);
  setText(host, '[data-proto-legend-dao-val]', `${daoStdPct}% (${daoStkPct}% Staker)`);
  setBarWidth(host, '[data-proto-bar-trade-proto]', Math.round(protoPct * 0.5));
  setBarWidth(host, '[data-proto-bar-trade-dao]', 50 - Math.round(protoPct * 0.5));

  if (sched.escrowSlashProtocolShareBp !== undefined) {
    const slashProtoPct = Math.round(sched.escrowSlashProtocolShareBp / 100);
    const slashVictimPct = 100 - slashProtoPct;
    setText(host, '[data-proto-filter-bonds]', `03 · ${slashVictimPct}/${slashProtoPct} BONDS`);
    setText(host, '[data-proto-slash-title]', `${slashProtoPct}% Bond Arbitration Slash`);
    setText(host, '[data-proto-slash-rate]', `${slashProtoPct}% of Breach`);
    setText(host, '[data-proto-stage-bonds-badge]', `${slashVictimPct} / ${slashProtoPct} SLASH`);
    setText(host, '[data-proto-legend-victim-val]', `${slashVictimPct}% Payout`);
    setText(host, '[data-proto-legend-slash-val]', `${slashProtoPct}% Slash Fee`);
    setBarWidth(host, '[data-proto-bar-bond-victim]', slashVictimPct);
    setBarWidth(host, '[data-proto-bar-bond-proto]', slashProtoPct);
  }
}

function hydrateStakingStage(host: HTMLElement, sched: NonNullable<ProtocolTelemetryDto['feeSchedule']>): void {
  const yieldProtoPct = Math.round((sched.protocolStakingYieldShareBp ?? 2_000) / 100);
  const yieldPilotPct = 100 - yieldProtoPct;
  const netApyPct = ((sched.stakerNetApyBp ?? 720) / 100).toFixed(2);
  const protoApyPct = ((sched.protocolStakingYieldBp ?? 180) / 100).toFixed(2);
  const minStake = sched.minStakeForPerksNear ?? '10';
  const stkFeePct = ((sched.stakerPlatformFeeBp ?? 50) / 100).toFixed(2);

  setText(host, '[data-proto-filter-staking]', `02 · ${yieldPilotPct}/${yieldProtoPct} STAKING`);
  setText(host, '[data-proto-yield-title]', `${yieldProtoPct}% of Validator Yield`);
  setText(host, '[data-proto-yield-rate]', `${protoApyPct}% APY Slice`);
  setText(host, '[data-proto-pilot-net-apy]', `${netApyPct}%`);
  setText(host, '[data-proto-min-stake]', `≥${minStake} NEAR`);
  setText(host, '[data-proto-ai-min-stake]', `≥${minStake} NEAR`);
  setText(host, '[data-proto-stage-staking-title]', `${yieldPilotPct} / ${yieldProtoPct} Yield Split · Zero Pay-to-Win`);
  setText(host, '[data-proto-stage-min-stake]', `≥${minStake} NEAR`);
  setText(host, '[data-proto-legend-pilot-label]', `■ Human Pilot Net Yield (${yieldPilotPct}%)`);
  setText(host, '[data-proto-legend-pilot-apy]', `${netApyPct}% Net APY`);
  setText(host, '[data-proto-legend-yield-label]', `■ Protocol AI + Gas Slice (${yieldProtoPct}%)`);
  setText(host, '[data-proto-legend-yield-apy]', `${protoApyPct}% APY`);
  setText(host, '[data-proto-legend-perks-label]', `★ Perks at ≥${minStake} NEAR`);
  setText(host, '[data-proto-legend-perks-val]', `Managed AI + ${stkFeePct}% Fee`);
  setBarWidth(host, '[data-proto-bar-stake-pilot]', yieldPilotPct);
  setBarWidth(host, '[data-proto-bar-stake-proto]', yieldProtoPct);
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
        <p class="eyebrow">07 · TERRAAGENT PROTOCOL</p>
        <h2 class="h1">Self-funding Web3 &amp; AI.<br><span class="sub-blue">Zero token printing. Zero Pay-to-Win.</span></h2>
      </div>
      <p><code>protocol.terraagent.*</code> is a first-class on-chain treasury account. It captures small, transparent slices from real trade velocity, validator staking yield, and slashed treaty/war bonds—and spends them directly on gasless <code>NEP-366</code> relays and Managed <code>NEAR.AI</code> Autopilot.</p>
    </div>
    ${renderProtocolToolbarHtml()}
    ${renderProtocolSchematicHtml()}
    ${renderProtocolStagesHtml()}`;

  const section = host.closest<HTMLElement>('#protocol') ?? host;
  bindStreamFilter(host);
  bindScrollTransitions(section, host);
  void hydrateProtocolTelemetry(host);
}
