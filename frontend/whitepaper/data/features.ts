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

export interface ProtocolAccountSpec {
  readonly key: string;
  readonly accountId: string;
  readonly role: string;
  readonly gasAndSecurityModel: string;
  readonly txHash: string;
}

export const WEB3_FEATURES: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Dual Settlement: Fast Sim + NEAR Finality',
    layer: 'WEB3',
    badge: 'HYBRID',
    summary: 'Five-tick-per-second gameplay never blocks on RPC latency. Asset custody, diplomacy bonds, deeds, council votes, cargo bridges, and Shade Agent MPC flows settle across six deployed contracts plus our standalone verifier crate (169 Rust tests).',
    chips: ['near-sdk 5.7', 'Testnet + verifier', '11 Typed Ports'],
  },
  {
    title: 'Gasless Meta-Transactions & Scoped Session Keys',
    layer: 'WEB3',
    badge: 'NEP-366',
    summary: '`pilots.terraagent.testnet` provisions `{pilot}.pilots.terraagent.testnet`, authenticated `POST /v1/near/relay` shares daily relayer gas budgets, and `claimAccount` rotates `[AddKey, DeleteKey]` across 10 NEAR wallets (incl. Bitte AI & HOT) while optionally sealing a revocable trading session key.',
    chips: ['10 NEAR Wallets', 'Scoped Session Key', 'claimAccount'],
  },
  {
    title: 'Orbital Cargo, 1Click Ramp & Hosted MCP',
    layer: 'WEB3',
    badge: 'NEP-245',
    summary: 'Exported resources wrap into NEP-245 tokens (`mt_batch_transfer`, `mt_transfer_call`, `mt_withdraw`), clearing counter-signed `NEP-413` swaps guarded by persistent nonces, the `/trade.html` 1Click cross-chain ramp, and `POST /v1/mcp` agent commerce.',
    chips: ['res.terraagent.testnet', '1Click Ramp', 'Hosted MCP /v1/mcp'],
  },
  {
    title: 'Wallet-First 4-Tier Staking & Wealth Dashboard',
    layer: 'WEB3',
    badge: '4-TIER PATRONAGE',
    summary: 'Stake native NEAR or `stNEAR` / `LiNEAR` on `/me.html#staking` with zero Colony Deed (`stake_payable`, `compound_yield`, `withdraw_lst`). Keep 100% principal + 7.20% net APY, unlock `0.65%–0.25%` fees (`24h` warmup, `<7d` `25 bp` exit), and compete for the Tier 4 Lead Patron seat.',
    chips: ['10 / 50 / 200 / 500+ NEAR', '1-Click Compound', 'Lead Patron Flagship'],
  },
  {
    title: 'Payable Escrows, Shade MPC & SputnikDAO Export',
    layer: 'WEB3',
    badge: 'ESCROW + DAO',
    summary: 'Matched fills split 4 ways, `bounty` adds native `open_near_escrow` + expired self-refunds, `dao` supports direct council votes + SputnikDAO v2 JSON export, and Shade Agents sign via NEAR MPC (`v1.signer`).',
    chips: ['open_near_escrow', 'SputnikDAO Export', 'Shade + v1.signer'],
  },
  {
    title: 'Soulbound Colony Deeds, NEAR Social & 60 Badges',
    layer: 'WEB3',
    badge: 'NEP-171',
    summary: 'Every founded colony mints a non-transferable deed on `deed.terraagent.testnet` (5-entry circular history, `prune_history`, NEP-181 pagination), 60 milestone badges, public `/deed/:id` cards, and 1-click NEAR Social sharing.',
    chips: ['deed.terraagent.testnet', 'NEAR Social Share', 'Public /deed/:id'],
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
    chips: ['17 NestJS Modules', 'Prisma + Outbox', 'ACID Spend Locks'],
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
    summary: 'Autonomous NPC freighters dock periodically and quote two-sided liquidity from live 24h organic VWAP via `mid = ref * clamp((T+10)/(I+10), 0.50, 2.00)^0.5` (4% base spread, 15% thin-side half-spread).',
    chips: ['kestrel & vanguard', '24h VWAP Anchor', '10% Off-Planet Sink'],
  },
  {
    title: 'Pilot Profile, Wealth Dashboard, 60 Badges & Deeds',
    layer: 'WEB2',
    badge: 'IDENTITY + WEALTH',
    summary: 'Tracks 60 tiered achievement badges (20×3), the `/me.html#staking` Wealth Dashboard (self-fill-excluded Effective APY, 30d/90d/1y yield curves, Stake Trade Profits), encrypted BYOK settings, and OpenGraph `/deed/:tokenId` cards.',
    chips: ['/me.html#staking', '60 Badges (20×3)', '/deed/:tokenId'],
  },
  {
    title: 'Web Surfaces, Pitchdeck & Faction Plate UI',
    layer: 'WEB2',
    badge: 'SURFACES',
    summary: 'Multi-entry Vite architecture spanning the orbital landing page (`/landing.html`), investor deck (`/pitchdeck/`), live RTS (`/play.html`), and Faction Plate design system (`/design/`).',
    chips: ['/landing.html', '/pitchdeck/', '/design/'],
  },
  {
    title: '3D Inspector, Shader Lab, 7-Day Swarm Sim & Validators',
    layer: 'WEB2',
    badge: 'TOOLING',
    summary: 'Built-in 4-view 3D storybook (`/playground.html`), `F8` Shader Lab, 7-day 3-colony + 25-account swarm & contractor simulator (`/dev/economy-sim/`), and automated geometry/particle CI gates.',
    chips: ['/playground.html', '/dev/economy-sim/', 'CI Model Gates'],
  },
];

