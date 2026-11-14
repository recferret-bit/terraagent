import { WEB2_FEATURES, type WebFeatureCard } from '../data/features';
import {
  BIOME_ROWS,
  RESOURCE_ROWS,
  STAGE_ROWS,
  SYSTEM_MECHANICS,
  TERRAFORM_OPS,
} from '../data/mechanics';
import {
  createCallout,
  createFeatureGrid,
  createSectionShell,
  createTable,
  makeEl,
} from './domHelpers';

const BETA_RISK_CARDS: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Automation Without CAPTCHA Gates',
    layer: 'WEB2',
    badge: 'D-25 · D-45',
    summary: 'Algorithmic trading and fleet bots are first-class citizens bounded by per-token spend allowances and rate limits rather than brittle anti-bot captchas.',
    chips: ['ACID Spend Caps', 'Instant Revocation'],
  },
  {
    title: 'Authoritative Cap Enforcement Split',
    layer: 'WEB3',
    badge: 'CUSTODY SPLIT',
    summary: 'Daily bot spend caps, staker fee discounts, and war siege objectives execute in `@terra/sim` + PostgreSQL ACID locks while NEAR holds custody, deeds, and escrows.',
    chips: ['@terra/sim Rules', 'NEAR Finality'],
  },
  {
    title: 'Tunable Scarcity & Emission Curve',
    layer: 'WEB2',
    badge: '7-DAY SIM',
    summary: 'Resource harvest curves, Guild spread sensitivity, and desert water multipliers are calibrated via our headless 7-day multi-colony economy simulator.',
    chips: ['/dev/economy-sim/', 'Zero Price Promise'],
  },
  {
    title: 'Full Provenance & Hackathon Scope',
    layer: 'WEB3',
    badge: 'DISCLOSED',
    summary: 'Repository history opens cleanly in the hackathon window (2026-10-29) with starter procedural visuals disclosed in README and live contracts verified on Testnet.',
    chips: ['6 Contracts Deployed', 'Open Audit Ledger'],
  },
];

export function buildGameplayAndEngineSections(): HTMLElement[] {
  const sec04 = createSectionShell(
    'sec-04',
    '04',
    'CORE GAMEPLAY // S0 TO S10',
    'Three-Tier Game Loop, Unlock Ladder & Skin-in-the-Game Diplomacy',
    'TerraAgent rewards both active 30-second RTS micro and multi-session strategic diplomacy: peace treaties lock real collateral, war bonds double raider loot for six hours, and the Away Director steers overnight production.',
  );
  sec04.append(
    createFeatureGrid(
      SYSTEM_MECHANICS.map((m) => ({
        title: m.title,
        layer: m.badge === 'DIPLOMACY' ? ('WEB3' as const) : ('WEB2' as const),
        badge: m.badge,
        summary: m.summary,
        chips: m.metrics,
      })),
    ),
    makeEl('h3', 'wp-subsection-h3', 'S0–S10 Colony Progression & Unlock Ladder'),
    createTable(
      ['Stage', 'Milestone Name', 'Advancement Condition', 'Unlocks & Capabilities'],
      STAGE_ROWS.map((r) => [r.stage, r.name, r.milestone, r.unlocks]),
    ),
  );

  const sec05 = createSectionShell(
    'sec-05',
    '05',
    'WORLD SYSTEMS // TERRAFORMING & ECONOMY',
    'Biomes, Terraforming Pipeline & Ten Regulated Commodities',
    'Every planet shapes a distinct supply puzzle: Desert colonies hold rich Iron and Silica but double Water costs; Ocean colonies must reclaim land from rising tides; Living hexes unlock T2 (30%) and T3 (70%) fabrication.',
  );
  sec05.append(
    makeEl('h3', 'wp-subsection-h3', 'Three Authoritative Biomes & Unifier Weathering'),
    createTable(
      ['Planet Biome', 'Terrain & Storm Hazards', 'Starting Economy Curve', 'Unifier Shader Finish'],
      BIOME_ROWS.map((b) => [b.name, b.terrainAndWeather, b.startingCurve, b.unifierShader]),
    ),
    makeEl('h3', 'wp-subsection-h3', 'Terraforming Operations'),
    createTable(
      ['Operation', 'Rule & Precondition', 'Resource Yield / Biome Effect'],
      TERRAFORM_OPS.map((t) => [t.op, t.rule, t.costAndEffect]),
    ),
    makeEl('h3', 'wp-subsection-h3', 'Ten Tradeable Commodities (+ Continuous Grid Energy)'),
    createTable(
      ['Commodity', 'Key', 'Family', 'Tier', 'Extraction & Living Gate', 'Primary Sinks & Markets'],
      RESOURCE_ROWS.map((r) => [r.id, r.label, r.family, r.tier, r.sourceAndGate, r.primarySink]),
    ),
  );

  const sec06 = createSectionShell(
    'sec-06',
    '06',
    'REALTIME ENGINE & WEB SURFACES',
    'Web2 Simulation Backbone, PostgreSQL Outbox & Exchange Surfaces',
    'Deterministic simulation runs across authoritative Node servers and browser Web Workers alike, feeding binary WebSocket world diffs, the PostgreSQL ACID orderbook, and live 3D inspection labs.',
  );

  const coreGrid = createFeatureGrid(WEB2_FEATURES);
  coreGrid.id = 'sub-web2-core';
  const surfacesH3 = makeEl('h3', 'wp-subsection-h3', 'Playable & Operational Web Surfaces');
  surfacesH3.id = 'sub-web2-surfaces';

  sec06.append(
    coreGrid,
    surfacesH3,
    createTable(
      ['Surface / Route', 'Runtime', 'Primary Capability'],
      [
        ['/landing.html & /pitchdeck/', 'Vite MPA + Three.js Orbit', 'Interactive 3D orbital landing (`terraagent.fun`), protocol schematic & pitch deck'],
        ['/play.html?planet=dune&skip=1', 'WebGL2 + WS / Web Worker', 'Live RTS gameplay with descent cinematics, `?host=local`, dev console & `F8` Shader Lab'],
        ['/trade.html', 'SSE + REST (`/v1/trade/*`)', '90-pair planetary CLOB orderbook, live depth ladder, 1Click swaps & `ta_bot_...` keys'],
        ['/me.html', 'REST (`/v1/me/*`)', 'Pilot dashboard, 60 soulbound badges, S0–S10 chronicle & AES-256-GCM BYOK vault'],
        ['/deed.html (`/deed/:tokenId`)', 'OpenGraph + NFT Feed', 'Shareable colony deed milestone timeline with generated preview artwork'],
        ['/dev/economy-sim/', 'Headless `@terra/sim`', '7-day multi-colony economy runner testing wars, truces, Guild AMM & TEE commanders'],
        ['/playground.html & /design/', '3D Storybook & Tokens', '4-view diagnostic model turntable (`&validate=1`), CI validators & Faction Plate tokens'],
      ],
    ),
    createCallout(
      'Simulation Parity Guarantee',
      'Online WebSocket rooms and offline `?host=local` Web Worker colonies run identical `@terra/sim` TypeScript code — ensuring offline tests match production combat, resource yields, and power shedding tick for tick.',
    ),
  );

  return [sec04, sec05, sec06];
}

export function mountCanonicalRisksSummary(): void {
  const host = document.getElementById('wpCanonicalRisksMount');
  if (!host) return;
  host.replaceChildren(createFeatureGrid(BETA_RISK_CARDS));
}
