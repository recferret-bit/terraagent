// Templates for Section 07 (#protocol): TerraAgent Protocol Treasury Visual Schematic
// and 3 Scroll-Animated Mechanism Breakdown Cards (4-Way Trade, 80/20 Staking, 90/10 Bonds).

export function renderProtocolToolbarHtml(): string {
  return `<div class="proto-toolbar plate-sm" role="toolbar" aria-label="Filter TerraAgent Protocol value flows">
    <div class="proto-filters">
      <button type="button" class="proto-filter-btn" data-proto-filter="all" aria-pressed="true">ALL STREAMS</button>
      <button type="button" class="proto-filter-btn" data-proto-filter="trade" aria-pressed="false">01 · 4-WAY TRADE</button>
      <button type="button" class="proto-filter-btn" data-proto-filter="staking" data-proto-filter-staking aria-pressed="false">02 · 80/20 STAKING</button>
      <button type="button" class="proto-filter-btn" data-proto-filter="bonds" data-proto-filter-bonds aria-pressed="false">03 · 90/10 BONDS</button>
    </div>
    <div class="proto-acct-readout">
      <span>TREASURY ACCOUNT</span>
      <code data-protocol-account>protocol.terraagent.testnet</code>
      <a class="btn btn-ghost btn-sm" href="/v1/near/protocol">LIVE JSON ↗</a>
    </div>
  </div>`;
}

function renderCoreConduitSvg(): string {
  return `<svg class="proto-svg" viewBox="0 0 360 230" role="img" aria-label="Three protocol inflows converging into the TerraAgent Protocol vault and funding player gas relays plus offline colony AI">
    <!-- Background inactive pipes -->
    <path class="proto-pipe-bg" d="M 8 38 C 78 38, 86 96, 132 104" />
    <path class="proto-pipe-bg" d="M 8 115 L 132 115" />
    <path class="proto-pipe-bg" d="M 8 192 C 78 192, 86 134, 132 126" />
    <path class="proto-pipe-bg" d="M 228 106 C 276 106, 286 64, 352 64" />
    <path class="proto-pipe-bg" d="M 228 124 C 276 124, 286 166, 352 166" />

    <!-- Scroll-energized active pipes (normalized pathLength=100 for exact phased scroll progress) -->
    <path id="proto-p-trade" class="proto-pipe-active" pathLength="100" data-pipe-phase="in" data-stream="trade" stroke="var(--ta-terra)" d="M 8 38 C 78 38, 86 96, 132 104" />
    <path id="proto-p-stake" class="proto-pipe-active" pathLength="100" data-pipe-phase="in" data-stream="staking" stroke="var(--ta-blue-hi)" d="M 8 115 L 132 115" />
    <path id="proto-p-bonds" class="proto-pipe-active" pathLength="100" data-pipe-phase="in" data-stream="bonds" stroke="var(--ta-orange)" d="M 8 192 C 78 192, 86 134, 132 126" />
    <path id="proto-p-gas" class="proto-pipe-active" pathLength="100" data-pipe-phase="out" data-stream="all" stroke="var(--ta-energy)" d="M 228 106 C 276 106, 286 64, 352 64" />
    <path id="proto-p-ai" class="proto-pipe-active" pathLength="100" data-pipe-phase="out" data-stream="all" stroke="var(--ta-orange-hi)" d="M 228 124 C 276 124, 286 166, 352 166" />

    <!-- Conduit callout micro-labels -->
    <text x="16" y="29" fill="var(--ta-terra)" font-family="var(--ta-font-mono)" font-size="8.5" data-stream="trade" data-proto-svg-fees>FEES 80%</text>
    <text x="16" y="106" fill="var(--ta-blue-hi)" font-family="var(--ta-font-mono)" font-size="8.5" data-stream="staking" data-proto-svg-yield>YIELD 20%</text>
    <text x="16" y="209" fill="var(--ta-orange-hi)" font-family="var(--ta-font-mono)" font-size="8.5" data-stream="bonds" data-proto-svg-slash>SLASH 10%</text>
    <text x="344" y="54" text-anchor="end" fill="var(--ta-energy)" font-family="var(--ta-font-mono)" font-size="8.5">PLAYER GAS</text>
    <text x="344" y="182" text-anchor="end" fill="var(--ta-orange-hi)" font-family="var(--ta-font-mono)" font-size="8.5">COLONY AI</text>

    <!-- Live traveling value packets -->
    <g class="proto-packets" aria-hidden="true">
      <circle r="3.4" fill="var(--ta-terra)" data-stream="trade"><animateMotion dur="1.7s" repeatCount="indefinite" path="M 8 38 C 78 38, 86 96, 132 104" /></circle>
      <circle r="3.4" fill="var(--ta-blue-hi)" data-stream="staking"><animateMotion dur="1.9s" repeatCount="indefinite" path="M 8 115 L 132 115" /></circle>
      <circle r="3.4" fill="var(--ta-orange)" data-stream="bonds"><animateMotion dur="2.1s" repeatCount="indefinite" path="M 8 192 C 78 192, 86 134, 132 126" /></circle>
      <circle r="3.6" fill="var(--ta-energy)"><animateMotion dur="1.6s" repeatCount="indefinite" path="M 228 106 C 276 106, 286 64, 352 64" /></circle>
      <circle r="3.6" fill="var(--ta-orange-hi)"><animateMotion dur="1.8s" repeatCount="indefinite" path="M 228 124 C 276 124, 286 166, 352 166" /></circle>
    </g>

    <!-- Anchor terminals -->
    <circle cx="8" cy="38" r="4" fill="var(--ta-terra)" data-stream="trade" />
    <circle cx="8" cy="115" r="4" fill="var(--ta-blue-hi)" data-stream="staking" />
    <circle cx="8" cy="192" r="4" fill="var(--ta-orange)" data-stream="bonds" />
    <circle cx="352" cy="64" r="4" fill="var(--ta-energy)" />
    <circle cx="352" cy="166" r="4" fill="var(--ta-orange-hi)" />

    <!-- Central Hexagonal Treasury Core -->
    <g class="proto-core-hex">
      <polygon points="180,52 228,80 228,150 180,178 132,150 132,80" fill="var(--ta-black-hole)" stroke="var(--ta-orange)" stroke-width="2.2" />
      <polygon points="180,62 219,85 219,145 180,168 141,145 141,85" fill="var(--ta-plate-2)" stroke="var(--ta-seam-3)" stroke-width="1.2" />
      <text x="180" y="103" text-anchor="middle" fill="var(--ta-energy)" font-family="var(--ta-font-mono)" font-size="9.5" font-weight="600" letter-spacing="1.4">PROTOCOL</text>
      <text x="180" y="121" text-anchor="middle" fill="var(--ta-text)" font-family="var(--ta-font-display)" font-size="14" font-weight="700" letter-spacing="1">TREASURY</text>
      <text x="180" y="138" text-anchor="middle" fill="var(--ta-steel)" font-family="var(--ta-font-mono)" font-size="8.5">ZERO INFLATION</text>
    </g>
  </svg>`;
}

