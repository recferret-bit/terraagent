// Templates for Section 06 (#economics): 4 Player Income Lanes
// and (via ./stakeCalculator) the 4-tier Staking & Fee Savings Calculator.
import { renderStakingCalculatorHtml } from './stakeCalculator';

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
