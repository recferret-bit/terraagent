// Staking & Fee Savings Calculator for #economics: 0–500+ NEAR slider with tier markers (W28 4-tier ladder), fee savings
// from the tier rows, and a dynamic primary CTA into /me.html#staking?amount=<X>. All numbers come from STAKING_*.
import { STAKING_RULES, STAKING_TIERS, type StakingTierRow } from '@terra/contracts/staking/tiers';
import { clampStake, fallbackApyDetails, formatApy, netApyBpFrom, parseOverviewApyDetails, quoteStake, stakeCta, tierMarkers } from './stakeCalculatorMath';

const GROSS_BP = STAKING_RULES.simGrossApyBp;
const NET_BP = netApyBpFrom(GROSS_BP, STAKING_RULES.protocolYieldShareBp);
const UNBOND_NOTE = 'Principal stays yours';

const markersHtml = (): string => tierMarkers().map((m) =>
  `<span class="econ-tier-marker" style="left:${m.leftPct}%" data-tier="${m.id}"><i></i><em>T${m.id}<span> · ${m.minNear}</span></em></span>`).join('');

function tierPerksHtml(tier: StakingTierRow): string {
  const pills: string[] = [
    `<b>${tier.gasMultiplier}×</b> gasless relay`,
    `<b>${tier.botKeys}</b> bot key${tier.botKeys === 1 ? '' : 's'}`,
    tier.id >= 1 ? `<b>${tier.sweepSeconds}s</b> AI sweep` : `<b>${STAKING_RULES.freeTrialTurns}</b> free TEE turns`,
  ];
  if (tier.guildRadarLeadMs > 0) pills.push(`<b>${Math.round(tier.guildRadarLeadMs / 60_000)}m</b> Guild radar`);
  if (tier.daoVoteWeightBp > 10_000) pills.push(`<b>${(tier.daoVoteWeightBp / 10_000).toFixed(1)}×</b> DAO votes`);
  if (tier.patronEligible) pills.push('<b>15%</b> Protocol cut · Lead Patron');
  return pills.map((p) => `<span class="econ-perk-pill">${p}</span>`).join('');
}

