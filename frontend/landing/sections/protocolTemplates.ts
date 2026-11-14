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
  return `<svg class="proto-svg" viewBox="0 0 360 230" role="img" aria-label="Three protocol inflows converging into the TerraAgent Protocol vault and funding NEP-366 gasless relays plus NEAR.AI Cloud TEE autopilot">
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
    <text x="344" y="54" text-anchor="end" fill="var(--ta-energy)" font-family="var(--ta-font-mono)" font-size="8.5">NEP-366 GAS</text>
    <text x="344" y="182" text-anchor="end" fill="var(--ta-orange-hi)" font-family="var(--ta-font-mono)" font-size="8.5">TEE AI</text>

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
        <span class="proto-col-label is-in">▲ 3 ORGANIC PROTOCOL INFLOWS</span>
        <article class="proto-node plate-sm" data-stream="trade">
          <div class="proto-node-top"><b data-proto-trade-title>80% of Platform Trade Fee</b><span class="proto-rate" data-proto-trade-rate>0.80% / 0.40%</span></div>
          <p>Collected atomically on every CLOB &amp; Guild fill via NEP-413 <code>token_diff</code>. Remaining <span data-proto-dao-share-pct>20%</span> funds the Planet Council DAO.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="staking">
          <div class="proto-node-top"><b data-proto-yield-title>20% of Validator Yield</b><span class="proto-rate" data-proto-yield-rate>1.80% APY Slice</span></div>
          <p>Routed from 9.0% NEAR validator pools on <code>staking.terraagent.*</code> while human pilots keep 100% principal + <span data-proto-pilot-net-apy>7.20%</span> APY.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="bonds">
          <div class="proto-node-top"><b data-proto-slash-title>10% Bond Arbitration Slash</b><span class="proto-rate" data-proto-slash-rate>10% of Breach</span></div>
          <p>Paid automatically when an oathbreaker breaks a Bonded Peace Treaty or an attacker stalls/cancels a 6h War Escrow.</p>
        </article>
      </div>

      <div class="proto-core-wrap plate-sm">
        <span class="proto-col-label is-core">◆ ON-CHAIN CLEARING CORE</span>
        ${renderCoreConduitSvg()}
        <div class="proto-core-stats">
          <div class="proto-core-stat"><span>TOKEN MINT</span><strong>0%</strong></div>
          <div class="proto-core-stat"><span>COMBAT P2W</span><strong>0%</strong></div>
          <div class="proto-core-stat"><span>STAKER UNLOCK</span><strong data-proto-min-stake>≥10 NEAR</strong></div>
        </div>
      </div>

      <div class="proto-col">
        <span class="proto-col-label is-out">▼ 2 INFRASTRUCTURE OUTFLOWS</span>
        <article class="proto-node is-out plate-sm" data-stream="all">
          <div class="proto-node-top"><b>NEP-366 Gasless Relayer</b><span class="proto-rate" data-relayer-account>relayer.terraagent.*</span></div>
          <p>Sponsors <code>0.02 NEAR</code> cold-root pilot sub-account creation, storage deposits, and zero-popup gameplay meta-transactions.</p>
        </article>
        <article class="proto-node is-out-ai plate-sm" data-stream="all">
          <div class="proto-node-top"><b>Managed NEAR.AI Cloud TEE</b><span class="proto-rate">cloud-api.near.ai</span></div>
          <p>Pays batched <code>z-ai/glm-5.3-flash</code> hardware-attested inference for Rival NPCs and <span data-proto-ai-min-stake>≥10 NEAR</span> Staker Autopilot colonies.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="all">
          <div class="proto-node-top"><b>Verifiable Sustainability</b><span class="proto-rate">Net Positive Scale</span></div>
          <p>As planet trade volume and staked NEAR TVL grow, recurring fee &amp; yield inflows outpace fixed per-planet gas and batched AI calls.</p>
        </article>
      </div>
    </div>
  </div>`;
}

