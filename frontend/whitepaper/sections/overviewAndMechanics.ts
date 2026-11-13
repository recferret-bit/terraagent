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

export function buildOverviewAndMechanicsSections(): HTMLElement[] {
  const sec00 = createSectionShell(
    'sec-00',
    '00',
    'ARCHITECTURE THESIS',
    'Executive Thesis & Four Architecture Pillars',
    'TerraAgent pairs a deterministic 5 Hz real-time planetary colony simulator (`@terra/sim`) with verifiable NEAR.AI TEE commanders and six Rust `near-sdk 5.7` settlement contracts — keeping fast gameplay responsive in Web2 while anchoring value, provenance and treaties in Web3.',
  );
  sec00.append(
    createCallout(
      'Trust & Gameplay Boundary',
      'Core loop simulation runs identically in browser Web Workers (`?host=local`) and authoritative NestJS nodes at 5 ticks/sec. Blockchain settlement happens asynchronously across typed NEAR ports (`mock` / `testnet` / `mainnet`) without blocking a single frame or robot order.',
    ),
    createTable(
      ['Pillar', 'Mechanism', 'Player Value', 'Guarantee'],
      [
        ['1. Kitbash & 3D VFX', 'Modular kitbash hulls + GPU `aPartAnim` + Unifier biome shader + instanced 3D particles', 'Zero flat sprites; readable silhouettes in 4 views', '< 3.5k tris/unit, 0 validator errors'],
        ['2. Deterministic Web2', 'Single `@terra/sim` ruleset shared by NestJS, Workers, `/play.html` & `/dev/economy-sim/`', 'Zero server/client drift; instant 50 Hz replay warp', 'MsgPack WS + 60 FPS prediction'],
        ['3. Non-Dilutive Web3', 'Six Rust contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`) + NEP-366 gasless UX', 'True custody of cargo, soulbound deeds & peace bonds', 'Zero combat stats from NEAR stake'],
        ['4. Verifiable NEAR.AI', 'Hardware TEE inference (`z-ai/glm-5.3-flash`) + encrypted BYOK keys + 4 hard guardrails', 'Autonomous overnight commander you can audit', '403 staking isolation + spend caps'],
      ],
    ),
  );

  const sec01 = createSectionShell(
    'sec-01',
    '01',
    'SIMULATION LOOP',
    'Game Loop Cadence & Stage Progression (S0–S10)',
    'Every colony opens with a single Orbital Drop Carrier landing a Command Hub and one multi-tool Hero Bot (`S0`), climbing through industrial power, biosphere terraforming (`30%` T2 / `70%` T3) and orbital logistics up to the `S10` Ascension Rocket.',
  );
  sec01.append(
    createFeatureGrid(
      SYSTEM_MECHANICS.slice(0, 2).map((m) => ({
        title: m.title,
        layer: 'WEB2' as const,
        badge: m.badge,
        summary: m.summary,
        chips: m.metrics,
      })),
    ),
    makeEl('h3', 'wp-subsection-h3', 'S0–S10 Milestone & Building Unlock Ladder'),
    createTable(
      ['Stage', 'Title', 'Advancement Condition', 'Unlocks & Capabilities'],
      STAGE_ROWS.map((r) => [r.stage, r.name, r.milestone, r.unlocks]),
    ),
  );

  const sec02 = createSectionShell(
    'sec-02',
    '02',
    'PLANET SYSTEMS',
    'Biomes, Terraforming Pipeline, Power Grid & 10 Resources',
    'Landscapes are active industrial puzzles: reshaping elevation clears build pads, uncovers 1% subsurface ore finds, pipes Hydro water into Irrigate trenches, and converts barren hexes into Living terrain that weighs Planet DAO voting.',
  );
  sec02.append(
    makeEl('h3', 'wp-subsection-h3', 'Three Authoritative Biomes & Unifier Weathering'),
    createTable(
      ['Planet Biome', 'Terrain & Weather Hazards', 'Early Economy Curve', 'Unifier Shader Pass'],
      BIOME_ROWS.map((b) => [b.name, b.terrainAndWeather, b.startingCurve, b.unifierShader]),
    ),
    makeEl('h3', 'wp-subsection-h3', 'Terraforming Pipeline Operations'),
    createTable(
      ['Operation', 'Rule & Precondition', 'Resource Yield / Biome Effect'],
      TERRAFORM_OPS.map((t) => [t.op, t.rule, t.costAndEffect]),
    ),
    makeEl('h3', 'wp-subsection-h3', 'Ten Colony Resources (+ Grid Energy) Across Three Families'),
    createTable(
      ['Resource Key', 'Name', 'Family', 'Tier', 'Production & Biome Gates', 'Primary Sinks & Markets'],
      RESOURCE_ROWS.map((r) => [r.id, r.label, r.family, r.tier, r.sourceAndGate, r.primarySink]),
    ),
  );

  const sec03 = createSectionShell(
    'sec-03',
    '03',
    'CONFLICT & AUTONOMY',
    'Diplomacy, War Escrows, Ruin Decay & Away Director',
    'Multiplayer conflict is structured around enforceable crypto-economic consequences rather than griefing: peace treaties lock collateral on-chain, sudden betrayals trigger a 24-hour Oathbreaker penalty, and the Away Director safeguards sleeping players.',
  );
  sec03.append(
    createFeatureGrid(
      SYSTEM_MECHANICS.slice(2).map((m) => ({
        title: m.title,
        layer: 'WEB3' as const,
        badge: m.badge,
        summary: m.summary,
        chips: m.metrics,
      })),
    ),
    createCallout(
      'Elimination & Ruin Transition',
      'Defeated colonies transition visibly via GPU/shader state (`setArchetypeRuin(true)`) into scorched wreckage (`building.*` charred patina) while survivors recover scrap and the falling HQ records a chapter on its permanent `/deed/:tokenId` history.',
    ),
  );

  return [sec00, sec01, sec02, sec03];
}
