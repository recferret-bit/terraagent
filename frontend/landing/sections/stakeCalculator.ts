// Staking & Fee Savings Calculator for #economics: 0–500+ NEAR slider with tier markers (W28 4-tier ladder), fee savings
// from the tier rows, and a dynamic primary CTA into /me.html#staking?amount=<X>. All numbers come from STAKING_*.
import { STAKING_RULES, STAKING_TIERS } from '@terra/contracts/staking/tiers';
import { clampStake, formatApy, netApyBpFrom, quoteStake, stakeCta, tierMarkers } from './stakeCalculatorMath';

const GROSS_BP = STAKING_RULES.simGrossApyBp;
const NET_BP = netApyBpFrom(GROSS_BP, STAKING_RULES.protocolYieldShareBp);
const UNBOND_NOTE = 'Principal stays yours';

const markersHtml = (): string => tierMarkers().map((m) =>
  `<span class="econ-tier-marker" style="left:${m.leftPct}%" data-tier="${m.id}"><i></i><em>T${m.id}<span> · ${m.minNear}</span></em></span>`).join('');

export function renderStakingCalculatorHtml(): string {
  const max = STAKING_RULES.calculatorMaxNear;
  const start = STAKING_RULES.defaultPreviewNear;
  const t1 = STAKING_TIERS[1]!;
  const cta0 = stakeCta(start);
  return `<div class="econ-calc plate" data-testid="landing-staking-calc">
    <div class="econ-calc-grid">
      <div class="econ-calc-controls">
        <div class="econ-proto-head">
          <div>
            <span class="eyebrow">4-TIER ORBITAL PATRONAGE · ZERO COMBAT BUFFS</span>
            <h3 class="h3" style="margin-top:4px">Staking &amp; Fee Savings Calculator</h3>
          </div>
          <span class="badge badge-ai" id="econ-apy-badge">${formatApy(NET_BP)} SIM APY</span>
        </div>
        <p class="econ-calc-lead">Stake NEAR from a claimed human wallet at any stage. Principal stays yours and never buffs unit damage or mining speed. Each tier cuts your trade fee from ${STAKING_TIERS[0]!.takerFeeBp} bp and adds Managed NEAR.AI colony slots.</p>
        <div class="econ-slider-row">
          <label for="econ-stake-slider"><span>STAKED PRINCIPAL (TIERS AT ${tierMarkers().map((m) => m.minNear).join(' / ')} NEAR)</span><output id="econ-stake-out">${start} NEAR</output></label>
          <input id="econ-stake-slider" type="range" min="0" max="${max}" step="1" value="${start}">
          <div class="econ-tier-markers" aria-hidden="true">${markersHtml()}</div>
        </div>
        <div class="econ-slider-row">
          <label for="econ-vol-slider"><span>MONTHLY BUY VOLUME ON /TRADE</span><output id="econ-vol-out">500 USDC</output></label>
          <input id="econ-vol-slider" type="range" min="0" max="5000" step="100" value="500">
        </div>
        <div class="econ-cta-bar">
          <a class="btn btn-primary btn-sm" id="econ-stake-cta" data-testid="landing-stake-cta" href="${cta0.href}">${cta0.label}</a>
          <a class="btn btn-ghost btn-sm" href="/trade.html">OPEN EXCHANGE</a>
          <a class="btn btn-ghost btn-sm" href="/whitepaper/">WHITEPAPER</a>
        </div>
      </div>

      <div class="econ-calc-results">
        <div id="econ-tier-banner" class="econ-tier-banner is-unlocked" role="status">TIER 2 · COMMANDER</div>
        <div class="econ-calc-out">
          <div class="econ-metric is-good"><span>YOUR NET VALIDATOR YIELD</span><strong id="econ-user-yield">0 NEAR / yr</strong></div>
          <div class="econ-metric is-blue"><span>GAS + AI YIELD SLICE</span><strong id="econ-proto-yield">0 NEAR / yr</strong></div>
          <div class="econ-metric is-good"><span>YOUR TRADE FEE SAVINGS</span><strong id="econ-fee-saved">0 USDC / mo</strong></div>
          <div class="econ-metric"><span>COLONY AUTOPILOT</span><strong id="econ-ai-mode">Managed AI Included</strong></div>
        </div>
        <p class="econ-calc-note" id="econ-fee-note"></p>
        <p class="econ-calc-note">Prefer your own model without staking? Connect an encrypted NEAR AI Cloud key anytime on <a href="/me.html">/me.html</a>. Tier ${t1.id} (${t1.minStakeNear} NEAR) applies at once; yield figures use the simulated ${formatApy(NET_BP)} net APY.</p>
      </div>
    </div>
  </div>`;
}