export function renderProtocolSchematicHtml(): string {
  return `<div class="proto-schematic plate" id="protocol-schematic" data-testid="landing-protocol-card" data-active-stream="all">
    <div class="proto-progress-rail" aria-hidden="true"><i class="proto-progress-fill" id="proto-progress-fill"></i></div>
    <div class="proto-flow-grid">
      <div class="proto-col">
        <span class="proto-col-label is-in">INFLOWS · 3 REVENUE STREAMS</span>
        <article class="proto-node plate-sm" data-stream="trade">
          <div class="proto-node-top"><b data-proto-trade-title>80% of Platform Trade Fee</b><span class="proto-rate" data-proto-trade-rate>0.80% / 0.40%</span></div>
          <p>Paid by the buyer on market fills; the other <span data-proto-dao-share-pct>20%</span> goes to your planet's Council fund.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="staking">
          <div class="proto-node-top"><b data-proto-yield-title>20% of Validator Yield</b><span class="proto-rate" data-proto-yield-rate>1.80% APY Slice</span></div>
          <p>Routed from validator rewards while pilots keep <span data-proto-pilot-net-apy>7.20%</span> net APY and full principal.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="bonds">
          <div class="proto-node-top"><b data-proto-slash-title>10% Bond Arbitration Slash</b><span class="proto-rate" data-proto-slash-rate>10% of Breach</span></div>
          <p>Triggered only when a colony breaks an active peace truce or abandons a declared siege.</p>
        </article>
      </div>

      <div class="proto-core-wrap plate-sm">
        <span class="proto-col-label is-core">TREASURY CLEARING</span>
        ${renderCoreConduitSvg()}
        <div class="proto-core-stats">
          <div class="proto-core-stat"><span>REWARD TOKEN</span><strong>NONE</strong></div>
          <div class="proto-core-stat"><span>COMBAT P2W</span><strong>0%</strong></div>
          <div class="proto-core-stat"><span>PERK THRESHOLD</span><strong data-proto-min-stake>≥10 NEAR</strong></div>
        </div>
      </div>

      <div class="proto-col">
        <span class="proto-col-label is-out">OUTFLOWS · 2 OPERATING BUDGETS</span>
        <article class="proto-node is-out plate-sm" data-stream="all">
          <div class="proto-node-top"><b>Gasless Player Relay</b><span class="proto-rate" data-relayer-account>relayer.terraagent.*</span></div>
          <p>Sponsors new pilot accounts and everyday in-game actions behind the scenes.</p>
        </article>
        <article class="proto-node is-out-ai plate-sm" data-stream="all">
          <div class="proto-node-top"><b>NEAR.AI Autopilot</b><span class="proto-rate">cloud-api.near.ai</span></div>
          <p>Funds scheduled emergency sweeps for rival NPCs and <span data-proto-ai-min-stake>≥10 NEAR</span> stakers.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="all">
          <div class="proto-node-top"><b>Low Planet Cost Floor</b><span class="proto-rate">~$0.04 / day</span></div>
          <p>Grouping colonies into 3-minute turns breaks even on ~$7/day of planet trades.</p>
        </article>
      </div>
    </div>
  </div>`;
}

