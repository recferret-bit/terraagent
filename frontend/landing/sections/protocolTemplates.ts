// Templates for Section 07 (#protocol): TerraAgent Protocol Treasury Visual Schematic
// and 3 Scroll-Animated Mechanism Breakdown Cards (4-Way Trade, 80/20 Staking, 90/10 Bonds).

export function renderProtocolToolbarHtml(): string {
  return `<div class="proto-toolbar plate-sm" role="toolbar" aria-label="Filter TerraAgent Protocol value flows">
    <div class="proto-filters">
      <button type="button" class="proto-filter-btn" data-proto-filter="all" aria-pressed="true">ALL STREAMS</button>
      <button type="button" class="proto-filter-btn" data-proto-filter="trade" aria-pressed="false">01 · 4-WAY TRADE</button>
      <button type="button" class="proto-filter-btn" data-proto-filter="staking" aria-pressed="false">02 · 80/20 STAKING</button>
      <button type="button" class="proto-filter-btn" data-proto-filter="bonds" aria-pressed="false">03 · 90/10 BONDS</button>
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

    <!-- Scroll-energized active pipes -->
    <path class="proto-pipe-active" data-stream="trade" stroke="var(--ta-terra)" d="M 8 38 C 78 38, 86 96, 132 104" />
    <path class="proto-pipe-active" data-stream="staking" stroke="var(--ta-blue-hi)" d="M 8 115 L 132 115" />
    <path class="proto-pipe-active" data-stream="bonds" stroke="var(--ta-orange)" d="M 8 192 C 78 192, 86 134, 132 126" />
    <path class="proto-pipe-active" data-stream="all" stroke="var(--ta-energy)" d="M 228 106 C 276 106, 286 64, 352 64" />
    <path class="proto-pipe-active" data-stream="all" stroke="var(--ta-orange-hi)" d="M 228 124 C 276 124, 286 166, 352 166" />

    <!-- Anchor terminals -->
    <circle cx="8" cy="38" r="4" fill="var(--ta-terra)" data-stream="trade" />
    <circle cx="8" cy="115" r="4" fill="var(--ta-blue-hi)" data-stream="staking" />
    <circle cx="8" cy="192" r="4" fill="var(--ta-orange)" data-stream="bonds" />
    <circle cx="352" cy="64" r="4" fill="var(--ta-energy)" />
    <circle cx="352" cy="166" r="4" fill="var(--ta-orange-hi)" />

    <!-- Central Hexagonal Treasury Core -->
    <polygon points="180,52 228,80 228,150 180,178 132,150 132,80" fill="var(--ta-black-hole)" stroke="var(--ta-orange)" stroke-width="2.2" />
    <polygon points="180,62 219,85 219,145 180,168 141,145 141,85" fill="var(--ta-plate-2)" stroke="var(--ta-seam-3)" stroke-width="1.2" />
    <text x="180" y="103" text-anchor="middle" fill="var(--ta-energy)" font-family="var(--ta-font-mono)" font-size="9.5" font-weight="600" letter-spacing="1.4">PROTOCOL</text>
    <text x="180" y="121" text-anchor="middle" fill="var(--ta-hull)" font-family="var(--ta-font-display)" font-size="14" font-weight="700" letter-spacing="1">TREASURY</text>
    <text x="180" y="138" text-anchor="middle" fill="var(--ta-steel)" font-family="var(--ta-font-mono)" font-size="8.5">ZERO INFLATION</text>
  </svg>`;
}

