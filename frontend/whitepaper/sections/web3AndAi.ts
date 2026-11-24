import {
  AI_GUARDRAIL_ROWS,
  CONTRACT_ROWS,
  PORT_ROWS,
  PROTOCOL_ACCOUNT_ROWS,
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
    title: '5 Free TEE Turns + 4-Tier Multi-Colony Staker AI (10–500+ NEAR)',
    layer: 'WEB3',
    badge: 'INCLUDED PERK',
    summary: 'Verified pilots receive 5 free `z-ai/glm-5.3-flash` TEE trial turns on 1 colony; staking `10 / 50 / 200 / 500+ NEAR` wallet-first unlocks `1 / 3 / 6 / 12` concurrent colonies + managed `z-ai/glm-5.3-flash` slots across planets or distinct sectors (never two colonies in the same sector, `>= 65%` USD margin) and `0.65% → 0.25%` taker fees with zero combat buffs.',
    chips: ['GLM 5.3 Flash Managed', '1–12 Colony Slots', 'Distinct Sectors Only'],
  },
  {
    title: 'Personal Encrypted BYOK Vault (/me.html)',
    layer: 'NEAR.AI',
    badge: 'CUSTOM MODEL',
    summary: 'Model selection stays locked to `z-ai/glm-5.3-flash` until you enter a valid NEAR AI Cloud API key on `/me.html` (encrypted at rest via AES-256-GCM), unlocking `GLM-5.3`, `DeepSeek V3.2`, `DeepSeek V4.1 Flash`, `Qwen 3.8 27B`, `GPT-5 Mini`, `Claude Sonnet 4.6`, or any custom model ID.',
    chips: ['API Key Unlocks Dropdown', 'AES-256-GCM Vault', '7 Presets + Custom ID'],
  },
];