export const CONTRACT_ROWS: ReadonlyArray<ContractSpec> = [
  { contract: 'res', accountId: 'res.terraagent.testnet', txHash: '5reiQL5XddxLS9hDDmKrh1Nn4N8f5Ui9KjtqySvGejok', standard: 'NEP-245 Multi-Token', role: 'Orbital cargo across all 10 commodities (18 dec)', guardAndSettlement: '`mt_mint` / `mt_burn` / `mt_withdraw` / `mt_batch_transfer` / `mt_transfer_call` + NEP-145 bounds' },
  { contract: 'deed', accountId: 'deed.terraagent.testnet', txHash: 'E1AGHyMmzCGdsRqvoMVjqWqVQGGkuRu3djQzuRj3wRGK', standard: 'NEP-171 Soulbound', role: 'Colony Deeds, 5-entry capped milestone chapters & badges', guardAndSettlement: 'Bounded `update_metadata`, `prune_history` & NEP-181 pagination (`<= 50`) + NEAR Social shares' },
  { contract: 'bounty', accountId: 'bounty.terraagent.testnet', txHash: '21F1c5TdGtgcAhoTMPRMkHCYvQ15USqo4fpxBrXU8UAB', standard: 'Escrow State Machine', role: 'Defense bounties, Peace Treaties (2h–72h), and 6h War Bonds', guardAndSettlement: '`open_escrow` / payable `open_near_escrow` / `mt_on_transfer` / `claim_expired_refund` / `slash_escrow` (90/10)' },
  { contract: 'staking', accountId: 'staking.terraagent.testnet', txHash: '5UvHFrKUocqf5JewptneZqGeXgXkJQZaeVMPfHTrusX2', standard: 'Wallet-First 4-Tier Vault', role: 'Native NEAR & `stNEAR`/`LiNEAR` staking (7.20% net APY), 4-tier perks & Lead Patron seats', guardAndSettlement: '`stake_payable`, `compound_yield` (0% fee), `withdraw_lst`, `<7d` `25 bp` exit fee & Option A LST share-price solvency' },
  { contract: 'dao', accountId: 'dao.terraagent.testnet', txHash: 'DmsGYQ7VBajz1rRC5FKxNarnnddhs5CzeVgfJc6mqx5U', standard: 'Planet Council Voting', role: 'Meteor shield, terraform boost, and guild subsidy proposals', guardAndSettlement: 'Direct council `propose`/`vote`/`finalize` + SputnikDAO v2 JSON export (`/sputnik-json`)' },
  { contract: 'pilots', accountId: 'pilots.terraagent.testnet', txHash: 'cSTqNFu5aQKb9MiJwantuhxj4Hwn3T2D4WbhCHJAr2h', standard: 'Cold-Root Factory', role: 'Instant `{pilot}.pilots.terraagent.testnet` sub-account provisioning', guardAndSettlement: '`create_pilot_account`; `claimAccount` rotates `[AddKey, DeleteKey]` + seals scoped trading session key' },
  { contract: 'verifier (workspace)', accountId: 'verifier.terraagent.testnet', txHash: '', standard: 'NEP-413 On-Chain Verifier', role: 'Pure Rust `token_diff` Borsh + `env::ed25519_verify`, key-binding & replay registry', guardAndSettlement: '`simulate_intents` / `execute_intents` / `register_account_key` workspace crate (release WASM built, 6 unit tests)' },
];