export function renderProtocolSchematicHtml(): string {
  return `<div class="proto-schematic plate" id="protocol-schematic" data-testid="landing-protocol-card" data-active-stream="all">
    <div class="proto-progress-rail" aria-hidden="true"><i class="proto-progress-fill" id="proto-progress-fill"></i></div>
    <div class="proto-flow-grid">
      <div class="proto-col">
        <span class="proto-col-label is-in">▲ 3 ORGANIC PROTOCOL INFLOWS</span>
        <article class="proto-node plate-sm" data-stream="trade">
          <div class="proto-node-top"><b>80% of Platform Trade Fee</b><span class="proto-rate" data-proto-trade-rate>0.80% / 0.40%</span></div>
          <p>Collected atomically on every CLOB &amp; Guild fill via NEP-413 <code>token_diff</code>. Remaining 20% funds the Planet Council DAO.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="staking">
          <div class="proto-node-top"><b>20% of Validator Yield</b><span class="proto-rate">1.80% APY Slice</span></div>
          <p>Routed from 9.0% NEAR validator pools on <code>staking.terraagent.*</code> while human pilots keep 100% principal + 7.20% APY.</p>
        </article>
        <article class="proto-node plate-sm" data-stream="bonds">
          <div class="proto-node-top"><b>10% Bond Arbitration Slash</b><span class="proto-rate" data-proto-slash-rate>10% of Breach</span></div>
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
          <div class="proto-node-top"><b>NEP-366 Gasless Relayer</b><span class="proto-rate">relayer.terraagent.*</span></div>
          <p>Sponsors <code>0.02 NEAR</code> cold-root pilot sub-account creation, storage deposits, and zero-popup gameplay meta-transactions.</p>
        </article>
        <article class="proto-node is-out-ai plate-sm" data-stream="all">
          <div class="proto-node-top"><b>Managed NEAR.AI Cloud TEE</b><span class="proto-rate">cloud-api.near.ai</span></div>
          <p>Pays batched <code>z-ai/glm-5.3-flash</code> hardware-attested inference for Rival NPCs and ≥10 NEAR Staker Autopilot colonies.</p>
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
        <div class="proto-bar-caption"><span>BUYER FEE ALLOCATION (MAX 2.00% / 1.50% STAKER)</span><span>ATOMIC</span></div>
        <div class="proto-seg-bar" role="img" aria-label="Up to 50% Stall Owner, 40% Protocol, 10% Planet Council DAO">
          <span class="proto-seg is-terra" style="width:50%"></span>
          <span class="proto-seg is-orange" style="width:40%"></span>
          <span class="proto-seg is-blue" style="width:10%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span>■ Trade Hub Stall Owner</span><b>0.00% – 1.00%</b></div>
          <div class="proto-legend-row"><span>■ TerraAgent Protocol (80% of platform)</span><b>0.80% (0.40% Staker)</b></div>
          <div class="proto-legend-row"><span>■ Planet Council DAO (20% of platform)</span><b>0.20% (0.10% Staker)</b></div>
        </div>
      </div>
    </article>

    <article class="proto-stage plate-sm" data-proto-stage data-stream="staking">
      <div class="proto-stage-head">
        <span class="proto-stage-num">MECHANISM 02 · DAY-1 LOSSLESS VAULT</span>
        <span class="badge badge-ai">HTTP 403 AI</span>
      </div>
      <h3>80 / 20 Yield Split · Zero Pay-to-Win</h3>
      <p>Any claimed human wallet can stake ≥10 NEAR from Day 1 (2-day unbonding, 100% principal safe). Yield funds your perks instead of combat buffs:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span>9.0% VALIDATOR POOL YIELD SPLIT</span><span>LOSSLESS</span></div>
        <div class="proto-seg-bar" role="img" aria-label="80% Net APY to Pilot, 20% APY to Protocol">
          <span class="proto-seg is-blue" style="width:80%"></span>
          <span class="proto-seg is-energy" style="width:20%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span>■ Human Pilot Net Yield (80%)</span><b>7.20% Net APY</b></div>
          <div class="proto-legend-row"><span>■ Protocol AI + Gas Slice (20%)</span><b>1.80% APY</b></div>
          <div class="proto-legend-row"><span>★ Perks at ≥10 NEAR</span><b>Managed AI + 0.50% Fee</b></div>
        </div>
      </div>
    </article>

    <article class="proto-stage plate-sm" data-proto-stage data-stream="bonds">
      <div class="proto-stage-head">
        <span class="proto-stage-num">MECHANISM 03 · CREDIBLE DIPLOMACY</span>
        <span class="badge badge-recruiting">90 / 10 SLASH</span>
      </div>
      <h3>Peace Treaties &amp; 6h War Escrows</h3>
      <p>Peaceful truce expiry or meeting a 6h War Bond objective (≥1 structure razed or ≥200 loot siphoned at 2× cap) refunds <b>100%</b>. Betrayal or stall slashes:</p>
      <div class="proto-bar-group">
        <div class="proto-bar-caption"><span>BREACHED TRUCE OR FAILED 6H SIEGE BOND</span><span>ON-CHAIN</span></div>
        <div class="proto-seg-bar" role="img" aria-label="90% to Betrayed Ally or Defender, 10% to Protocol">
          <span class="proto-seg is-terra" style="width:90%"></span>
          <span class="proto-seg is-orange" style="width:10%"></span>
        </div>
        <div class="proto-legend-list">
          <div class="proto-legend-row"><span>■ Betrayed Truce Partner / War Defender</span><b>90% Payout</b></div>
          <div class="proto-legend-row"><span>■ TerraAgent Protocol Arbitration</span><b>10% Slash Fee</b></div>
          <div class="proto-legend-row"><span>■ AI Guardrail (AW-13)</span><b>Blocked from Break/NEAR</b></div>
        </div>
      </div>
    </article>
  </div>`;
}