const SWARM_AND_AGENT_CARDS: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Hosted MCP Server (/v1/mcp) & Agent RFQ',
    layer: 'NEAR.AI',
    badge: 'MCP JSON-RPC',
    summary: 'External NEAR AI, Claude, and Cursor agents discover pair schemas at `GET /v1/mcp/agent-market.json`, inspect books/quotes, place authenticated signed intent orders over `POST /v1/mcp`, and settle bilateral quotes via `/v1/trade/agent/rfq`.',
    chips: ['agent-market.json', 'POST /v1/mcp', 'POST /v1/trade/agent/rfq'],
  },
  {
    title: '25-Sub-Account Zero-LLM Swarm & Shade MPC',
    layer: 'NEAR.AI',
    badge: 'AI SWARMS + MPC',
    summary: 'Twenty cohort buyers (`buyer-01..20.swarm.terraagent.testnet`) and five sellers clear deterministic uniform auctions (`zeroLlmCalls: true`) with verified `NEP-413` `sum(token_diff) == 0` conservation, alongside decentralized **Shade Agents** + **Chain Signatures MPC (`v1.signer`)** workers.',
    chips: ['20 Buyers × 5 Sellers', 'Uniform Clearing', 'Shade + v1.signer MPC'],
  },
  {
    title: 'Contractor Agents & 1-Round Negotiation',
    layer: 'NEAR.AI',
    badge: 'AGENT COMMERCE',
    summary: 'Colony contractors (`verdant-collective.terraagent.testnet`) decompose multi-step goals within hard `USDC`/`NEAR` budgets, run 1-round benchmark counter-quote negotiation (`negotiateAgentQuote`), hire patrol escorts via `bounty.terraagent.testnet`, or walk away to local smelting, emitting signed `AgentTaskReceipt` proofs.',
    chips: ['1-Round Counter-Quote', 'Walk-Away Cap', 'AgentTaskReceipt'],
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
        ['Non-Dilutive Web3', 'Six deployed contracts + `verifier` crate (`172` Rust tests), `1Click` ramp & Shade MPC', 'Real asset & treaty ownership; scoped self-custody session keys'],
        ['Verifiable NEAR.AI', 'NEAR AI Cloud confidential enclave (`SHA-256` `model:request:response` ECDSA/Ed25519) + browser curve verifier + Hosted MCP `/v1/mcp`', 'Governed autonomy you can independently verify in-browser'],
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

  const contractsH3 = makeEl('h3', 'wp-subsection-h3', 'Six Deployed near-sdk 5.7 Contracts + Standalone Verifier Crate');
  contractsH3.id = 'sub-web3-contracts';

  const accountsH3 = makeEl('h3', 'wp-subsection-h3', 'Four Core Protocol & Gas-Paying Operator Accounts');
  accountsH3.id = 'sub-web3-operator-accounts';

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
        c.txHash ? `[${c.accountId}](${NEARBLOCKS}/address/${c.accountId})` : `\`${c.accountId}\` (workspace)`,
        c.standard,
        `${c.role} — ${c.guardAndSettlement}`,
        c.txHash ? `[${c.txHash.slice(0, 8)}…](${NEARBLOCKS}/txns/${c.txHash})` : 'Pre-deploy WASM',
      ]),
    ),
    accountsH3,
    createTable(
      ['Key', 'Testnet Account', 'Role', 'Gas & Security Responsibility', 'Latest Proof Tx'],
      PROTOCOL_ACCOUNT_ROWS.map((a) => [
        `\`${a.key}\``,
        `[${a.accountId}](${NEARBLOCKS}/address/${a.accountId})`,
        a.role,
        a.gasAndSecurityModel,
        `[${a.txHash.slice(0, 8)}…](${NEARBLOCKS}/txns/${a.txHash})`,
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

const STAKING_TIER_TABLE_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ['`T0 Cadet`', '`0\u00A0NEAR`', '`1.00%` (`100\u00A0bp`)', '`1` colony (`5` free TEE turns, then Script AI)', 'Script AI · `1×` gas · `1` bot', '— · `1.0×`', 'Standard Hull'],
  ['`T1 Scout`', '`10\u00A0NEAR`', '`0.65%` (instant)', '`1` colony · `1` GLM 5.3 Flash slot', '`120s` sweep · `2×` gas · `1` bot', '— · `1.0×`', 'Cyan Uplink + Quantum Dish'],
  ['`T2 Commander`', '`50\u00A0NEAR`', '`0.50%` (`24h` warmup)', '`3` colonies · `3` GLM 5.3 Flash slots', '`60s` sweep · `4×` gas · `3` bots', '`5\u00A0min` · `1.0×`', 'Plasma Trail + Cyan Cutters'],
  ['`T3 Archon`', '`200\u00A0NEAR`', '`0.35%` (`24h` warmup)', '`6` colonies · `6` GLM 5.3 Flash slots', '`30s` sweep · `8×` gas · `3` bots', '`5\u00A0min` · `1.5×`', 'Gold Command Hub + Plume'],
  ['`T4 Patron`', '`500+\u00A0NEAR`', '`0.25%` (`24h` warmup)', '`12` colonies · `12` GLM 5.3 Flash slots', '`30s` sweep · `15×` gas · `3` bots', '`5\u00A0min` · `1.5×`', 'Lead Patron (`15%` Protocol cut = `12%` gross) + Flagship'],
];

const STAKING_RULE_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ['4 Profit & Effective APY Streams', '80% net validator APY (`7.20%` Sim / live on Mainnet) + taker fee savings (`1.00% → 0.65%–0.25%`) + stake-blind Trade Hub stall royalties (`0–1.00%`) + Tier 4 Lead Patron revenue (`15%` of Protocol cut = `12%` of gross on standard 20% DAO fills). Self-fills excluded.'],
  ['Anti-Snipe 24h Warmup & Reset', 'Tier 1 (`65 bp`) activates at `t=0`. Tier 2–4 fee cuts unlock after `24h` continuous stake (`1 min` in local mode). Crossing `< 50 → >= 50 NEAR` resets `stakedSinceMs` (single-pool & cross-pool); `>= 50 NEAR` top-ups preserve it.'],
  ['Early Exit, Compound & Unbonding', 'Unstaking `< 7 days` after latest deposit pays `0.25%` (`25 bp`) to `protocol.<root>` (`0%` after `7d`). `compound_yield` is `0%` fee and never resets maturity/warmup clocks. Unbonding takes `4 epochs` (~`2 game-days`); unbonding principal is excluded from tiers immediately.'],
  ['Managed AI Budget & Zero P2W', 'Daily wallet AI cap = `35% × (daily protocol yield USD + daily non-self protocol trade-fee USD)` (`>= 65%` margin; DAO & Patron cuts deducted; `$0.0000375`/turn on `z-ai/glm-5.3-flash`). Trade Hub stall cap stays `0–1.00%` for all tiers; `@terra/sim` never reads staking (`D-31`).'],
  ['Lead Planetary Patron & Solvency', 'Top active `>= 500 NEAR` staker on each of the 3 canonical worlds (`Kharon Dunes`, `Thalassa Verde`, `Granite Hollow`; sovereign NFT worlds excluded) automatically holds the Lead Patron seat. Native-backing solvency guard + optional `op_id` idempotency protect on-chain positions.'],
];

function buildEconomyAndIncomeSection(): HTMLElement {
  const sec02 = createSectionShell(
    'sec-02',
    '02',
    'INCOME, STAKING & PROTOCOL TREASURY',
    'How Players Earn, 4-Tier Lossless Staking & Protocol Cashflows',
    'Zero inflationary emissions: every credit earned by players, bot operators, stakers, and `protocol.terraagent.testnet` traces back to commodity arbitrage, marketplace fees, real NEAR validator yield, or forfeited truce and war collateral.',
    'web3',
  );

  const lanesH3 = makeEl('h3', 'wp-subsection-h3', 'Four Player & Agent Income Lanes');
  lanesH3.id = 'sub-econ-lanes';

  const tiersH3 = makeEl('h3', 'wp-subsection-h3', '4-Tier Orbital Patronage Matrix (Wallet-First, Zero Pay-to-Win)');
  tiersH3.id = 'sub-econ-tiers';

  const rulesH3 = makeEl('h3', 'wp-subsection-h3', 'Staker Profit Streams, Anti-Snipe Warmup & Exit Rules');
  rulesH3.id = 'sub-econ-rules';

  const schematicH3 = makeEl('h3', 'wp-subsection-h3', 'Protocol Treasury Conduit & 4-Way Atomic Clearing');
  schematicH3.id = 'sub-econ-schematic-h3';

  const receiptsH3 = makeEl('h3', 'wp-subsection-h3', 'Concrete Numeric Settlement Receipts');
  receiptsH3.id = 'sub-econ-examples-h3';

  sec02.append(
    lanesH3,
    createFeatureGrid(INCOME_LANE_CARDS),
    tiersH3,
    createTable(
      ['Tier', 'Min Stake', 'Taker Fee', 'Colonies & Managed AI', 'Sweep · Gas · Bots', 'Radar · DAO', 'Patronage & 3D Prestige'],
      STAKING_TIER_TABLE_ROWS,
    ),
    rulesH3,
    createTable(['Rule / Profit Mechanism', 'Exact Specification'], STAKING_RULE_ROWS),
    schematicH3,
    createProtocolEconomySchema(),
    receiptsH3,
    createReceiptExamplesGrid(),
    createCallout(
      'Fair Staking Guarantee (Zero Pay-to-Win)',
      'Wallet-first 4-Tier Orbital Patronage rewards pilots with 80% of pool yield (7.20% net Sim APY on testnet; live APY on mainnet), 1–12 Managed `NEAR.AI` colony slots, and progressive trade-fee cuts (`1.00% → 0.65%` instant `→ 0.50% / 0.35% / 0.25%` after `24h` warmup). `@terra/sim` never reads staking (`D-31`) — wallets never boost unit damage or mining speed.',
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

  const accessH3 = makeEl('h3', 'wp-subsection-h3', 'Managed Staker Autopilot, BYOK, 25-Agent Swarms & Contractor Commerce');
  accessH3.id = 'sub-ai-byok';

  const guardsH3 = makeEl('h3', 'wp-subsection-h3', 'Orbital Guild Pricing Rule & Hard Guardrail Enforcement');
  guardsH3.id = 'sub-ai-guards';

  sec03.append(
    createAiPipelineSchema(),
    accessH3,
    createFeatureGrid([...AI_ACCESS_MODES, ...SWARM_AND_AGENT_CARDS]),
    guardsH3,
    createCallout(
      'Orbital Guild Merchant Pricing Formula',
      'Guild freighters (`kestrel`, `vanguard`) quote transparent spreads via `mid = ref * clamp((T + 10) / (I + 10), 0.50, 2.00)^0.5`, anchored to each planet’s trailing 24-hour organic VWAP (min 3 eligible fills) with half-spreads widening from 2% (4% full spread) to 15% on the thin inventory side.',
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
