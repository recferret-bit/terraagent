export interface WebFeatureCard {
  readonly title: string;
  readonly layer: 'WEB2' | 'WEB3' | 'NEAR.AI';
  readonly badge: string;
  readonly summary: string;
  readonly chips: ReadonlyArray<string>;
}

export interface ContractSpec {
  readonly contract: string;
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

export const WEB2_FEATURES: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Deterministic Shared Simulation (`@terra/sim`)',
    layer: 'WEB2',
    badge: '5 Hz / 50 Hz',
    summary: 'Pure TypeScript hex-grid state machine runs identically in Node (backend), Web Worker (local sandbox) and client prediction, supporting `5 Hz` live ticks and `50 Hz` `warp` replay.',
    chips: ['shared/sim', 'Fixed-point rules', 'Zero render coupling'],
  },
  {
    title: 'Binary MsgPack WebSocket + 60 FPS Prediction',
    layer: 'WEB2',
    badge: 'REALTIME',
    summary: 'Authoritative state snapshots and diffs encode with `@msgpack/msgpack` over `/ws`. Client predicts camera/unit motion at `60 FPS` with lag/jitter test hooks (`&lag=`, `&predict=0`).',
    chips: ['backend/app/src/ws', '@msgpack/msgpack', 'Sequence acks'],
  },
  {
    title: 'Local Worker Sandbox + IndexedDB Persistence',
    layer: 'WEB2',
    badge: 'OFFLINE PARITY',
    summary: 'Play offline (`?host=local`) on the exact same `@terra/sim` ruleset inside a dedicated Web Worker backed by browser IndexedDB snapshots — identical sim parity.',
    chips: ['?host=local', 'Web Worker', 'IndexedDB'],
  },
  {
    title: '17-Module NestJS Backend + PostgreSQL Outbox',
    layer: 'WEB2',
    badge: 'ACID',
    summary: '17 top-level domain modules (20 `.module.ts` total: `core`, `db`, `bus`, `ws`, `game`, `market`, `economy`, `ai`, `near`, `profile`, `progression`, `notify`, `analytics`, `lobby`, `flags`, `scenarios`, `dev`) commit state via Prisma + ACID outbox across 5 PostgreSQL schemas.',
    chips: ['17 NestJS modules', '5 PG Schemas + Prisma', 'Outbox dispatcher'],
  },
  {
    title: 'CLOB Orderbook & SSE Trading Terminal (`/trade.html`)',
    layer: 'WEB2',
    badge: 'EXCHANGE',
    summary: 'Full limit/market orderbook across all `10` resources against `USDC`, `NEAR`, or barter pairs with Server-Sent Events depth streams, fills ladder, bot keys (`ta_bot_...`) & `/v1/trade/*` routes.',
    chips: ['/trade.html', '/v1/trade/*', 'SSE depth stream'],
  },
  {
    title: 'Orbital Guild AMM & 24h VWAP Oracle',
    layer: 'WEB2',
    badge: 'AMM + VWAP',
    summary: 'Autonomous NPC freighters (`kestrel`, `vanguard`) quote two-sided spreads via `mid = ref * (target / inventory)^k` anchored to rolling `24h` organic VWAP (`4%–15%` thin-side spread).',
    chips: ['ship.guildTrader', '24h VWAP anchor', '10% off-planet sink'],
  },
  {
    title: 'Player Profile, 60 Badges & Shareable Deeds (`/me.html`)',
    layer: 'WEB2',
    badge: 'IDENTITY',
    summary: 'Tracks `60` achievement badges (20 families × 3 tiers, Level 0–30 / 46,500 XP), `S0–S10` stage history, encrypted BYOK vault, and public `/deed/:tokenId` colony chronicle cards with server-rendered OpenGraph PNGs.',
    chips: ['/me.html', '/deed/:tokenId', '60 Badges (20×3)'],
  },
  {
    title: 'Landing, Pitchdeck & Faction Plate Design System',
    layer: 'WEB2',
    badge: 'SURFACES',
    summary: 'Public product portal (`/landing.html` -> deep links to `/play.html?planet=`), interactive investor deck (`/pitchdeck/`), `/design/` Faction Plate CSS token & chamfer storybook, and static `/` hub.',
    chips: ['/landing.html', '/pitchdeck/', '/design/'],
  },
  {
    title: 'Visual Labs, 7-Day Economy Sim & CI Validators',
    layer: 'WEB2',
    badge: 'TOOLING',
    summary: 'Built-in `/playground.html` 3D inspector (`&validate=1`), `F8` 7-Tab Shader Lab, `/dev/economy-sim/`, `/dev/chain/`, `/dev/parity/`, in-game tilde console, plus `validate:models` & `validate:particles` CI gates.',
    chips: ['/playground.html', 'F8 Shader Lab', 'validate:models + particles'],
  },
];

