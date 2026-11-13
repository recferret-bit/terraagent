export interface ChapterNavItem {
  readonly id: string;
  readonly num: string;
  readonly label: string;
  readonly tag: string;
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
  { id: 'sec-00', num: '00', label: 'Executive Thesis & Design Pillars', tag: 'CORE' },
  { id: 'sec-01', num: '01', label: 'Game Loop, Cadence & Stages S0–S10', tag: 'SIM' },
  { id: 'sec-02', num: '02', label: 'Biomes, Terraforming, Power & Resources', tag: 'WORLD' },
  { id: 'sec-03', num: '03', label: 'Diplomacy, Raids, Rivals & Away Director', tag: 'PVP' },
  { id: 'sec-04', num: '04', label: 'Web2 Engine: Sim, WS, DB & Exchange', tag: 'WEB2' },
  { id: 'sec-05', num: '05', label: 'Web3 Protocol: 6 Contracts, 11 Ports & Fees', tag: 'WEB3' },
  { id: 'sec-06', num: '06', label: 'NEAR.AI TEE Autonomy, BYOK & Guardrails', tag: 'AI' },
  { id: 'sec-07', num: '07', label: '3D Fleet: Robots, Ships & Buildings', tag: '3D UNITS' },
  { id: 'sec-08', num: '08', label: '3D Ecology: Fauna, Hives & Deposits', tag: '3D FAUNA' },
  { id: 'sec-09', num: '09', label: '3D VFX: Particles, Combat, Weather & Shaders', tag: '3D VFX' },
  { id: 'sec-canonical', num: '10', label: 'Canonical Public Draft & Ledger Appendix', tag: 'DOC' },
];

export const STACK_NAV_ITEMS: ReadonlyArray<StackNavItem> = [
  { targetId: 'sec-04', anchorId: 'sub-web2-core', layer: 'WEB2', title: '@terra/sim 5 Hz + 50 Hz Warp', status: 'SHARED' },
  { targetId: 'sec-04', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'MsgPack Binary WS + 60 FPS Predict', status: 'LIVE' },
  { targetId: 'sec-04', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'Browser Web Worker + IndexedDB Host', status: 'OFFLINE' },
  { targetId: 'sec-04', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'PostgreSQL Prisma + Transactional Outbox', status: 'ACID' },
  { targetId: 'sec-04', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'CLOB Orderbook & SSE Terminal', status: 'TRADE' },
  { targetId: 'sec-04', anchorId: 'sub-web2-core', layer: 'WEB2', title: 'Orbital Guild AMM & 24h VWAP Anchor', status: 'AMM' },
  { targetId: 'sec-04', anchorId: 'sub-web2-surfaces', layer: 'WEB2', title: '17-Module NestJS API & Analytics', status: 'API' },
  { targetId: 'sec-04', anchorId: 'sub-web2-surfaces', layer: 'WEB2', title: 'Profile, 60 Badges & /deed/:id', status: 'ME' },
  { targetId: 'sec-04', anchorId: 'sub-web2-surfaces', layer: 'WEB2', title: 'Landing, Pitchdeck & Faction Design', status: 'UI' },
  { targetId: 'sec-04', anchorId: 'sub-web2-surfaces', layer: 'WEB2', title: 'Playground, Shader Lab & Validators', status: 'QA' },
  { targetId: 'sec-05', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: res (NEP-245 Multi-Token)', status: 'RUST' },
  { targetId: 'sec-05', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: deed (NEP-171 Soulbound)', status: 'RUST' },
  { targetId: 'sec-05', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: bounty (Peace & War Escrow)', status: 'RUST' },
  { targetId: 'sec-05', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: staking (Day-1 Lossless)', status: 'RUST' },
  { targetId: 'sec-05', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: dao (Planet Council)', status: 'RUST' },
  { targetId: 'sec-05', anchorId: 'sub-web3-contracts', layer: 'WEB3', title: 'Contract: pilots (Cold-Root Keys)', status: 'RUST' },
  { targetId: 'sec-05', anchorId: 'sub-web3-ports', layer: 'WEB3', title: '11 Typed NEAR Ports & Relayer', status: 'PORTS' },
  { targetId: 'sec-05', anchorId: 'sub-web3-settlement', layer: 'WEB3', title: '4-Way Trade Split & Protocol Treasury', status: 'ECON' },
  { targetId: 'sec-06', anchorId: 'sec-06', layer: 'AI-TEE', title: 'NEAR.AI TEE ECDSA (/v1/signature)', status: 'TEE' },
  { targetId: 'sec-06', anchorId: 'sec-06', layer: 'AI-TEE', title: 'AES-256-GCM BYOK & /me/ai-settings', status: 'BYOK' },
  { targetId: 'sec-06', anchorId: 'sec-06', layer: 'AI-TEE', title: '4 Guardrails: 403 / AW-10..13 / Caps', status: 'SAFE' },
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
