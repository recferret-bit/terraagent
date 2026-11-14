export interface WebFeatureCard {
  readonly title: string;
  readonly layer: 'WEB2' | 'WEB3' | 'NEAR.AI';
  readonly badge: string;
  readonly summary: string;
  readonly chips: ReadonlyArray<string>;
}

export interface ContractSpec {
  readonly contract: string;
  readonly accountId: string;
  readonly txHash: string;
  readonly standard: string;
  readonly role: string;
  readonly guardAndSettlement: string;
}

export interface PortSpec {
  readonly port: string;
  readonly category: string;
  readonly mockBehavior: string;
  readonly liveImplementation: string;
}

export interface AiGuardrailRow {
  readonly control: string;
  readonly trigger: string;
  readonly enforcement: string;
}

export const WEB3_FEATURES: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Dual Settlement: Fast Sim + NEAR Finality',
    layer: 'WEB3',
    badge: 'HYBRID',
    summary: 'Five-tick-per-second gameplay never blocks on RPC latency. Asset custody, diplomacy bonds, deeds, council votes, and cargo bridges settle asynchronously across six Rust smart contracts.',
    chips: ['near-sdk 5.7', 'Testnet Live', '11 Typed Ports'],
  },
  {
    title: 'Gasless Meta-Transactions & Cold-Root Pilots',
    layer: 'WEB3',
    badge: 'NEP-366',
    summary: '`relayer.terraagent.testnet` sponsors DelegateAction gas so players never face seed-phrase popups, while `pilots` swaps to full self-custody via atomic `[AddKey, DeleteKey]` claim rotation.',
    chips: ['relayer.terraagent.testnet', 'SignedDelegate', 'claimAccount'],
  },
  {
    title: 'Orbital Cargo Multi-Tokens & 1Click Intents',
    layer: 'WEB3',
    badge: 'NEP-245',
    summary: 'Exported resources wrap cleanly into NEP-245 tokens on `res.terraagent.testnet` (18 decimals), clearing multi-party swaps in atomic counter-signed `NEP-413` `token_diff` intents and `1Click`.',
    chips: ['res.terraagent.testnet', 'NEP-413 token_diff', '1Click Swap'],
  },
  {
    title: 'Day-1 Lossless Staking & Zero Pay-to-Win',
    layer: 'WEB3',
    badge: 'LOSSLESS',
    summary: 'Human accounts stake NEAR on `staking.terraagent.testnet` from Day 1 (9.0% gross APY, 2 game-day unbond). Pilots keep 100% principal + 80% yield (7.20% APY); 20% funds Protocol.',
    chips: ['80/20 Yield Split', '10 NEAR Unlocks AI', 'Zero Combat Buffs'],
  },
  {
    title: '4-Way Trade Split & Peace/War Escrows',
    layer: 'WEB3',
    badge: 'D-44 + ESCROW',
    summary: 'Every matched order pays 100% principal to seller, 0–1.00% stall royalty to Trade Hub owners, 20% platform fee to Planet DAO, and 80% to Protocol. Breached truces or failed sieges slash 90/10.',
    chips: ['4-Way NEP-413 Split', '90/10 Bond Slash', 'Planet Council DAO'],
  },
  {
    title: 'Soulbound Colony Deeds & 60 Milestone Badges',
    layer: 'WEB3',
    badge: 'NEP-171',
    summary: 'Every founded colony mints a non-transferable deed on `deed.terraagent.testnet` whose metadata appends immutable chapters from S0 through S10 alongside 60 achievement badges.',
    chips: ['deed.terraagent.testnet', 'Append-only Chapters', 'Public /deed/:id'],
  },
];