export const WEB3_FEATURES: ReadonlyArray<WebFeatureCard> = [
  {
    title: 'Dual Settlement: Fast Off-Chain Sim + NEAR Finality',
    layer: 'WEB3',
    badge: 'HYBRID',
    summary: '`5 Hz` game actions never block on RPC latency. Asset custody, peace/war bonds, soulbound deeds, council votes and cargo bridges settle deterministically across `6` Rust contracts.',
    chips: ['near-sdk 5.7', 'Mock / Testnet / Mainnet', '11 Typed Ports'],
  },
  {
    title: 'NEP-366 Gasless Meta-Transactions & Cold-Root Pilots',
    layer: 'WEB3',
    badge: 'GASLESS UX',
    summary: '`relayer.terraagent.*` sponsors storage/gas fees (`SignedDelegate`) for onboarded players while `pilots` manages scoped keys with atomic `claimAccount` `[AddKey, DeleteKey]` self-custody rotation.',
    chips: ['relayer.terraagent.*', 'NEP-366 DelegateAction', 'Atomic claimAccount'],
  },
  {
    title: 'NEP-245 Multi-Tokens, NEP-413 Intents & 1Click Bridge',
    layer: 'WEB3',
    badge: 'INTENTS',
    summary: 'Exported orbital cargo wraps into `res` NEP-245 multi-tokens (`chainDecimals: 18`), settling peer swaps atomically via counter-signed zero-sum `NEP-413` `token_diff` intents and `1Click`.',
    chips: ['NEP-245 res', 'NEP-413 token_diff', '1Click Swap'],
  },
  {
    title: 'Day-1 Lossless Staking & Zero Pay-to-Win',
    layer: 'WEB3',
    badge: 'LOSSLESS',
    summary: 'Any claimed human account can stake `NEAR` (`9.0%` gross APY, `2` game-day unbonding). Player keeps `100%` principal + `80%` yield (`7.20%` net APY); `20%` yield funds `protocol.terraagent.*`. `>= 10 NEAR` grants `50%` fee discount + Managed TEE AI — zero combat buffs.',
    chips: ['80% Staker / 20% Protocol', '>= 10 NEAR Perks', 'Zero Stat P2W'],
  },
  {
    title: '4-Way Trade Settlement (`D-44`) & Peace/War Escrows',
    layer: 'WEB3',
    badge: 'ESCROW + DAO',
    summary: 'Every matched order splits atomically: `100%` Seller Principal, `0–100 bp` Trade Hub Stall Royalty, `20%` of platform fee to Planet Council DAO, and `80%` to Protocol (`100 bp` standard / `50 bp` staker). `bounty` slashes breached bonds `90%` partner / `10%` Protocol.',
    chips: ['4-Way NEP-413 Split', '90/10 Bond Slash', 'Planet Council DAO'],
  },
  {
    title: 'Dynamic Soulbound Colony Deeds & Badges (`NEP-171`)',
    layer: 'WEB3',
    badge: 'PROVENANCE',
    summary: 'Every settled colony mints a non-transferable `deed` NFT whose metadata appends immutable milestone chapters as the base climbs `S0 -> S10`, alongside `60` soulbound achievement badges.',
    chips: ['NEP-171 deed', 'Append-only chapters', 'Public /deed/:id'],
  },
];

export const CONTRACT_ROWS: ReadonlyArray<ContractSpec> = [
  { contract: 'res', standard: 'NEP-245 Multi-Token', role: 'Bridged Orbital Cargo Balances across all 10 `ResourceKey` tokens', guardAndSettlement: '`mt_mint` / `mt_burn` / `operator_transfer` paired strictly to Cargo Escrow ACKs' },
  { contract: 'deed', standard: 'NEP-171 Non-Transferable', role: 'Soulbound Colony Deeds + Dynamic Milestone History + Achievement Badges', guardAndSettlement: 'Append-only server signer chapters; non-transferable chronicle' },
  { contract: 'bounty', standard: 'Escrow State Machine', role: 'Mercenary Bounties, Bonded Peace Treaties (`2h–72h`) & `6h` War Bonds', guardAndSettlement: '`open_escrow` / `claim_escrow` / `refund_escrow` / `slash_escrow` (`90%` victim + `10%` Protocol)' },
  { contract: 'staking', standard: 'Lossless Validator Pool', role: 'Day-1 Native NEAR Staking (`9.0%` gross APY) & `>= 10 NEAR` Utility Perks', guardAndSettlement: '`100%` principal withdrawal (`2` game-day unbond); `80%` Staker / `20%` Protocol yield split' },
  { contract: 'dao', standard: 'Planet Council Voting', role: 'Planet Policy Proposals: `meteor_shield`, `terraform_boost`, `guild_subsidy`', guardAndSettlement: 'Living-tier / S-stage weighted `> 50%` quorum + epoch cooldown enforcement' },
  { contract: 'pilots', standard: 'Cold-Root Account Factory', role: 'Sub-Account Provisioning (`{pilot}.pilots.*`) & Scoped Session Keys', guardAndSettlement: 'Gasless onboarding + atomic `[AddKey, DeleteKey]` `claimAccount` self-custody upgrade' },
];

