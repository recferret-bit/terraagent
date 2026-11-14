import {
  AI_GUARDRAIL_ROWS,
  CONTRACT_ROWS,
  PORT_ROWS,
  WEB3_FEATURES,
  type WebFeatureCard,
} from '../data/features';
import {
  createCallout,
  createFeatureGrid,
  createSectionShell,
  createTable,
  makeEl,
} from './domHelpers';
import {
  createAiPipelineSchema,
  createCustodyLifecycleSchema,
  createProtocolEconomySchema,
  createReceiptExamplesGrid,
  createTrustStackSchema,
} from './schemas';

const NEARBLOCKS = 'https://testnet.nearblocks.io';

const INCOME_LANE_CARDS: ReadonlyArray<WebFeatureCard> = [
  {
    title: '01 · Export Scarce Cargo (100% Proceeds)',
    layer: 'WEB3',
    badge: 'NEP-245',
    summary: 'Mine biome-abundant Iron, Titanium, Crystal, or Petroleum, export through a Trade Hub into NEP-245 tokens on `res.terraagent.testnet`, and sell for USDC or NEAR.',
    chips: ['100% Principal to Seller', 'Biome Scarcity Edge'],
  },
  {
    title: '02 · Trade Hub Stall Royalties (0–1.00%)',
    layer: 'WEB3',
    badge: 'MAKER FEE',
    summary: 'Every Trade Hub acts as a commercial storefront. Owners set a 0–100 bp maker fee and collect passive quote-token royalties whenever counterparties fill resting orders.',
    chips: ['0–100 bp Configurable', 'Paid on Every Fill'],
  },
  {
    title: '03 · Scoped Trading Bots & Arbitrage',
    layer: 'NEAR.AI',
    badge: 'BOT API',
    summary: 'Operate market-making bots on `/trade.html` using `ta_bot_...` keys with strict PostgreSQL ACID daily token limits and instant human revocation (`/v1/trade/kill`).',
    chips: ['Capped Daily Spend', 'Zero Wallet Drain'],
  },
  {
    title: '04 · Defense Bounties & 90% Bond Slashes',
    layer: 'WEB3',
    badge: 'ESCROW',
    summary: 'Claim mercenary raid bounties, hold Bonded Peace Treaties against oathbreakers, or repel a 6h War Bond siege to claim 90% of the forfeited NEAR or cargo bond.',
    chips: ['bounty.terraagent.testnet', '90% Victim / 10% Protocol'],
  },
];

const AI_ACCESS_MODES: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Managed Server NEAR.AI (>= 10 NEAR Stake)',
    layer: 'WEB3',
    badge: 'INCLUDED PERK',
    summary: 'Pilots staking 10 NEAR or more on Day 1 unlock batched `z-ai/glm-5.3-flash` TEE autonomy and a 50% trade fee discount with zero setup — financed organically out of the 20% staking yield slice.',
    chips: ['Zero Setup', '50% Trade Fee Cut', 'Zero Combat P2W'],
  },
  {
    title: 'Personal Encrypted BYOK Vault (/me.html)',
    layer: 'NEAR.AI',
    badge: 'CUSTOM MODEL',
    summary: 'Prefer another NEAR AI Cloud model (DeepSeek, Llama, Qwen, or GPT-compatible endpoints) without staking? Save a personal key on `/me.html` encrypted at rest with AES-256-GCM.',
    chips: ['AES-256-GCM Vault', 'Any Custom Model ID', 'Attested Logs'],
  },
];

function buildThesisSection(): HTMLElement {
  const sec00 = createSectionShell(
    'sec-00',
    '00',
    'EXECUTIVE THESIS // TRUST BOUNDARY',
    'The Economy Is the Gameplay — Not a Side Token',
    'Traditional strategy games pause when you close your tab and balance scarcity by hand. Early Web3 games flipped it backwards by putting a speculative token ahead of fun. TerraAgent merges a deterministic 5 Hz colony RTS with non-dilutive NEAR settlement and hardware-attested NEAR.AI commanders.',
  );

  sec00.append(
    createCallout(
      'Why Both Layers Exist',
      'Fast hex physics, unit pathfinding, and grid power live in `@terra/sim` at 5 ticks/sec with zero RPC stalls. Custody of exported cargo, soulbound colony deeds, lossless staking principal, peace/war collateral, and verifiable AI signatures live on NEAR Protocol.',
    ),
    createTrustStackSchema(),
    createTable(
      ['Architecture Pillar', 'Engineering Mechanism', 'Concrete Player Guarantee'],
      [
        ['Kitbash & GPU 3D', 'Modular RoundedBox hulls, `aPartAnim` kinematics, Unifier biome shader & instanced 3D debris', 'Readable 4-view silhouettes, < 3.5k tris/unit, zero flat sprite particles'],
        ['Deterministic Sim', 'Single `@terra/sim` shared across NestJS, browser Web Workers & 50 Hz warp replay', 'Zero server/client desync; full offline parity via `?host=local`'],
        ['Non-Dilutive Web3', 'Six Rust contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`) + gasless `NEP-366`', 'Real asset & treaty ownership; zero combat or harvest power from staking'],
        ['Verifiable NEAR.AI', 'Intel TDX + NVIDIA TEE turns (`/v1/signature`) + encrypted BYOK + 4 hard guardrails', 'Overnight colony commander you can audit without custody risk'],
      ],
    ),
  );
  return sec00;
}