export const PROTOCOL_ACCOUNT_ROWS: ReadonlyArray<ProtocolAccountSpec> = [
  {
    key: 'root',
    accountId: 'terraagent.testnet',
    role: 'Cold Root & Governance Owner',
    gasAndSecurityModel: 'Owns all deployed Rust contracts and holds reserve NEAR for `npm run near:health --apply` top-ups; hot runtime never needs `NEAR_ROOT_SECRET_KEY` when `NEAR_USE_PILOTS_FACTORY=true`.',
    txHash: '3qmHWbgsfNoykfDeuLsyGVw36kaUmGN5uUiJqrHBgRLH',
  },
  {
    key: 'protocol',
    accountId: 'protocol.terraagent.testnet',
    role: 'Protocol Treasury (`NEAR_PROTOCOL_ACCOUNT`)',
    gasAndSecurityModel: 'Collects 80% of platform trade fees, 20% of validator staking yield, and 10% of breached bond slashes to fund gasless relays and Managed NEAR.AI without minting tokens.',
    txHash: '9q3km4TiFVGnY6HMZUaZdXWmtuMTJ1cy3hvGXyM9ArXY',
  },
  {
    key: 'relayer',
    accountId: 'relayer.terraagent.testnet',
    role: 'NEP-366 Gas Relayer & Pilot Operator (`NEAR_RELAYER_ACCOUNT`)',
    gasAndSecurityModel: 'Pays gas for allowlisted `SignedDelegate` player meta-transactions inside a shared `5 NEAR/day` budget (`<= 0.05 NEAR` attached deposit) and sponsors `0.02 NEAR` pilot sub-account creation on `pilots`.',
    txHash: 'BWsCAjsCUDrQsZbd85EHaLZZrFVWrvAHJseXoPpGFyY1',
  },
  {
    key: 'minter',
    accountId: 'minter.terraagent.testnet',
    role: 'Authorized Contract Gas Signer (`NEAR_MINTER_ACCOUNT`)',
    gasAndSecurityModel: 'Pays gas and executes serialized FIFO operator transactions across `res`, `deed`, `bounty`, `staking`, and `dao` without holding root governance keys.',
    txHash: '9AyXKPYVSLCDaZA59aZWihYmCr6PaqahAmcuH36uMok6',
  },
];

