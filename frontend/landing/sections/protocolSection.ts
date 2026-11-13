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
  readonly protocolAccount?: string;
  readonly feeSchedule?: {
    readonly standardPlatformFeeBp?: number;
    readonly stakerPlatformFeeBp?: number;
    readonly protocolShareBp?: number;
    readonly stakerMinNear?: number;
    readonly diplomacySlashProtocolBp?: number;
  };
}

function bindStreamFilter(host: HTMLElement): void {
  const schematic = host.querySelector<HTMLElement>('#protocol-schematic');
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-proto-filter]')];
  if (!schematic || buttons.length === 0) return;

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const stream = btn.dataset.protoFilter ?? 'all';
      schematic.dataset.activeStream = stream;
      for (const b of buttons) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
    });
  }
}

function bindScrollTransitions(section: HTMLElement, host: HTMLElement): void {
  const schematic = host.querySelector<HTMLElement>('#protocol-schematic');
  const stages = [...host.querySelectorAll<HTMLElement>('[data-proto-stage]')];
  if (!schematic) return;

  if (prefersReducedMotion()) {
    schematic.style.setProperty('--proto-p', '1');
    stages.forEach((s) => s.classList.add('is-active'));
    return;
  }

  section.classList.add('js-proto');
  stages.forEach((s, idx) => s.style.setProperty('--stage-delay', `${idx * 100}ms`));

  const update = (): void => {
    const rect = schematic.getBoundingClientRect();
    const progress = clamp((innerHeight * 0.82 - rect.top) / Math.max(rect.height * 0.85, 1), 0, 1);
    schematic.style.setProperty('--proto-p', progress.toFixed(3));

    const stageTrigger = innerHeight * 0.84;
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
  update();
}

async function hydrateProtocolTelemetry(host: HTMLElement): Promise<void> {
  try {
    const res = await fetch('/v1/near/protocol', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const body = (await res.json()) as ProtocolTelemetryDto;
    const acctEl = host.querySelector<HTMLElement>('[data-protocol-account]');
    if (acctEl && body.protocolAccount) acctEl.textContent = body.protocolAccount;

    const sched = body.feeSchedule;
    if (!sched) return;
    const tradeEl = host.querySelector<HTMLElement>('[data-proto-trade-rate]');
    if (
      tradeEl &&
      sched.standardPlatformFeeBp !== undefined &&
      sched.stakerPlatformFeeBp !== undefined &&
      sched.protocolShareBp !== undefined
    ) {
      const stdPct = ((sched.standardPlatformFeeBp * sched.protocolShareBp) / 1_000_000).toFixed(2);
      const stkPct = ((sched.stakerPlatformFeeBp * sched.protocolShareBp) / 1_000_000).toFixed(2);
      tradeEl.textContent = `${stdPct}% / ${stkPct}%`;
    }
    const slashEl = host.querySelector<HTMLElement>('[data-proto-slash-rate]');
    if (slashEl && sched.diplomacySlashProtocolBp !== undefined) {
      slashEl.textContent = `${(sched.diplomacySlashProtocolBp / 100).toFixed(0)}% of Breach`;
    }
    const minStakeEl = host.querySelector<HTMLElement>('[data-proto-min-stake]');
    if (minStakeEl && sched.stakerMinNear !== undefined) {
      minStakeEl.textContent = `≥${sched.stakerMinNear} NEAR`;
    }
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