function buildWeb3ProtocolSection(): HTMLElement {
  const sec01 = createSectionShell(
    'sec-01',
    '01',
    'WEB3 ON NEAR PROTOCOL // 6 CONTRACTS',
    'First-Class Agent Accounts, Gasless Play & Six NEAR Contracts',
    'Every actor holding economic value — human pilot, colony sub-account, external bot, Orbital Guild NPC, and TerraAgent Protocol itself — operates on explicit NEAR accounts behind eleven swappable backend ports.',
    'web3',
  );

  const featGrid = createFeatureGrid(WEB3_FEATURES);
  featGrid.id = 'sub-web3-accounts';

  const custodySchema = createCustodyLifecycleSchema();
  custodySchema.id = 'sub-web3-custody';

  const contractsH3 = makeEl('h3', 'wp-subsection-h3', 'Six Deployed near-sdk 5.7 Smart Contracts');
  contractsH3.id = 'sub-web3-contracts';

  const portsH3 = makeEl('h3', 'wp-subsection-h3', 'Eleven Typed NEAR Ports (Local Mock vs Live Chain Parity)');
  portsH3.id = 'sub-web3-ports';

  sec01.append(
    featGrid,
    custodySchema,
    contractsH3,
    createTable(
      ['Contract', 'Testnet Account', 'Standard & Pattern', 'On-Chain Role & Settlement Rule', 'Deploy Tx'],
      CONTRACT_ROWS.map((c) => [
        `\`${c.contract}\``,
        `[${c.accountId}](${NEARBLOCKS}/address/${c.accountId})`,
        c.standard,
        `${c.role} — ${c.guardAndSettlement}`,
        `[${c.txHash.slice(0, 8)}…](${NEARBLOCKS}/txns/${c.txHash})`,
      ]),
    ),
    portsH3,
    createTable(
      ['Typed Port', 'Domain', 'Offline Sandbox Driver', 'Live NEAR Testnet / Mainnet Driver'],
      PORT_ROWS.map((p) => [p.port, p.category, p.mockBehavior, p.liveImplementation]),
    ),
  );
  return sec01;
}

function buildEconomyAndIncomeSection(): HTMLElement {
  const sec02 = createSectionShell(
    'sec-02',
    '02',
    'INCOME, STAKING & PROTOCOL TREASURY',
    'How Players Earn, Day-1 Lossless Staking & Protocol Cashflows',
    'Zero inflationary emissions: every credit earned by players, bot operators, stakers, and `protocol.terraagent.testnet` traces back to commodity arbitrage, marketplace fees, real NEAR validator yield, or forfeited truce and war collateral.',
    'web3',
  );

  const lanesH3 = makeEl('h3', 'wp-subsection-h3', 'Four Player & Agent Income Lanes');
  lanesH3.id = 'sub-econ-lanes';

  const schematicH3 = makeEl('h3', 'wp-subsection-h3', 'Protocol Treasury Conduit & 4-Way Atomic Clearing');
  schematicH3.id = 'sub-econ-schematic-h3';

  const receiptsH3 = makeEl('h3', 'wp-subsection-h3', 'Concrete Numeric Settlement Receipts');
  receiptsH3.id = 'sub-econ-examples-h3';

  sec02.append(
    lanesH3,
    createFeatureGrid(INCOME_LANE_CARDS),
    schematicH3,
    createProtocolEconomySchema(),
    receiptsH3,
    createReceiptExamplesGrid(),
    createCallout(
      'Fair Staking Guarantee (Zero Pay-to-Win)',
      'Day-1 staking rewards pilots with 80% of pool yield (7.20% net APY), unlocks Managed `NEAR.AI`, and cuts platform trade fees in half (1.00% to 0.50%). `@terra/sim` rejects any staking lookup during resource harvesting or combat — wallets never boost unit damage.',
    ),
  );
  return sec02;
}

function buildAiSection(): HTMLElement {
  const sec03 = createSectionShell(
    'sec-03',
    '03',
    'NEAR.AI TEE AUTONOMY // GUARDRAILS',
    'Verifiable AI Commanders, Encrypted BYOK & Hard Custody Rails',
    'Autonomous Rival colonies and offline Away Directors make tactical decisions inside hardware-attested TEEs on NEAR AI Cloud — while server and smart-contract boundaries prevent AI from touching staked NEAR, demolishing buildings, or betraying truces.',
    'ai',
  );

  const accessH3 = makeEl('h3', 'wp-subsection-h3', 'Managed Staker Autopilot vs Personal BYOK');
  accessH3.id = 'sub-ai-byok';

  const guardsH3 = makeEl('h3', 'wp-subsection-h3', 'Orbital Guild Pricing Rule & Hard Guardrail Enforcement');
  guardsH3.id = 'sub-ai-guards';

  sec03.append(
    createAiPipelineSchema(),
    accessH3,
    createFeatureGrid(AI_ACCESS_MODES),
    guardsH3,
    createCallout(
      'Orbital Guild Merchant Pricing Formula',
      'Guild freighters (`kestrel`, `vanguard`) quote transparent spreads via `mid = reference * (targetInventory / currentInventory)^k`, anchored to each planet’s trailing 24-hour organic VWAP with thin-side spreads widening cleanly from 4% to 15%.',
    ),
    createTable(
      ['Security Control', 'When Triggered', 'Hard Enforcement Mechanism'],
      AI_GUARDRAIL_ROWS.map((a) => [a.control, a.trigger, a.enforcement]),
    ),
  );
  return sec03;
}

export function buildWeb3AndAiSections(): HTMLElement[] {
  return [
    buildThesisSection(),
    buildWeb3ProtocolSection(),
    buildEconomyAndIncomeSection(),
    buildAiSection(),
  ];
}