function renderStakingRulesHtml(): string {
  const exitPct = (STAKING_RULES.earlyExitFeeBp / 100).toFixed(2);
  const protoPct = Math.round(STAKING_RULES.protocolYieldShareBp / 100);
  const pilotPct = 100 - protoPct;
  const patronPct = Math.round(STAKING_RULES.patronProtocolFeeShareBp / 100);
  const aiSharePct = Math.round(STAKING_RULES.aiBudgetCostShareBp / 100);
  const marginPct = 100 - aiSharePct;
  return `<div class="econ-rules-grid" data-testid="landing-staking-rules">
    <article class="econ-rule-card plate-sm">
      <span class="econ-rule-kicker">01 · 4 PROFIT &amp; VALUE SOURCES</span>
      <p><b>${pilotPct}% net validator APY</b> (${formatApy(NET_BP)} Sim / live on Mainnet) · <b>Taker fee savings</b> (1.00% → 0.65% / 0.50% / 0.35% / 0.25%) · <b>Trade Hub stall royalties</b> (0–1.00%, equal for all tiers) · <b>Tier 4 Lead Patron</b> earns <b>${patronPct}% of Protocol's fee cut</b> (12% of gross on standard 20% DAO fills) + orbital flagship on canonical worlds. Self-fills excluded.</p>
    </article>
    <article class="econ-rule-card plate-sm">
      <span class="econ-rule-kicker">02 · WARMUP, COMPOUND &amp; EXIT RULES</span>
      <p><b>Tier 1 (10 NEAR · 0.65%)</b> applies instantly. <b>Tiers 2–4 (50 / 200 / 500+ NEAR)</b> unlock after a <b>24h</b> continuous-stake warmup (crossing &lt;50 → ≥50 NEAR starts a fresh 24h clock; top-ups ≥50 NEAR keep it). <b>0% compound fee</b> preserves clocks. Unstaking <b>&lt;7d</b> pays <b>${exitPct}%</b> (0% after 7d); <b>4-epoch (~2d)</b> unbonding principal is excluded from tiers.</p>
    </article>
    <article class="econ-rule-card plate-sm">
      <span class="econ-rule-kicker">03 · AI BUDGET &amp; ZERO PAY-TO-WIN</span>
      <p><b>${protoPct}%</b> of validator yield funds gasless relays and Managed <b>GLM 5.3 Flash</b> AI. Daily AI budget = <b>${aiSharePct}%</b> of (daily protocol yield + non-self protocol trade fees) for a <b>≥${marginPct}%</b> protocol margin. Verified pilots get <b>${STAKING_RULES.freeTrialTurns} free TEE turns</b>; BYOK keys on <a href="/me.html">/me.html</a> stay uncapped. Zero combat or mining buffs.</p>
    </article>
  </div>`;
}

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
        <p class="econ-calc-lead">Stake NEAR, stNEAR, or LiNEAR from any connected human wallet — even before founding a colony. Principal stays yours and never buffs unit damage or mining speed. Each tier cuts your trade fee from ${STAKING_TIERS[0]!.takerFeeBp} bp and unlocks Managed NEAR.AI (GLM 5.3 Flash) plus up to 3 / 6 / 12 concurrent colonies across planets or distinct sectors.</p>
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
          <a class="btn btn-ghost btn-sm" href="/whitepaper/#sub-econ-tiers">STAKING RULES &amp; WHITEPAPER</a>
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
        <div class="econ-perk-strip" id="econ-tier-perks" data-testid="landing-tier-perks">${tierPerksHtml(STAKING_TIERS[2]!)}</div>
        <p class="econ-calc-note" id="econ-fee-note"></p>
        <p class="econ-calc-note" id="econ-apy-note">Managed Staker AI runs exclusively on GLM 5.3 Flash. Want Claude, GPT-5, DeepSeek, or custom models? Enter a valid encrypted NEAR AI Cloud API key on <a href="/me.html">/me.html</a> to unlock the model dropdown. Tier ${t1.id} (${t1.minStakeNear} NEAR) applies at once; yield figures use the simulated ${formatApy(NET_BP)} net APY.</p>
      </div>
    </div>
    ${renderStakingRulesHtml()}
  </div>`;
}

function feeText(feeBp: number, standardBp: number, warmupHours: number | null): string {
  const base = feeBp === standardBp ? `Taker fee ${feeBp} bp (standard).` : `Taker fee ${standardBp} → ${feeBp} bp.`;
  if (warmupHours === null) return base;
  return `${base} The cut applies after a ${warmupHours}h continuous-stake warmup (${STAKING_TIERS[1]!.takerFeeBp} bp until then).`;
}

export function bindStakeCalculator(root: HTMLElement, fetchFn?: typeof fetch): void {
  const q = <T extends HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
  const stakeIn = q<HTMLInputElement>('#econ-stake-slider');
  const volIn = q<HTMLInputElement>('#econ-vol-slider');
  const apyBadge = q<HTMLElement>('#econ-apy-badge');
  const apyNote = q<HTMLElement>('#econ-apy-note');
  const tierPerks = q<HTMLElement>('#econ-tier-perks');
  const els = {
    stakeOut: q('#econ-stake-out'), volOut: q('#econ-vol-out'), banner: q('#econ-tier-banner'), userYield: q('#econ-user-yield'),
    protoYield: q('#econ-proto-yield'), feeSaved: q('#econ-fee-saved'), aiMode: q('#econ-ai-mode'), feeNote: q('#econ-fee-note'),
    cta: q<HTMLAnchorElement>('#econ-stake-cta'),
  };
  if (!stakeIn || !volIn || Object.values(els).some((e) => !e)) return;
  const e = els as { [K in keyof typeof els]: NonNullable<(typeof els)[K]> };
  let apy = fallbackApyDetails();

  const update = (): void => {
    const stake = clampStake(Number(stakeIn.value));
    const vol = Number(volIn.value);
    const quote = quoteStake(stake, vol, apy.netApyBp, apy.grossApyBp);
    const cta = stakeCta(stake);
    const next = quote.nextTier;

    e.stakeOut.textContent = stake >= STAKING_RULES.calculatorMaxNear ? `${stake}+ NEAR` : `${stake} NEAR`;
    e.volOut.textContent = `${vol.toLocaleString('en-US')} USDC`;
    e.userYield.textContent = `${quote.netYieldNear.toFixed(2)} NEAR / yr`;
    e.protoYield.textContent = `${quote.protocolYieldNear.toFixed(2)} NEAR / yr`;
    e.feeSaved.textContent = `${quote.feeSavedUsdc.toFixed(2)} USDC / mo (${quote.feeBp} bp fee)`;
    e.aiMode.textContent = quote.tier.id >= 1 ? `GLM 5.3 Flash · ${quote.tier.aiColonySlots} colon${quote.tier.aiColonySlots === 1 ? 'y' : 'ies'}` : '1 Colony · 5 Free TEE Turns';
    if (tierPerks) tierPerks.innerHTML = tierPerksHtml(quote.tier);
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

  const fn = fetchFn ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  if (!fn) return;
  void fn('/v1/near/staking/overview', { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return;
      apy = parseOverviewApyDetails(await res.json());
      if (apyBadge) {
        apyBadge.textContent = `${formatApy(apy.netApyBp)} ${apy.source === 'live' ? 'LIVE APY' : 'SIM APY'}`;
        apyBadge.dataset.source = apy.source;
      }
      if (apyNote) {
        const entryTier = STAKING_TIERS[1]!;
        const mode = apy.source === 'live' ? 'live' : 'simulated';
        apyNote.innerHTML = `Managed Staker AI runs exclusively on GLM 5.3 Flash. Want Claude, GPT-5, DeepSeek, or custom models? Enter a valid encrypted NEAR AI Cloud API key on <a href="/me.html">/me.html</a> to unlock the model dropdown. Tier ${entryTier.id} (${entryTier.minStakeNear} NEAR) applies at once; yield figures use the ${mode} ${formatApy(apy.netApyBp)} net APY.`;
      }
      update();
    })
    .catch(() => undefined);
}
