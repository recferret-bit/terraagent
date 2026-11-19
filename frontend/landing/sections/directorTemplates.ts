// Pure HTML templates & scenario catalog for Section 05 (#director-scenarios),
// shared by runtime hydration and Vite build-time pre-rendering.

export interface ScenarioItem {
  readonly id: string;
  readonly code: string;
  readonly tag: string;
  readonly badgeClass: string;
  readonly accent: string;
  readonly title: string;
  readonly copy: string;
  readonly directive: string;
  readonly terminalTitle: string;
  readonly attestBadge: string;
  readonly triggerLine: string;
  readonly obsLines: readonly [string, string, string];
  readonly actionLines: readonly [string, string];
  readonly simCmd: string;
  readonly svg: string;
}

export const SCENARIOS: readonly ScenarioItem[] = [
  {
    id: 'water',
    code: '01 · SHORTAGE',
    tag: 'GUILD BARTER',
    badgeClass: 'badge-new',
    accent: 'var(--ta-blue-hi)',
    title: 'Cover a Water Crisis',
    copy: 'Buy irrigation water from a docked Guild ship below cap and queue a ridge pump.',
    directive: 'market.acceptGuildOffer() · enqueue(water_pump)',
    terminalTitle: 'DIRECTOR TRACE · WATER SHORTAGE',
    attestBadge: 'ENCLAVE VERIFIED · TEE',
    triggerLine: '▸ trigger: water_critical · biome: desert',
    obsLines: [
      'Stock: metals 340, water 14 | Grid: +18 E/s',
      'Guild ship Kestrel: asking 0.88 USDC for bio.water',
      'Limits: war=off · spend_cap=ok · demolish=blocked',
    ],
    actionLines: [
      'Buy 40 bio.water from Kestrel below 0.92 cap,',
      'then queue a condensation pump on ridge hex.',
    ],
    simCmd: '→ market.acceptGuildOffer() · enqueue(water_pump)',
    svg: `<svg viewBox="0 0 260 92" fill="none" aria-hidden="true">
      <polygon points="40,28 58,17 76,28 76,50 58,61 40,50" fill="var(--ta-plate)" stroke="var(--ta-blue-hi)" stroke-width="1.6"/>
      <polygon points="184,28 202,17 220,28 220,50 202,61 184,50" fill="var(--ta-plate)" stroke="var(--ta-terra)" stroke-width="1.6"/>
      <path class="sc-vec" d="M82 34 H178" stroke="var(--ta-energy)" stroke-width="2" stroke-dasharray="6 4"/>
      <path class="sc-vec sc-vec-rev" d="M178 44 H82" stroke="var(--ta-terra)" stroke-width="2" stroke-dasharray="6 4"/>
      <circle cx="58" cy="39" r="4" fill="var(--ta-blue-hi)"/>
      <circle cx="202" cy="39" r="4" fill="var(--ta-terra)"/>
      <text x="16" y="80" fill="var(--ta-energy)" font-family="var(--ta-font-mono)" font-size="9.5" letter-spacing="1">▸ 40 BIO.WATER @ 0.88 USDC</text>
    </svg>`,
  },
  {
    id: 'raid',
    code: '02 · PERIMETER',
    tag: 'WAR OPT-IN',
    badgeClass: 'badge-alert',
    accent: 'var(--ta-fault)',
    title: 'Raid an Unshielded Depot',
    copy: 'When War & Diplomacy is enabled, dispatch Recon units as soon as a rival shield expires.',
    directive: 'raid.launch(col_4) · queueGoal(defend_colony)',
    terminalTitle: 'DIRECTOR TRACE · PERIMETER RAID',
    attestBadge: 'WAR OPT-IN VERIFIED · TEE',
    triggerLine: '▸ trigger: rival_shield_expired · target: col_4',
    obsLines: [
      'Squads ready: 3 Recon Rovers | Grid: +24 E/s',
      'Target col_4: shield=expired, active_truce=false',
      'Guardrails: allow_war=true · near_bond=human_only',
    ],
    actionLines: [
      'Dispatch 3 Recon Rovers to siphon col_4 metals depot,',
      'hold 1 Autocannon reserve on eastern ridge.',
    ],
    simCmd: '→ raid(target: col_4) · queueGoal(defend_colony)',
    svg: `<svg viewBox="0 0 260 92" fill="none" aria-hidden="true">
      <polygon points="44,42 62,31 80,42 80,64 62,75 44,64" fill="var(--ta-plate)" stroke="var(--ta-orange)" stroke-opacity=".8"/>
      <polygon points="172,16 190,6 208,16 208,38 190,48 172,38" fill="var(--ta-plate)" stroke="var(--ta-fault)" stroke-opacity=".9"/>
      <circle cx="62" cy="53" r="4.5" fill="var(--ta-orange)"/>
      <path class="sc-vec" d="M70 49 C 110 34, 140 28, 178 27" stroke="var(--ta-fault)" stroke-width="2" stroke-dasharray="5 4"/>
      <g transform="translate(190 27)">
        <circle r="11" stroke="var(--ta-fault)" stroke-width="1.4" stroke-dasharray="5 3"/>
        <circle r="3.5" fill="var(--ta-fault)"/>
      </g>
      <text x="16" y="80" fill="var(--ta-fault-text)" font-family="var(--ta-font-mono)" font-size="9.5" letter-spacing="1">▸ RECON SIPHON · SHIELD DOWN</text>
    </svg>`,
  },
  {
    id: 'arb',
    code: '03 · MARKET',
    tag: 'SURPLUS SALE',
    badgeClass: 'badge-recruiting',
    accent: 'var(--ta-orange)',
    title: 'Sell Surplus Into Scarcity',
    copy: 'List surplus orbital metals on your Trade Hub stall when local output beats 24h VWAP.',
    directive: 'market.placeOrder(sell, metals.t1/USDC, 50)',
    terminalTitle: 'DIRECTOR TRACE · SURPLUS ARBITRAGE',
    attestBadge: 'SPEND CAP OK · TEE',
    triggerLine: '▸ trigger: orbital_surplus · pair: metals.t1/USDC',
    obsLines: [
      'Orbital hold: 260 metals.t1 | Minerals: 18 (low)',
      'Planet 24h VWAP: 1.14 USDC (+14% above parity)',
      'Allowance: 50 / 2,000 USDC daily cap committed',
    ],
    actionLines: [
      'List 50 metals.t1 at 1.12 USDC on Trade Hub stall,',
      'route proceeds to minerals.t1 capacitor order.',
    ],
    simCmd: '→ market.placeOrder(sell, metals.t1, 50 @ 1.12 USDC)',
    svg: `<svg viewBox="0 0 260 92" fill="none" aria-hidden="true">
      <polygon points="110,26 130,15 150,26 150,48 130,59 110,48" fill="var(--ta-plate)" stroke="var(--ta-orange)" stroke-width="1.6"/>
      <circle class="sc-ring" cx="130" cy="37" r="23" stroke="var(--ta-orange)" stroke-width="1.3" stroke-dasharray="6 4"/>
      <path d="M46 58 L92 42 L130 48 L174 26 L214 19" stroke="var(--ta-orange-hi)" stroke-width="2"/>
      <circle cx="174" cy="26" r="3.5" fill="var(--ta-terra)"/>
      <circle cx="214" cy="19" r="4" fill="var(--ta-orange)"/>
      <text x="16" y="80" fill="var(--ta-orange-hi)" font-family="var(--ta-font-mono)" font-size="9.5" letter-spacing="1">▸ +14% VS VWAP · ORDER POSTED</text>
    </svg>`,
  },
  {
    id: 'truce',
    code: '04 · DIPLOMACY',
    tag: 'SAFE TRUCE',
    badgeClass: 'badge-ok',
    accent: 'var(--ta-terra)',
    title: 'Accept a Bilateral Truce',
    copy: 'Accept non-bonded peace windows to shield harvesters; breaking truces stays human-only.',
    directive: 'diplomacy.respondTruce(accept) · cancel=blocked',
    terminalTitle: 'DIRECTOR TRACE · BILATERAL TRUCE',
    attestBadge: 'TRUCE BREAK BLOCKED · HUMAN ONLY',
    triggerLine: '▸ trigger: incoming_truce_offer · from: col_2 (6h)',
    obsLines: [
      'Living hexes: 11 / 18 | Night solar dip in 4m',
      'Offer tr_09: 6h mutual raid lock, 0 NEAR bond',
      'Limits: cancel_truce=forbidden · wallet=locked',
    ],
    actionLines: [
      'Accept 6h peace truce with col_2 to secure border,',
      'divert drones to cultivate 3 Living hexes.',
    ],
    simCmd: '→ diplomacy.respondTruce(tr_09, accept: true)',
    svg: `<svg viewBox="0 0 260 92" fill="none" aria-hidden="true">
      <ellipse cx="130" cy="39" rx="54" ry="18" fill="var(--ta-plate)" stroke="var(--ta-terra)" stroke-width="1.4" stroke-dasharray="6 3"/>
      <g transform="translate(130 39)">
        <polygon points="0,-13 11,-6 11,6 0,13 -11,6 -11,-6" fill="var(--ta-black-hole)" stroke="var(--ta-terra)" stroke-width="1.6"/>
        <path d="M-4 0 L-1 3.5 L5 -3.5" stroke="var(--ta-terra)" stroke-width="2" stroke-linecap="square"/>
      </g>
      <circle cx="76" cy="39" r="4" fill="var(--ta-blue-hi)"/>
      <circle cx="184" cy="39" r="4" fill="var(--ta-terra)"/>
      <text x="16" y="80" fill="var(--ta-terra)" font-family="var(--ta-font-mono)" font-size="9.5" letter-spacing="1">▸ 6H TRUCE SEALED · AI NO-BREAK</text>
    </svg>`,
  },
];

