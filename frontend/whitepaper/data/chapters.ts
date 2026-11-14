export interface ChapterNavItem {
  readonly id: string;
  readonly num: string;
  readonly label: string;
  readonly tag: string;
  readonly accent?: 'web3' | 'ai';
}

export interface StackNavItem {
  readonly targetId: string;
  readonly anchorId?: string;
  readonly layer: 'WEB2' | 'WEB3' | 'AI-TEE';
  readonly title: string;
  readonly status: string;
}

export interface EntityNavItem {
  readonly targetId: string;
  readonly filterGroup?: string;
  readonly group: string;
  readonly label: string;
  readonly count: number;
}

export const CHAPTER_ITEMS: ReadonlyArray<ChapterNavItem> = [
  { id: 'sec-00', num: '00', label: 'Thesis, Problem & Trust Stack', tag: 'CORE' },
  { id: 'sec-01', num: '01', label: 'Web3 Protocol & 6 NEAR Contracts', tag: 'WEB3', accent: 'web3' },
  { id: 'sec-02', num: '02', label: 'Player Income, Staking & Treasury', tag: 'ECON', accent: 'web3' },
  { id: 'sec-03', num: '03', label: 'Verifiable NEAR.AI & Guardrails', tag: 'AI-TEE', accent: 'ai' },
  { id: 'sec-04', num: '04', label: 'Core Loop, S0–S10 & Diplomacy', tag: 'GAME' },
  { id: 'sec-05', num: '05', label: 'Biomes, Terraforming & Resources', tag: 'WORLD' },
  { id: 'sec-06', num: '06', label: 'Realtime Engine, DB & Exchange', tag: 'ENGINE' },
  { id: 'sec-07', num: '07', label: '3D Fleet: Robots, Ships & Base', tag: '28 3D' },
  { id: 'sec-08', num: '08', label: '3D Ecology: Fauna, Hives & Ore', tag: '13 3D' },
  { id: 'sec-09', num: '09', label: '3D VFX: Beams, Storms & Shaders', tag: '27 3D' },
  { id: 'sec-canonical', num: '10', label: 'Risks, Testnet Proofs & Draft', tag: 'LEDGER' },
];

export const STACK_NAV_ITEMS: ReadonlyArray<StackNavItem> = [
  { targetId: 'sec-01', anchorId: 'sub-web3-accounts', layer: 'WEB3', title: 'Cold-Root Pilots & Gasless NEP-366', status: 'CUSTODY' },
  { targetId: 'sec-01', anchorId: 'sub-web3-custody', layer: 'WEB3', title: 'Onboarding to Claimed Key Lifecycle', status: 'SCHEMA' },
  { targetId: 'sec-01', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: res (NEP-245 Multi-Token)', status: 'RUST' },
  { targetId: 'sec-01', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: deed (NEP-171 Soulbound)', status: 'RUST' },
  { targetId: 'sec-01', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: bounty (Peace & War Escrow)', status: 'RUST' },
  { targetId: 'sec-01', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: staking (Day-1 Lossless)', status: 'RUST' },
  { targetId: 'sec-01', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: dao (Planet Council)', status: 'RUST' },
  { targetId: 'sec-01', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: pilots (Sub-Account Factory)', status: 'RUST' },
  { targetId: 'sec-01', anchorId: 'sub-web3-ports', layer: 'WEB3', title: '11 Typed NEAR Ports & Mock Parity', status: 'PORTS' },
  { targetId: 'sec-02', anchorId: 'sub-econ-lanes', layer: 'WEB3', title: '4 Player & Agent Income Lanes', status: 'INCOME' },
  { targetId: 'sec-02', anchorId: 'sub-econ-schematic', layer: 'WEB3', title: 'Protocol Treasury & 4-Way Settlement', status: 'SCHEMA' },
  { targetId: 'sec-02', anchorId: 'sub-econ-examples', layer: 'WEB3', title: 'Trade, Staking & Bond Math Receipts', status: 'EXAMPLES' },
  { targetId: 'sec-03', anchorId: 'sub-ai-pipeline', layer: 'AI-TEE', title: 'Hardware TEE & 4-Gate Guardrails', status: 'SCHEMA' },
  { targetId: 'sec-03', anchorId: 'sub-ai-byok', layer: 'AI-TEE', title: 'Managed Autopilot vs Encrypted BYOK', status: 'BYOK' },
  { targetId: 'sec-03', anchorId: 'sub-ai-example', layer: 'AI-TEE', title: 'Overnight Session Trace & VWAP Formula', status: 'EXAMPLE' },
  { targetId: 'sec-06', anchorId: 'sub-web2-core', layer: 'WEB2', title: '@terra/sim 5 Hz + 50 Hz Warp Replay', status: 'SHARED' },
  { targetId: 'sec-06', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'MsgPack Binary WS + 60 FPS Prediction', status: 'LIVE' },
  { targetId: 'sec-06', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'Browser Web Worker + IndexedDB Host', status: 'OFFLINE' },
  { targetId: 'sec-06', anchorId: 'sub-web2-core', layer: 'WEB2', title: '17-Module Backend + PostgreSQL Outbox', status: 'ACID' },
  { targetId: 'sec-06', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'CLOB Exchange, Guild AMM & 24h VWAP', status: 'TRADE' },
  { targetId: 'sec-06', anchorId: 'sub-web2-surfaces', layer: 'WEB2', title: '60 Badges, /deed/:id & Play Surfaces', status: 'SURFACES' },
];

export const ENTITY_NAV_ITEMS: ReadonlyArray<EntityNavItem> = [
  { targetId: 'sec-07', filterGroup: 'robots', group: 'ROBOTS', label: 'Hero, Miner, Builder, Combat, Recon', count: 5 },
  { targetId: 'sec-07', filterGroup: 'orbital', group: 'ORBITAL', label: 'Carrier, Drop Pods, Guild Trader, Sats', count: 7 },
  { targetId: 'sec-07', filterGroup: 'buildings', group: 'BUILDINGS', label: 'HQ, Power, Industry, Defense, Rocket', count: 16 },
  { targetId: 'sec-08', filterGroup: 'fauna', group: 'FAUNA', label: 'Ant, Beetle, Spitter, Skitter, Drifter', count: 5 },
  { targetId: 'sec-08', filterGroup: 'hives', group: 'HIVES', label: 'Ant/Beetle/Spitter Hives & Nests', count: 5 },
  { targetId: 'sec-08', filterGroup: 'deposits', group: 'DEPOSITS', label: 'Metal, Crystal & Oil Stages', count: 3 },
  { targetId: 'sec-09', filterGroup: 'work', group: 'WORK FX', label: 'Cutter Beams & 3D Debris Chunks', count: 9 },
  { targetId: 'sec-09', filterGroup: 'combat', group: 'COMBAT FX', label: 'Laser, Acid, Rocket, Artillery Bursts', count: 7 },
  { targetId: 'sec-09', filterGroup: 'hazards', group: 'HAZARDS', label: 'Lightning, Twister, Meteor & Rain', count: 4 },
  { targetId: 'sec-09', filterGroup: 'shaders', group: 'SHADERS', label: 'Water, Unifier, Day/Night, Build, Ruin', count: 7 },
];