function feeText(feeBp: number, standardBp: number, warmupHours: number | null): string {
  const base = feeBp === standardBp ? `Taker fee ${feeBp} bp (standard).` : `Taker fee ${standardBp} → ${feeBp} bp.`;
  if (warmupHours === null) return base;
  return `${base} The cut applies after a ${warmupHours}h continuous-stake warmup (${STAKING_TIERS[1]!.takerFeeBp} bp until then).`;
}

export function bindStakeCalculator(root: HTMLElement): void {
  const q = <T extends HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
  const stakeIn = q<HTMLInputElement>('#econ-stake-slider');
  const volIn = q<HTMLInputElement>('#econ-vol-slider');
  const els = {
    stakeOut: q('#econ-stake-out'), volOut: q('#econ-vol-out'), banner: q('#econ-tier-banner'), userYield: q('#econ-user-yield'),
    protoYield: q('#econ-proto-yield'), feeSaved: q('#econ-fee-saved'), aiMode: q('#econ-ai-mode'), feeNote: q('#econ-fee-note'),
    cta: q<HTMLAnchorElement>('#econ-stake-cta'),
  };
  if (!stakeIn || !volIn || Object.values(els).some((e) => !e)) return;
  const e = els as { [K in keyof typeof els]: NonNullable<(typeof els)[K]> };

  const update = (): void => {
    const stake = clampStake(Number(stakeIn.value));
    const vol = Number(volIn.value);
    const quote = quoteStake(stake, vol, NET_BP, GROSS_BP);
    const cta = stakeCta(stake);
    const next = quote.nextTier;

    e.stakeOut.textContent = stake >= STAKING_RULES.calculatorMaxNear ? `${stake}+ NEAR` : `${stake} NEAR`;
    e.volOut.textContent = `${vol.toLocaleString('en-US')} USDC`;
    e.userYield.textContent = `${quote.netYieldNear.toFixed(2)} NEAR / yr`;
    e.protoYield.textContent = `${quote.protocolYieldNear.toFixed(2)} NEAR / yr`;
    e.feeSaved.textContent = `${quote.feeSavedUsdc.toFixed(2)} USDC / mo (${quote.feeBp} bp fee)`;
    e.aiMode.textContent = quote.tier.id >= 1 ? `Managed AI · ${quote.tier.aiColonySlots} colony slot${quote.tier.aiColonySlots === 1 ? '' : 's'}` : '5 Free TEE Turns → Rule / BYOK';
    e.feeNote.textContent = feeText(quote.feeBp, quote.standardFeeBp, quote.warmupHours);
    e.banner.className = `econ-tier-banner ${quote.tier.id >= 1 ? 'is-unlocked' : ''}`;
    e.banner.textContent = quote.tier.id >= 1
      ? `TIER ${quote.tier.id} · ${quote.tier.name.toUpperCase()} · ${UNBOND_NOTE}${next ? ` · ${next.minStakeNear - stake} NEAR to Tier ${next.id}` : ''}`
      : `CADET (<${next!.minStakeNear} NEAR) · Stake ${next!.minStakeNear - stake} more NEAR to unlock Tier ${next!.id}`;
    e.cta.textContent = cta.label;
    e.cta.href = cta.href;
    stakeIn.style.setProperty('--econ-fill', `${(stake / STAKING_RULES.calculatorMaxNear) * 100}%`);
  };

  stakeIn.addEventListener('input', update);
  volIn.addEventListener('input', update);
  update();
}