export function renderTerminalBody(item: ScenarioItem): string {
  return `<div style="color:var(--ta-dim)">${item.triggerLine}</div>
    <div class="gap">${item.obsLines[0]}</div>
    <div>${item.obsLines[1]}</div>
    <div>${item.obsLines[2]}</div>
    <div class="gap c-blue">◆ near.ai directive (z-ai/glm-5.3-flash)</div>
    <div style="color:var(--ta-text)">${item.actionLines[0]}</div>
    <div style="color:var(--ta-text)">${item.actionLines[1]}</div>
    <div class="gap c-orange-hi">${item.simCmd}</div>
    <div style="color:var(--ta-dim);margin-top:8px">enclave attestation verified · 1 order queued<span class="blink c-orange">▌</span></div>`;
}

export function renderScenarioCard(item: ScenarioItem, index: number): string {
  const active = index === 0;
  return `<button type="button" class="scenario-card plate-sm ${active ? 'is-selected' : ''}" data-scenario-card="${item.id}" aria-pressed="${active}" style="--sc-accent:${item.accent};--sc-delay:${index * 60}ms">
    <div class="scenario-vis">
      ${item.svg}
      <div class="scanlines"></div>
    </div>
    <div class="scenario-body">
      <div class="scenario-top">
        <span class="scenario-code">${item.code}</span>
        <span class="badge ${item.badgeClass}">${item.tag}</span>
      </div>
      <h3 class="h3">${item.title}</h3>
      <p>${item.copy}</p>
      <div class="scenario-cmd"><code>${item.directive}</code></div>
    </div>
  </button>`;
}

export function renderDirectorScenariosHtml(): string {
  const cardsHtml = SCENARIOS.map(renderScenarioCard).join('');
  return `<div class="scenarios-picker-head">
      <span class="label">SELECT AN EMERGENCY SCENARIO</span>
      <span>UPDATES TRACE →</span>
    </div>
    <div class="scenarios-grid">${cardsHtml}</div>`;
}