export const PORT_ROWS: ReadonlyArray<PortSpec> = [
  { port: 'ChainReadPort', category: 'Core Read', mockBehavior: 'In-memory seeded JSON block/state', liveImplementation: 'NEAR RPC JSON view queries' },
  { port: 'IdentityPort', category: 'Auth', mockBehavior: 'Local ephemeral keypair session', liveImplementation: 'NEAR Wallet / `NEP-413` sign-in verification' },
  { port: 'RelayerPort', category: 'Gasless UX', mockBehavior: 'Simulated instant receipt', liveImplementation: '`relayer.terraagent.*` `NEP-366` broadcaster' },
  { port: 'CargoTokenPort', category: 'Assets', mockBehavior: 'PostgreSQL ledger balance', liveImplementation: '`res` `NEP-245` `mt_mint` / `mt_burn` & transfer' },
  { port: 'IntentsPort', category: 'Trading', mockBehavior: 'Local matcher verification', liveImplementation: '`NEP-413` signed `token_diff` + `1Click` quotes' },
  { port: 'AgentWalletPort', category: 'Automation', mockBehavior: 'Virtual cap counter', liveImplementation: 'Scoped `pilots` key + ACID spend ledger' },
  { port: 'DeedNftPort', category: 'Identity', mockBehavior: 'Local SVG/JSON deed DB', liveImplementation: '`deed` `NEP-171` mint & milestone append' },
  { port: 'BadgeNftPort', category: 'Progression', mockBehavior: '60 DB badge unlocks (20×3)', liveImplementation: 'On-chain soulbound badge proofs' },
  { port: 'EscrowPort', category: 'PvP / Coop', mockBehavior: 'Sim truce/war bond ledger', liveImplementation: '`bounty` contract lock, claim & `90/10` slash' },
  { port: 'StakingPort', category: 'Yield', mockBehavior: 'Simulated epoch reward rate', liveImplementation: '`staking` lossless pool (`80/20` yield split)' },
  { port: 'TreasuryDaoPort', category: 'Governance', mockBehavior: 'Local council tally', liveImplementation: '`dao` planet policy proposal & execute' },
];

export const AI_GUARDRAIL_ROWS: ReadonlyArray<AiGuardrailRow> = [
  {
    control: 'TEE Verifiable Inference (`NEAR.AI`)',
    trigger: 'Every autonomous commander turn (`z-ai/glm-5.3-flash`)',
    enforcement: 'Prompt & decision payload signed inside Hardware TEE (Intel TDX + NVIDIA) via `/v1/signature/{chat_id}` (ECDSA proof stored on colony audit log)',
  },
  {
    control: 'Encrypted BYOK Vault (`/v1/me/ai-settings`)',
    trigger: 'Player supplies own `NEAR.AI` key & custom model ID on `/me.html`',
    enforcement: 'Server encrypts key at rest with `AES-256-GCM`; plaintext never echoed back in API responses or logs',
  },
  {
    control: 'Hard Staking Isolation (`403 AI_STAKING_FORBIDDEN`)',
    trigger: 'Any AI agent call attempting stake / unstake / withdraw',
    enforcement: 'API router rejects non-human principal signatures at HTTP boundary before port invocation',
  },
  {
    control: 'Bounded Autonomy (`AW-10 / AW-13` + `intentRevision`)',
    trigger: 'Away orders, truce/war cancels & NEAR bond checks',
    enforcement: '`AW-10` forbids AI from demolishing player buildings; `AW-13` forbids AI from breaking active peace truces, canceling wars, or locking human `NEAR`; stale `intentRevision` orders abort immediately on human override',
  },
];