export const WEB2_FEATURES: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Deterministic Shared Simulation (@terra/sim)',
    layer: 'WEB2',
    badge: '5 Hz / 50 Hz',
    summary: 'One pure TypeScript hex-grid state machine powers the authoritative server, offline Web Worker sandbox, client motion prediction, and instant 50 Hz replay warp without render drift.',
    chips: ['Zero Client Authority', 'Deterministic Ticks', 'Instant Warp'],
  },
  {
    title: 'Binary MsgPack WebSockets + 60 FPS Prediction',
    layer: 'WEB2',
    badge: 'REALTIME',
    summary: 'World diffs serialize via MessagePack over WebSockets while the Three.js diorama interpolates robots, cutter beams, and camera motion smoothly at 60 FPS.',
    chips: ['MessagePack WS', 'Lag & Jitter Hooks', 'Sequence Acks'],
  },
  {
    title: 'Full Offline Parity (Web Worker + IndexedDB)',
    layer: 'WEB2',
    badge: 'OFFLINE',
    summary: 'Launching with `?host=local` executes the exact same simulation ruleset inside a dedicated browser Web Worker persisted locally to IndexedDB.',
    chips: ['?host=local', 'Web Worker', 'IndexedDB Snapshots'],
  },
  {
    title: '17-Domain NestJS Server & ACID Postgres Outbox',
    layer: 'WEB2',
    badge: 'ACID DB',
    summary: 'Seventeen domain modules (sim loop, WS gateway, CLOB market, economy, AI, NEAR ports, profile, progression, notify, lobby, analytics) commit trades and chain intents atomically via PostgreSQL + Prisma.',
    chips: ['17 NestJS Modules', 'Prisma + Outbox', 'Acid Spend Locks'],
  },
  {
    title: 'Planetary CLOB Orderbook & Bot API',
    layer: 'WEB2',
    badge: 'EXCHANGE',
    summary: 'Full limit/market orderbooks across 10 resources paired against USDC, NEAR, or barter goods on `/trade.html`, streaming live depth via SSE alongside capped `ta_bot_...` keys.',
    chips: ['/trade.html', '/v1/trade/*', 'SSE Depth Stream'],
  },
  {
    title: 'Orbital Guild AMM & 24h VWAP Oracle',
    layer: 'WEB2',
    badge: 'AMM + VWAP',
    summary: 'Autonomous NPC freighters dock periodically and quote two-sided liquidity from live 24h organic VWAP using a readable power-law inventory curve (4%–15% spreads).',
    chips: ['kestrel & vanguard', '24h VWAP Anchor', '10% Off-Planet Sink'],
  },
  {
    title: 'Pilot Profile, 60 Badges & Public Colony Deeds',
    layer: 'WEB2',
    badge: 'IDENTITY',
    summary: 'Tracks 60 tiered achievement badges (20 families × Bronze/Silver/Gold across 30 levels), encrypted BYOK settings on `/me.html`, and shareable OpenGraph colony pages at `/deed/:tokenId`.',
    chips: ['/me.html', '60 Badges (20×3)', '/deed/:tokenId'],
  },
  {
    title: 'Web Surfaces, Pitchdeck & Faction Plate UI',
    layer: 'WEB2',
    badge: 'SURFACES',
    summary: 'Multi-entry Vite architecture spanning the orbital landing page (`/landing.html`), investor deck (`/pitchdeck/`), live RTS (`/play.html`), and Faction Plate design system (`/design/`).',
    chips: ['/landing.html', '/pitchdeck/', '/design/'],
  },
  {
    title: '3D Inspector, Shader Lab, 7-Day Sim & Validators',
    layer: 'WEB2',
    badge: 'TOOLING',
    summary: 'Built-in 4-view 3D storybook (`/playground.html`), in-game `F8` Shader Lab, 7-day multi-colony stress test (`/dev/economy-sim/`), and automated geometry/particle CI gates.',
    chips: ['/playground.html', 'F8 Shader Lab', 'CI Model Gates'],
  },
];

export const CONTRACT_ROWS: ReadonlyArray<ContractSpec> = [
  { contract: 'res', accountId: 'res.terraagent.testnet', txHash: '5reiQL5XddxLS9hDDmKrh1Nn4N8f5Ui9KjtqySvGejok', standard: 'NEP-245 Multi-Token', role: 'Orbital cargo balances across all 10 resource commodities', guardAndSettlement: '`mt_mint` / `mt_burn` / `operator_transfer` matched strictly to Cargo Escrow acks' },
  { contract: 'deed', accountId: 'deed.terraagent.testnet', txHash: 'E1AGHyMmzCGdsRqvoMVjqWqVQGGkuRu3djQzuRj3wRGK', standard: 'NEP-171 Soulbound', role: 'Non-transferable Colony Deeds, milestone chapters, and badges', guardAndSettlement: 'Append-only server signer chronicle from S0 through S10' },
  { contract: 'bounty', accountId: 'bounty.terraagent.testnet', txHash: '21F1c5TdGtgcAhoTMPRMkHCYvQ15USqo4fpxBrXU8UAB', standard: 'Escrow State Machine', role: 'Defense bounties, Peace Treaties (2h–72h), and 6h War Bonds', guardAndSettlement: '`open_escrow` / `claim_escrow` / `refund_escrow` / `slash_escrow` (90% victim, 10% Protocol)' },
  { contract: 'staking', accountId: 'staking.terraagent.testnet', txHash: '5UvHFrKUocqf5JewptneZqGeXgXkJQZaeVMPfHTrusX2', standard: 'Lossless Validator Vault', role: 'Day-1 native NEAR staking (9.0% gross APY) & 10 NEAR AI unlock', guardAndSettlement: '100% principal safe (2-day unbond); configurable 80/20 yield split & protocol yield claim' },
  { contract: 'dao', accountId: 'dao.terraagent.testnet', txHash: 'DmsGYQ7VBajz1rRC5FKxNarnnddhs5CzeVgfJc6mqx5U', standard: 'Planet Council Voting', role: 'Meteor shield, terraform boost, and guild subsidy proposals', guardAndSettlement: 'Living-tile + tier-weighted > 50% quorum with epoch cooldowns' },
  { contract: 'pilots', accountId: 'pilots.terraagent.testnet', txHash: 'cSTqNFu5aQKb9MiJwantuhxj4Hwn3T2D4WbhCHJAr2h', standard: 'Cold-Root Factory', role: 'Instant pilot sub-accounts and scoped bot session keys', guardAndSettlement: 'Gasless creation + atomic `[AddKey, DeleteKey]` self-custody upgrade' },
];

