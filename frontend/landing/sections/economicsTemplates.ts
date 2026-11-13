// Templates for Section 06 (#economics): 4 Player Income Lanes, TerraAgent Protocol Treasury,
// Day-1 Lossless Staking Calculator, Peace/War Escrow Slashing, and Why NEAR (5 Pillars).

export function renderIncomeLanesHtml(): string {
  return `<div class="econ-grid-4">
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">LANE 01 · PRODUCTION</span><span class="badge badge-ok">NEP-245</span></div>
      <h3 class="h3">Export Cargo for USDC &amp; NEAR</h3>
      <p>Mine biome-abundant T1–T3 metals, crystals, water, and bio-fuel. Export surplus at your Trade Hub to mint NEP-245 orbital cargo and sell to scarce colonies or Orbital Guild ships.</p>
      <div class="econ-lane-foot">100% of sale principal → Seller wallet</div>
    </article>
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">LANE 02 · MARKET MAKER</span><span class="badge badge-recruiting">0–1.0% FEE</span></div>
      <h3 class="h3">Own a Trade Hub Stall</h3>
      <p>Every Trade Hub is a player-owned exchange stall. Set your maker stall fee from 0.00% to 1.00% and collect passive quote-token royalties on every fill against your resting orders.</p>
      <div class="econ-lane-foot">Paid atomically in USDC / NEAR / Cargo</div>
    </article>
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">LANE 03 · ALGO BOTS</span><span class="badge badge-ai">API + TEE</span></div>
      <h3 class="h3">Run Scoped Trading Agents</h3>
      <p>Issue capped <code>ta_bot_...</code> API keys on <code>/trade.html</code> or enable NEAR.AI Autopilot to arbitrage planet VWAP spreads 24/7 under strict ACID daily spend limits and one-click kill switches.</p>
      <div class="econ-lane-foot">Human-revokable · Zero wallet drain risk</div>
    </article>
    <article class="econ-lane-card plate-sm">
      <div class="econ-lane-top"><span class="econ-lane-num">LANE 04 · ESCROW PAYOUTS</span><span class="badge badge-tier">90% SLASH</span></div>
      <h3 class="h3">Bounties, Peace &amp; War Bonds</h3>
      <p>Claim mercenary defense bounties, sign Bonded Peace Treaties, or repel a 6h War Bond siege. Oathbreakers and failed attackers forfeit 90% of their locked escrow directly to you.</p>
      <div class="econ-lane-foot">Settled on bounty.terraagent.testnet</div>
    </article>
  </div>`;
}

export function renderSimulatorSplitHtml(): string {
  return `<div class="econ-split">
    <div class="econ-proto plate">
      <div class="econ-proto-head">
        <div>
          <span class="eyebrow">JUDGE &amp; PILOT SUMMARY</span>
          <h3 class="h3" style="margin-top:4px">Who Earns What — Zero Inflation</h3>
        </div>
        <span class="badge badge-ok">ZERO P2W</span>
      </div>
      <p style="margin:0;color:var(--ta-text-3);font-size:14.5px">Every dollar or NEAR earned by a player comes from real counterparty demand, market-making spreads, validator yield, or slashed opponent bonds—never printed tokens:</p>
      <div class="econ-flow-group">
        <span class="econ-flow-title is-in">◆ HUMAN PILOTS &amp; SCOPED BOTS</span>
        <div class="econ-flow-item"><div><b>Resource Exporters &amp; Makers</b><div style="font-size:12.5px;color:var(--ta-text-3)">100% of cargo sale principal + 0.00%–1.00% Trade Hub stall fee</div></div><span>USDC / NEAR</span></div>
        <div class="econ-flow-item"><div><b>Day-1 Stakers (≥10 NEAR)</b><div style="font-size:12.5px;color:var(--ta-text-3)">80% of validator yield + Managed NEAR.AI + 50% lower trade fee</div></div><span>7.20% Net APY</span></div>
        <div class="econ-flow-item"><div><b>Peace Allies &amp; War Defenders</b><div style="font-size:12.5px;color:var(--ta-text-3)">Receive 90% of breached truce or failed 6h siege escrow bonds</div></div><span>90% Slash Payout</span></div>
        <div class="econ-flow-item is-out"><div><b>Planet Council Sputnik DAO</b><div style="font-size:12.5px;color:var(--ta-text-3)">Receives 20% of platform trade fees for meteor shields &amp; boosts</div></div><span>0.20% / 0.10%</span></div>
      </div>
      <div style="margin-top:auto;padding-top:8px">
        <a class="btn btn-ghost btn-sm" href="#protocol">SEE TERRAAGENT PROTOCOL TREASURY ↓</a>
      </div>
    </div>

    <div class="econ-calc plate" data-testid="landing-staking-calc">
      <div class="econ-proto-head">
        <div>
          <span class="eyebrow">DAY-1 LOSSLESS SUBSCRIPTION · ZERO P2W</span>
          <h3 class="h3" style="margin-top:4px">Staking &amp; Fee Savings Simulator</h3>
        </div>
        <span class="badge badge-ai">9.0% POOL APY</span>
      </div>
      <div class="econ-slider-row">
        <label for="econ-stake-slider"><span>STAKED PRINCIPAL (DAY-1 UNLOCK AT 10 NEAR)</span><output id="econ-stake-out">25 NEAR</output></label>
        <input id="econ-stake-slider" type="range" min="0" max="250" step="5" value="25">
      </div>
      <div class="econ-slider-row">
        <label for="econ-vol-slider"><span>MONTHLY BUY VOLUME ON /TRADE</span><output id="econ-vol-out">500 USDC</output></label>
        <input id="econ-vol-slider" type="range" min="0" max="5000" step="100" value="500">
      </div>
      <div id="econ-tier-banner" class="econ-tier-banner is-unlocked" role="status"></div>
      <div class="econ-calc-out">
        <div class="econ-metric is-good"><span>YOUR NET VALIDATOR YIELD (80%)</span><strong id="econ-user-yield">1.80 NEAR / yr</strong></div>
        <div class="econ-metric is-blue"><span>PROTOCOL AI + GAS SLICE (20%)</span><strong id="econ-proto-yield">0.45 NEAR / yr</strong></div>
        <div class="econ-metric is-good"><span>YOUR PLATFORM FEE SAVINGS</span><strong id="econ-fee-saved">2.50 USDC / mo</strong></div>
        <div class="econ-metric"><span>AUTOPILOT &amp; COMBAT FAIRNESS</span><strong id="econ-ai-mode">Managed NEAR.AI · 0% P2W</strong></div>
      </div>
      <p style="margin:0;font-size:12.5px;color:var(--ta-steel)">Prefer custom models (Claude, GPT-5, DeepSeek) without staking? Attach your own encrypted BYOK NEAR.AI key anytime on <a href="/me.html">/me.html</a>.</p>
    </div>
  </div>`;
}