export function renderProtocolStagesHtml(): string {
  return `<div class="proto-stages">
    <article class="proto-stage plate-sm" data-proto-stage data-stream="trade">
      <div class="proto-stage-head">
        <span class="proto-stage-num">01 · TRADE FILL</span>
        <span class="badge badge-ok">ATOMIC</span>
      </div>
      <h3>4-Way Trade Split on Every Fill</h3>
      <p>Sellers receive <b>100% of sale price</b>; buyer fees split in the same settlement:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span data-proto-stage-trade-cap>BUYER FEE ALLOCATION (MAX 2.00% / 1.50% STAKER)</span><span>ATOMIC</span></div>
        <div class="proto-seg-bar" role="img" data-proto-bar-trade aria-label="Up to 50% Stall Owner, 40% Protocol, 10% Planet Council DAO">
          <span class="proto-seg is-terra" data-proto-bar-trade-stall style="width:50%"></span>
          <span class="proto-seg is-orange" data-proto-bar-trade-proto style="width:40%"></span>
          <span class="proto-seg is-blue" data-proto-bar-trade-dao style="width:10%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span>■ Trade Hub Stall</span><b>0.00% – 1.00%</b></div>
          <div class="proto-legend-row"><span data-proto-legend-proto-label>■ Protocol Share (80%)</span><b data-proto-legend-proto-val>0.80% (0.40% Staker)</b></div>
          <div class="proto-legend-row"><span data-proto-legend-dao-label>■ Planet Council (20%)</span><b data-proto-legend-dao-val>0.20% (0.10% Staker)</b></div>
        </div>
      </div>
    </article>

    <article class="proto-stage plate-sm" data-proto-stage data-stream="staking">
      <div class="proto-stage-head">
        <span class="proto-stage-num">02 · STAKING YIELD</span>
        <span class="badge badge-ai">HUMAN ONLY</span>
      </div>
      <h3 data-proto-stage-staking-title>80 / 20 Yield Split · Zero Pay-to-Win</h3>
      <p>Validator rewards fund perks at <span data-proto-stage-min-stake>≥10 NEAR</span> without touching principal:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span data-proto-stage-pool-apy>9.0% VALIDATOR POOL YIELD SPLIT</span><span>LOSSLESS</span></div>
        <div class="proto-seg-bar" role="img" data-proto-bar-stake aria-label="80% Net APY to Pilot, 20% APY to Protocol">
          <span class="proto-seg is-blue" data-proto-bar-stake-pilot style="width:80%"></span>
          <span class="proto-seg is-energy" data-proto-bar-stake-proto style="width:20%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span data-proto-legend-pilot-label>■ Pilot Net Yield (80%)</span><b data-proto-legend-pilot-apy>7.20% Net APY</b></div>
          <div class="proto-legend-row"><span data-proto-legend-yield-label>■ Protocol Slice (20%)</span><b data-proto-legend-yield-apy>1.80% APY</b></div>
          <div class="proto-legend-row"><span data-proto-legend-perks-label>★ Perks at ≥10 NEAR</span><b data-proto-legend-perks-val>Managed AI + 0.50% Fee</b></div>
        </div>
      </div>
    </article>

    <article class="proto-stage plate-sm" data-proto-stage data-stream="bonds">
      <div class="proto-stage-head">
        <span class="proto-stage-num">03 · TREATY BREACH</span>
        <span class="badge badge-recruiting" data-proto-stage-bonds-badge>90 / 10 SLASH</span>
      </div>
      <h3>Peace Treaties &amp; 6h War Escrows</h3>
      <p>Kept commitments refund <b>100%</b>; broken truces and failed sieges pay the defender:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span>BREACHED TRUCE OR FAILED 6H SIEGE BOND</span><span>ON-CHAIN</span></div>
        <div class="proto-seg-bar" role="img" data-proto-bar-bond aria-label="90% to Betrayed Ally or Defender, 10% to Protocol">
          <span class="proto-seg is-terra" data-proto-bar-bond-victim style="width:90%"></span>
          <span class="proto-seg is-orange" data-proto-bar-bond-proto style="width:10%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span>■ Betrayed Ally / Defender</span><b data-proto-legend-victim-val>90% Payout</b></div>
          <div class="proto-legend-row"><span>■ Protocol Arbitration</span><b data-proto-legend-slash-val>10% Slash Fee</b></div>
          <div class="proto-legend-row"><span>■ Colony AI</span><b>Cannot Touch Bonds</b></div>
        </div>
      </div>
    </article>
  </div>`;
}

