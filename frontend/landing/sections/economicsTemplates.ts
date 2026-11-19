// Templates for Section 06 (#economics): 4 Player Income Lanes
// and the unified 2-column Day-1 Lossless Staking & Fee Calculator.

export function renderIncomeLanesHtml(): string {
  return `<div class="econ-grid-4">
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">01 · EXPORTS</span><span class="badge badge-ok">100% TO SELLER</span></div>
      <h3 class="h3">Sell Refined Cargo</h3>
      <p>Refine metals, minerals, water, and biomass across MK.I–MK.III buildings. Ship surplus to orbit and sell to players or visiting Guild freighters.</p>
      <div class="econ-lane-foot">Supply mints on export · burns on import</div>
    </article>
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">02 · TRADE HUBS</span><span class="badge badge-recruiting">0–1.0% STALL</span></div>
      <h3 class="h3">Own a Market Stall</h3>
      <p>Every Trade Hub you build runs its own orderbook stall. Set a 0.00%–1.00% maker fee and collect USDC, NEAR, or cargo royalties on local fills.</p>
      <div class="econ-lane-foot">Paid automatically on each match</div>
    </article>
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">03 · TRADING BOTS</span><span class="badge badge-ai">CAPPED KEY</span></div>
      <h3 class="h3">Automate Spreads 24/7</h3>
      <p>Create scoped bot keys on <a href="/trade.html">/trade.html</a> with daily spend limits, price-band checks, and a one-click kill switch—isolated from your wallet.</p>
      <div class="econ-lane-foot">Revokable anytime from /trade.html</div>
    </article>
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">04 · DIPLOMACY</span><span class="badge badge-tier">ESCROW</span></div>
      <h3 class="h3">Get Paid to Defend</h3>
      <p>Claim raid-defense bounties, back peace treaties with real stakes, or hold out against a 6-hour siege to claim a stalled attacker's forfeited bond.</p>
      <div class="econ-lane-foot">Kept treaties refund in full</div>
    </article>
  </div>`;
}

export function renderStakingCalculatorHtml(): string {
  return `<div class="econ-calc plate" data-testid="landing-staking-calc">
    <div class="econ-calc-grid">
      <div class="econ-calc-controls">
        <div class="econ-proto-head">
          <div>
            <span class="eyebrow">DAY-1 LOSSLESS STAKING · ZERO COMBAT BUFFS</span>
            <h3 class="h3" style="margin-top:4px">Staking &amp; Fee Savings Calculator</h3>
          </div>
          <span class="badge badge-ai">9.0% POOL APY</span>
        </div>
        <p class="econ-calc-lead">Stake NEAR from a claimed human wallet at any stage. Your principal stays yours (2-day unbond) and never buffs unit damage or mining speed—a small slice of validator yield covers Managed NEAR.AI and cuts your trade fee in half.</p>
        <div class="econ-slider-row">
          <label for="econ-stake-slider"><span>STAKED PRINCIPAL (PERKS UNLOCK AT 10 NEAR)</span><output id="econ-stake-out">25 NEAR</output></label>
          <input id="econ-stake-slider" type="range" min="0" max="250" step="5" value="25">
        </div>
        <div class="econ-slider-row">
          <label for="econ-vol-slider"><span>MONTHLY BUY VOLUME ON /TRADE</span><output id="econ-vol-out">500 USDC</output></label>
          <input id="econ-vol-slider" type="range" min="0" max="5000" step="100" value="500">
        </div>
        <div class="econ-cta-bar">
          <a class="btn btn-primary btn-sm" href="/trade.html">OPEN EXCHANGE</a>
          <a class="btn btn-ghost btn-sm" href="/me.html">PILOT / BYOK</a>
          <a class="btn btn-ghost btn-sm" href="/whitepaper/">WHITEPAPER</a>
        </div>
      </div>

      <div class="econ-calc-results">
        <div id="econ-tier-banner" class="econ-tier-banner is-unlocked" role="status">STAKER TIER UNLOCKED (≥10 NEAR) · Principal stays yours · 2-day unbond</div>
        <div class="econ-calc-out">
          <div class="econ-metric is-good"><span>YOUR NET VALIDATOR YIELD</span><strong id="econ-user-yield">1.80 NEAR / yr</strong></div>
          <div class="econ-metric is-blue"><span>GAS + AI YIELD SLICE</span><strong id="econ-proto-yield">0.45 NEAR / yr</strong></div>
          <div class="econ-metric is-good"><span>YOUR TRADE FEE SAVINGS</span><strong id="econ-fee-saved">2.50 USDC / mo</strong></div>
          <div class="econ-metric"><span>COLONY AUTOPILOT</span><strong id="econ-ai-mode">Managed AI Included</strong></div>
        </div>
        <p class="econ-calc-note">Prefer your own model without staking? Connect an encrypted NEAR AI Cloud key anytime on <a href="/me.html">/me.html</a>.</p>
      </div>
    </div>
  </div>`;
}

export function renderEconomicsBoardHtml(): string {
  return `<div class="sec-head">
      <div>
        <p class="eyebrow">06 · PLAYER MARKET &amp; STAKING</p>
        <h2 class="h1">Trade what you mine.<br><span class="sub-blue">Stake without pay-to-win.</span></h2>
      </div>
      <p>No reward token printing. Every USDC or NEAR payout comes from real buyer orders, Trade Hub stall fees, validator staking yield, or forfeited treaty bonds.</p>
    </div>
    ${renderIncomeLanesHtml()}
    ${renderStakingCalculatorHtml()}`;
}