export function renderProtocolStagesHtml(): string {
  return `<div class="proto-stages">
    <article class="proto-stage plate-sm" data-proto-stage data-stream="trade">
      <div class="proto-stage-head">
        <span class="proto-stage-num">MECHANISM 01 · ATOMIC SETTLEMENT</span>
        <span class="badge badge-ok">NEP-413</span>
      </div>
      <h3>4-Way Trade Split on Every Fill</h3>
      <p>Sellers receive <b>100% of sale principal</b>. Buyer fees clear in the exact same counter-signed intent—never touching custodial studio wallets:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span data-proto-stage-trade-cap>BUYER FEE ALLOCATION (MAX 2.00% / 1.50% STAKER)</span><span>ATOMIC</span></div>
        <div class="proto-seg-bar" role="img" data-proto-bar-trade aria-label="Up to 50% Stall Owner, 40% Protocol, 10% Planet Council DAO">
          <span class="proto-seg is-terra" data-proto-bar-trade-stall style="width:50%"></span>
          <span class="proto-seg is-orange" data-proto-bar-trade-proto style="width:40%"></span>
          <span class="proto-seg is-blue" data-proto-bar-trade-dao style="width:10%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span>■ Trade Hub Stall Owner</span><b>0.00% – 1.00%</b></div>
          <div class="proto-legend-row"><span data-proto-legend-proto-label>■ TerraAgent Protocol (80% of platform)</span><b data-proto-legend-proto-val>0.80% (0.40% Staker)</b></div>
          <div class="proto-legend-row"><span data-proto-legend-dao-label>■ Planet Council DAO (20% of platform)</span><b data-proto-legend-dao-val>0.20% (0.10% Staker)</b></div>
        </div>
      </div>
    </article>

    <article class="proto-stage plate-sm" data-proto-stage data-stream="staking">
      <div class="proto-stage-head">
        <span class="proto-stage-num">MECHANISM 02 · DAY-1 LOSSLESS VAULT</span>
        <span class="badge badge-ai">HTTP 403 AI</span>
      </div>
      <h3 data-proto-stage-staking-title>80 / 20 Yield Split · Zero Pay-to-Win</h3>
      <p>Any claimed human wallet can stake <span data-proto-stage-min-stake>≥10 NEAR</span> from Day 1 (2-day unbonding, 100% principal safe). Yield funds your perks instead of combat buffs:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span data-proto-stage-pool-apy>9.0% VALIDATOR POOL YIELD SPLIT</span><span>LOSSLESS</span></div>
        <div class="proto-seg-bar" role="img" data-proto-bar-stake aria-label="80% Net APY to Pilot, 20% APY to Protocol">
          <span class="proto-seg is-blue" data-proto-bar-stake-pilot style="width:80%"></span>
          <span class="proto-seg is-energy" data-proto-bar-stake-proto style="width:20%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span data-proto-legend-pilot-label>■ Human Pilot Net Yield (80%)</span><b data-proto-legend-pilot-apy>7.20% Net APY</b></div>
          <div class="proto-legend-row"><span data-proto-legend-yield-label>■ Protocol AI + Gas Slice (20%)</span><b data-proto-legend-yield-apy>1.80% APY</b></div>
          <div class="proto-legend-row"><span data-proto-legend-perks-label>★ Perks at ≥10 NEAR</span><b data-proto-legend-perks-val>Managed AI + 0.50% Fee</b></div>
        </div>
      </div>
    </article>

    <article class="proto-stage plate-sm" data-proto-stage data-stream="bonds">
      <div class="proto-stage-head">
        <span class="proto-stage-num">MECHANISM 03 · CREDIBLE DIPLOMACY</span>
        <span class="badge badge-recruiting" data-proto-stage-bonds-badge>90 / 10 SLASH</span>
      </div>
      <h3>Peace Treaties &amp; 6h War Escrows</h3>
      <p>Peaceful truce expiry or meeting a 6h War Bond objective (≥1 structure razed or ≥200 loot siphoned at 2× cap) refunds <b>100%</b>. Betrayal or stall slashes:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span>BREACHED TRUCE OR FAILED 6H SIEGE BOND</span><span>ON-CHAIN</span></div>
        <div class="proto-seg-bar" role="img" data-proto-bar-bond aria-label="90% to Betrayed Ally or Defender, 10% to Protocol">
          <span class="proto-seg is-terra" data-proto-bar-bond-victim style="width:90%"></span>
          <span class="proto-seg is-orange" data-proto-bar-bond-proto style="width:10%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span>■ Betrayed Truce Partner / War Defender</span><b data-proto-legend-victim-val>90% Payout</b></div>
          <div class="proto-legend-row"><span>■ TerraAgent Protocol Arbitration</span><b data-proto-legend-slash-val>10% Slash Fee</b></div>
          <div class="proto-legend-row"><span>■ AI Guardrail (AW-13)</span><b>Blocked from Break/NEAR</b></div>
        </div>
      </div>
    </article>
  </div>`;
}