export function renderProtocolReceiptsHtml(): string {
  return `<details class="proto-proofs plate" data-proto-proofs aria-label="Concrete TerraAgent Protocol worked receipts and per-planet unit economics">
    <summary class="proto-proofs-head">
      <div>
        <span class="eyebrow">WORKED EXAMPLES &amp; PLANET COST MATH</span>
        <h3 class="h3">Inspect Sample Receipts ($100 Trade · 50 NEAR Stake · 20 NEAR Bond)</h3>
      </div>
      <span class="badge badge-ok">4 EXAMPLES ▾</span>
    </summary>
    <div class="proto-proof-grid">
      <article class="proto-proof plate-sm" data-stream="trade">
        <span class="proto-proof-tag is-terra">EXAMPLE 01 · $100 CARGO FILL (0.5% STALL)</span>
        <strong data-proto-ex-buyer-total>Buyer pays $101.50 ($101.00 Staker)</strong>
        <ul class="proto-proof-rows">
          <li><span>Seller Principal (100%)</span><b>$100.00 USDC</b></li>
          <li><span>Trade Hub Stall Owner</span><b>+$0.50 USDC</b></li>
          <li><span>Planet Council DAO</span><b data-proto-ex-dao>+$0.20 ($0.10 Stk)</b></li>
          <li><span>Protocol Treasury</span><b data-proto-ex-trade>+$0.80 ($0.40 Stk)</b></li>
        </ul>
        <p class="proto-proof-foot">1 fill covers <b data-proto-ex-trade-txs>~650 gasless NEP-366 player txs</b> (~0.0003 NEAR/tx at ~$4/NEAR).</p>
      </article>
      <article class="proto-proof plate-sm" data-stream="staking">
        <span class="proto-proof-tag is-blue">EXAMPLE 02 · 50 NEAR STAKE</span>
        <strong>100% Principal Safe · 2d Unbond</strong>
        <ul class="proto-proof-rows">
          <li><span>Locked Principal</span><b>50.00 NEAR</b></li>
          <li><span>Pilot Net Yield</span><b data-proto-ex-pilot-yield>+3.60 NEAR / yr</b></li>
          <li><span>Protocol Yield Slice</span><b data-proto-ex-proto-yield>+0.90 NEAR / yr</b></li>
          <li><span>Unlocked Perks</span><b data-proto-ex-perks>Managed AI + 0.50% Fee</b></li>
        </ul>
        <p class="proto-proof-foot" data-proto-ex-stake-foot>+0.90 NEAR/yr sponsors ~3,000 meta-txs with zero principal risk.</p>
      </article>
      <article class="proto-proof plate-sm" data-stream="bonds">
        <span class="proto-proof-tag is-orange">EXAMPLE 03 · 20 NEAR TREATY / SIEGE BOND</span>
        <strong>100% Refund if Kept · Slashed on Breach</strong>
        <ul class="proto-proof-rows">
          <li><span>Honored Treaty / Goal Met</span><b>20.00 NEAR Refund</b></li>
          <li><span>Victim / Defender Cut</span><b data-proto-ex-victim>18.00 NEAR (90%)</b></li>
          <li><span>Protocol Deterrence Cut</span><b data-proto-ex-slash>2.00 NEAR (10%)</b></li>
          <li><span>Siege Window</span><b>6h (2× Raider Cap)</b></li>
        </ul>
        <p class="proto-proof-foot">Turns broken truces and stalled sieges into defender profit.</p>
      </article>
      <article class="proto-proof plate-sm is-econ" data-stream="all">
        <span class="proto-proof-tag is-energy">EXAMPLE 04 · 5-COLONY PLANET COST</span>
        <strong>~$0.04 / day Cost vs ~$7 / day Break-Even</strong>
        <ul class="proto-proof-rows">
          <li><span>Planet AI Sweep</span><b>Every 3 min (batched)</b></li>
          <li><span>Idle Colony Cache</span><b>Skips unchanged turns</b></li>
          <li><span>Daily Planet AI Cost</span><b>~$0.03 – $0.05 / day</b></li>
          <li><span>Break-Even Activity</span><b>~$7/d trades or 200 NEAR</b></li>
        </ul>
        <p class="proto-proof-foot">Four 50 NEAR stakers or ~$7/day in local trade volume covers 24/7 planet AI.</p>
      </article>
    </div>
  </details>`;
}

export function renderProtocolBoardHtml(): string {
  return `<div class="sec-head">
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
}