export const PORT_ROWS: ReadonlyArray<PortSpec> = [
  { port: 'ChainReadPort', category: 'Core Read', mockBehavior: 'In-memory seeded JSON state', liveImplementation: 'FastNEAR RPC JSON view calls' },
  { port: 'IdentityPort', category: 'Auth', mockBehavior: 'Local ephemeral session keypair', liveImplementation: 'NEAR Wallet & `NEP-413` signature auth' },
  { port: 'RelayerPort', category: 'Gasless UX', mockBehavior: 'Simulated instant tx receipt', liveImplementation: 'Sponsored `NEP-366` DelegateAction broadcaster' },
  { port: 'CargoTokenPort', category: 'Assets', mockBehavior: 'PostgreSQL mock token ledger', liveImplementation: '`res` `NEP-245` mint, burn & transfer' },
  { port: 'IntentsPort', category: 'Trading', mockBehavior: 'Local order matcher verification', liveImplementation: 'Signed `NEP-413` `token_diff` + `1Click` quotes' },
  { port: 'AgentWalletPort', category: 'Automation', mockBehavior: 'Simulated spend cap counter', liveImplementation: 'Scoped session key + ACID allowance lock' },
  { port: 'DeedNftPort', category: 'Identity', mockBehavior: 'Local deed milestone record', liveImplementation: '`deed` `NEP-171` mint & metadata append' },
  { port: 'BadgeNftPort', category: 'Progression', mockBehavior: '60 DB badge unlocks (20×3)', liveImplementation: 'On-chain soulbound badge proofs' },
  { port: 'EscrowPort', category: 'Diplomacy', mockBehavior: 'Simulated truce & war bond book', liveImplementation: '`bounty` lock, claim, refund & 90/10 slash' },
  { port: 'StakingPort', category: 'Yield', mockBehavior: 'Simulated epoch reward clock', liveImplementation: '`staking` pool (80/20 split, human-only)' },
  { port: 'TreasuryDaoPort', category: 'Governance', mockBehavior: 'Local council vote tally', liveImplementation: '`dao` policy proposal & execution' },
];

export const AI_GUARDRAIL_ROWS: ReadonlyArray<AiGuardrailRow> = [
  {
    control: 'Hardware TEE Inference',
    trigger: 'Every autonomous commander turn (`z-ai/glm-5.3-flash`)',
    enforcement: 'Executed inside NEAR AI Cloud Intel TDX + NVIDIA TEEs; prompt and decision hash signed via `/v1/signature/{chat_id}` and saved in the colony audit log.',
  },
  {
    control: 'Encrypted BYOK Vault (`/me.html`)',
    trigger: 'Player attaches personal NEAR.AI key & custom model ID',
    enforcement: 'Encrypted at rest using authenticated AES-256-GCM; plaintext secret keys are never echoed in HTTP responses or worker logs.',
  },
  {
    control: 'Staking Isolation (`403 AI_STAKING_FORBIDDEN`)',
    trigger: 'Any AI or bot token calls stake, unstake, or withdraw',
    enforcement: 'HTTP and service boundaries reject non-human callers outright before touching StakingPort.',
  },
  {
    control: 'Bounded Autonomy (`AW-10` / `AW-13` + Revision)',
    trigger: 'Away orders, truce/war controls, and NEAR bond checks',
    enforcement: '`AW-10` blocks structure demolition; `AW-13` blocks breaking active peace treaties, canceling wars, or bonding human NEAR; stale `intentRevision` aborts on human click.',
  },
];