export function renderProtocolReceiptsHtml(): string {
  return `<div class="proto-proofs plate" aria-label="Concrete TerraAgent Protocol worked receipts and per-planet unit economics">
    <div class="proto-proofs-head">
      <div>
        <span class="eyebrow">CONCRETE NUMBERS &amp; UNIT ECONOMICS</span>
        <h3 class="h3">Worked On-Chain Receipts — Why Every Planet Sustains Itself</h3>
      </div>
      <span class="badge badge-ok">REAL COUNTERPARTY MATH</span>
    </div>
    <div class="proto-proof-grid">
      <article class="proto-proof plate-sm" data-stream="trade">
        <span class="proto-proof-tag is-terra">RECEIPT 01 · $100 USDC FILL (50 BP STALL)</span>
        <strong data-proto-ex-buyer-total>Buyer pays $101.50 ($101.00 Staker)</strong>
        <ul class="proto-proof-rows">
          <li><span>Seller Principal (100%)</span><b>$100.00 USDC</b></li>
          <li><span>Trade Hub Stall Owner</span><b>+$0.50 USDC</b></li>
          <li><span>Planet Council DAO</span><b data-proto-ex-dao>+$0.20 ($0.10 Stk)</b></li>
          <li><span>Protocol Treasury</span><b data-proto-ex-trade>+$0.80 ($0.40 Stk)</b></li>
        </ul>
        <p class="proto-proof-foot">1 fill funds <b data-proto-ex-trade-txs>~650 gasless NEP-366 player txs</b> (~0.0003 NEAR/tx at ~$4/NEAR).</p>
      </article>
      <article class="proto-proof plate-sm" data-stream="staking">
        <span class="proto-proof-tag is-blue">RECEIPT 02 · 50 NEAR DAY-1 STAKE</span>
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
        <span class="proto-proof-tag is-orange">RECEIPT 03 · 20 NEAR PEACE / WAR BOND</span>
        <strong>100% Refund if Kept · Slashed on Breach</strong>
        <ul class="proto-proof-rows">
          <li><span>Honored Treaty / Goal Met</span><b>20.00 NEAR Refund</b></li>
          <li><span>Victim / Defender Cut</span><b data-proto-ex-victim>18.00 NEAR (90%)</b></li>
          <li><span>Protocol Deterrence Cut</span><b data-proto-ex-slash>2.00 NEAR (10%)</b></li>
          <li><span>War Objective Window</span><b>6h (2× Raider Cap)</b></li>
        </ul>
        <p class="proto-proof-foot">Turns broken truces and stalled sieges into defender profit.</p>
      </article>
      <article class="proto-proof plate-sm is-econ" data-stream="all">
        <span class="proto-proof-tag is-energy">UNIT ECONOMICS · 5-COLONY PLANET</span>
        <strong>~$0.04 / day Cost vs ~$7 / day Break-Even</strong>
        <ul class="proto-proof-rows">
          <li><span>Batched GLM-5.3 TEE Sweep</span><b>1 RPC / 180s (5 Colonies)</b></li>
          <li><span>120s Digest Cooldown</span><b>0 Burst Re-Trigger Tokens</b></li>
          <li><span>Daily Planet AI Cost</span><b>~$0.03 – $0.05 / day</b></li>
          <li><span>Break-Even Threshold</span><b>~$7/d Vol or 200 NEAR TVL</b></li>
        </ul>
        <p class="proto-proof-foot">4 × 50 NEAR stakers (+3.60 NEAR/yr ≈ $14.40/yr at ~$4/NEAR) or ~$7/d trade vol covers 24/7 AI.</p>
      </article>
    </div>
  </div>`;
}