export function renderWhyNearHtml(): string {
  return `<div class="econ-escrow-strip plate-sm">
    <div>
      <span class="eyebrow">SKIN-IN-THE-GAME DIPLOMACY · BOUNTY.TERRAAGENT.TESTNET</span>
      <p><b>Bonded Peace Treaties &amp; 6-Hour War Escrows:</b> Lock matching bonds on bilateral truces (breaking early slashes <b>90% to the betrayed ally, 10% to Protocol</b>). Declaring a Bonded War unlocks <b>2× Raider Siphon (80 cap)</b> for 6 hours—destroy ≥1 enemy structure or siphon ≥200 resources for a 100% refund, or cancel/stall and forfeit <b>90% to the Defender + 10% to Protocol</b>.</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="/play.html?scenario=w18">TEST IN DIPLOMACY HUD →</a>
  </div>
  <div class="econ-why-near">
    <p class="eyebrow">WHY NEAR BLOCKCHAIN (AND WHY POSTGRES ALONE CANNOT DO THIS)</p>
    <div class="econ-why-grid">
      <div class="econ-why-card plate-sm"><span>01 · SUB-ACCOUNTS &amp; KEYS</span><b>Sandboxed AI Wallets</b><p>Colonies &amp; NPCs hold real sub-accounts with scoped function-call keys, ACID caps, and 1-click kill switches—AI can never touch human staked NEAR (HTTP 403).</p></div>
      <div class="econ-why-card plate-sm"><span>02 · NEP-413 + 1CLICK</span><b>Atomic 4-Way Clearing</b><p>Every trade settles Seller principal, Stall Owner fee, Planet DAO tax (20%), and Protocol fee (80%) in one counter-signed zero-sum <code>token_diff</code> batch.</p></div>
      <div class="econ-why-card plate-sm"><span>03 · NEAR.AI CLOUD TEE</span><b>Verifiable Decisions</b><p>Batched <code>z-ai/glm-5.3-flash</code> directives run inside hardware TEEs verified via <code>/v1/signature/{chat_id}</code> ECDSA proofs—fair NPCs and auditable autopilot.</p></div>
      <div class="econ-why-card plate-sm"><span>04 · TRUSTLESS ESCROW</span><b>Credible Peace &amp; War</b><p>Smart-contract bonds give diplomacy and war declarations real financial teeth with automatic 90% / 10% slashing and 2-day unbonding.</p></div>
      <div class="econ-why-card plate-sm"><span>05 · NEP-366 + FASTAUTH</span><b>Zero-Popup Web2 UX</b><p>Drop in as a guest, export NEP-245 cargo gaslessly via our relayer, and rotate keys to 100% self-custody only when you choose to withdraw.</p></div>
    </div>
    <div class="econ-cta-bar">
      <a class="btn btn-primary btn-sm" href="/trade.html">OPEN LIVE EXCHANGE</a>
      <a class="btn btn-ghost btn-sm" href="/pitchdeck/">INVESTOR &amp; JUDGE PITCH DECK</a>
      <a class="btn btn-ghost btn-sm" href="/whitepaper/">READ TECHNICAL WHITEPAPER</a>
    </div>
  </div>`;
}