export const PORT_ROWS: ReadonlyArray<PortSpec> = [
  { port: 'ChainReadPort', category: 'Core Read', mockBehavior: 'In-memory seeded JSON state', liveImplementation: 'FastNEAR RPC JSON view calls with automatic failover' },
  { port: 'IdentityPort', category: 'Auth', mockBehavior: 'Local ephemeral session keypair', liveImplementation: 'FastAuth PKCE / OIDC JWKS / `NEP-413` auth + `pilots` factory & `claimAccount`' },
  { port: 'RelayerPort', category: 'Gasless UX', mockBehavior: 'Simulated instant tx receipt', liveImplementation: 'Sponsored `NEP-366` `SignedDelegate` broadcaster (`5 NEAR/day` cap, `<= 0.05 NEAR` deposit)' },
  { port: 'CargoTokenPort', category: 'Assets', mockBehavior: 'PostgreSQL mock token ledger', liveImplementation: '`res` `NEP-245` `mt_mint`, `mt_burn` & `operator_transfer`' },
  { port: 'IntentsPort', category: 'Trading', mockBehavior: 'Local order matcher verification', liveImplementation: 'Testnet: signed `NEP-413` `token_diff` + `1Click` quote + `res` sync; Mainnet: `intents.near`' },
  { port: 'AgentWalletPort', category: 'Automation', mockBehavior: 'Simulated spend cap counter', liveImplementation: 'Scoped session key + ACID allowance lock' },
  { port: 'DeedNftPort', category: 'Identity', mockBehavior: 'Local deed milestone record', liveImplementation: '`deed` `NEP-171` mint & metadata append' },
  { port: 'BadgeNftPort', category: 'Progression', mockBehavior: '60 DB badge unlocks (20×3)', liveImplementation: 'On-chain soulbound badge proofs' },
  { port: 'EscrowPort', category: 'Diplomacy', mockBehavior: 'Simulated truce & war bond book', liveImplementation: '`bounty` lock, claim, refund & 90/10 slash' },
  { port: 'StakingPort', category: 'Yield', mockBehavior: 'Simulated epoch reward clock', liveImplementation: '`staking` pool (80/20 split, human-only)' },
  { port: 'TreasuryDaoPort', category: 'Governance', mockBehavior: 'Local council vote tally', liveImplementation: '`dao` policy proposal & execution' },
];

export const AI_GUARDRAIL_ROWS: ReadonlyArray<AiGuardrailRow> = [
  {
    control: 'Confidential Enclave + Browser Cryptographic Proof',
    trigger: 'Every autonomous commander turn (`z-ai/glm-5.3-flash`)',
    enforcement: 'Executed inside NEAR AI Cloud enclaves (`cloud-api.near.ai/v1`); `SHA-256` `model:request:response` attestations persist in `director_tee_attestation` and verify live in-browser via `secp256k1` EIP-191 & WebCrypto `Ed25519` (`TEE ✓` modal & `/me.html` live probe).',
  },
  {
    control: 'Prompt-Injection & Governance Fencing',
    trigger: 'Multi-colony sweeps & AI trade directives',
    enforcement: 'Isolates staker prompts from rival bots, fences labels inside `<untrusted_player_label>`, and checks kill switches, policy pauses, revoked director keys (`DeleteKey`), open-order exposure, and VWAP price bands.',
  },
  {
    control: 'Encrypted BYOK Vault, 5-Turn Trial & USD Budget Gate (`/me.html`)',
    trigger: 'Pilot runs free trial, attaches BYOK key, or stakes 10–500+ NEAR',
    enforcement: 'Encrypted at rest via AES-256-GCM with live enclave probe (`TEST & VERIFY TEE ENCLAVE`); verified pilots get 5 free TEE turns, while Tier 1–4 stakers share `1–12` colony slots capped at `35%` of protocol income (`>= 65%` margin).',
  },
  {
    control: 'Staking Isolation & Hard Custody Rails (`403 AI_STAKING_FORBIDDEN`)',
    trigger: 'AI or bot token calls stake, demolish, or treaty cancellation',
    enforcement: 'Blocks AI validator staking outright, blocks autonomous demolition, peace breaking, or war canceling, and enforces persistent `nep413_used_nonce` replay checks plus `intentRevision` aborts on human input.',
  },
];
