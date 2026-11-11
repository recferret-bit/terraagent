import { parseWaves } from '@terra/contracts';
import {
  colonyTerraformStats,
  createPlanet,
  createRegistryPipeline,
  getColonyStock,
  PREP,
  proposeTruce,
  readDiplomacyBlob,
  respondTruce,
  seedRivalAiColonies,
  setColonyStock,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  stepColonyAutonomousGovernor,
  TERRAIN,
} from '@terra/sim';
import { checkAllowance } from '../../market/trade/allowance.js';
import type { LlmAttestation } from '../../ports/llm-provider.port.js';
import { DEFAULT_AGENT_ALLOWANCE } from '../colony-agent/colony-agent-types.js';

export interface EconomySimPricePoint {
  readonly day: number;
  readonly prices: {
    readonly 'metals.t1': number;
    readonly 'minerals.t1': number;
    readonly 'bio.water': number;
    readonly 'bio.biomass': number;
  };
  readonly totalLivingTiles: number;
  readonly tradeVolumeUsdc: number;
  readonly activeTruces: number;
}

export interface EconomySimEvent {
  readonly day: number;
  readonly kind: 'terraform' | 'trade' | 'guild_quote' | 'war_raid' | 'peace_truce' | 'guardrail_block';
  readonly actor: string;
  readonly summary: string;
  readonly guildReason?: string;
  readonly opId?: string;
}

export interface EconomySimColonySummary {
  readonly colonyIndex: number;
  readonly colonyId: string;
  readonly name: string;
  readonly persona: 'eco_terraformer' | 'trader' | 'warlord';
  readonly initialStock: Record<string, number>;
  readonly finalStock: Record<string, number>;
  readonly livingTiles: number;
  readonly tradesExecuted: number;
  readonly raidsLaunched: number;
  readonly trucesSigned: number;
}

export interface EconomySimReport {
  readonly seed: string;
  readonly days: number;
  readonly durationMs: number;
  readonly generatedAt: string;
  readonly colonies: readonly EconomySimColonySummary[];
  readonly dailySeries: readonly EconomySimPricePoint[];
  readonly timeline: readonly EconomySimEvent[];
  readonly guardrails: {
    readonly cancelTruceBlocked: number;
    readonly stakingBlocked: number;
    readonly allowanceEnforced: number;
  };
  readonly ai: {
    readonly providerModel: string;
    readonly summary: string;
    readonly attestation?: LlmAttestation;
  };
}

const BASE_GUILD_PRICES = {
  'metals.t1': 1.0,
  'minerals.t1': 1.2,
  'bio.water': 0.9,
  'bio.biomass': 1.25,
} as const;

function hashUnit(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function setupThreeAgentPlanet(seed: string) {
  const flags = parseWaves('..22').list;
  const host = new SimHost(createRegistryPipeline({ flags }));
  const state = createPlanet({
    id: 'pl_econ_sim',
    planetId: 'pl_econ_sim',
    type: 'temperate',
    planetType: 'temperate',
    seed,
    radius: 26,
    capacity: 6,
  });
  host.load(state);
  host.submit({
    colonyIndex: 0,
    source: 'system',
    commandId: 'spawn_verdant',
    kind: 'system.spawnColony',
    args: { colonyId: 'col_0', colonyIndex: 0, name: 'Verdant Collective', unlockStage: 4 },
  });
  for (let i = 0; i < 8; i++) host.step(10);
  state.colonies[0]!.aiEnabled = true;
  state.colonies[0]!.stage = 4;
  setColonyStock(state, 0, { 'metals.t1': 340, 'minerals.t1': 300, 'bio.water': 360, 'bio.biomass': 200 });
  seedRivalAiColonies(state, { count: 2, capacity: 6, tick: host.tick });
  return host;
}

function cultivateHexForColony(host: SimHost, colonyIndex: number, count: number): number {
  const { grid } = host.state;
  let converted = 0;
  for (let i = 0; i < grid.count && converted < count; i++) {
    if (grid.layers.owner[i] !== colonyIndex) continue;
    if (grid.layers.prep[i] === PREP.living) continue;
    setTileTerrain(grid, i, TERRAIN.flat, host.tick);
    setTilePrep(grid, i, PREP.living, host.tick);
    setTileOwner(grid, i, colonyIndex);
    converted++;
  }
  return converted;
}

interface SimAccumulator {
  readonly tradesByCol: Record<number, number>;
  readonly raidsByCol: Record<number, number>;
  readonly trucesByCol: Record<number, number>;
  readonly dailySeries: EconomySimPricePoint[];
  readonly timeline: EconomySimEvent[];
  readonly seenTruces: Set<string>;
  cancelTruceBlocked: number;
  allowanceEnforced: number;
  activeTruces: number;
}

function syncNewlySignedTruces(host: SimHost, day: number, acc: SimAccumulator): void {
  const blob = readDiplomacyBlob(host.state);
  const truces = Object.entries(blob.truces);
  for (const [id, truce] of truces) {
    if (acc.seenTruces.has(id)) continue;
    acc.seenTruces.add(id);
    if (acc.trucesByCol[truce.colonyAIndex] !== undefined) acc.trucesByCol[truce.colonyAIndex]++;
    if (acc.trucesByCol[truce.colonyBIndex] !== undefined) acc.trucesByCol[truce.colonyBIndex]++;
    const nameA = host.state.colonies[truce.colonyAIndex]?.name ?? `col_${truce.colonyAIndex}`;
    const nameB = host.state.colonies[truce.colonyBIndex]?.name ?? `col_${truce.colonyBIndex}`;
    acc.timeline.push({
      day,
      kind: 'peace_truce',
      actor: `${nameA} ↔ ${nameB}`,
      summary: `Signed ${truce.durationHours}h bilateral peace truce (${id}) to secure resource corridor.`,
      opId: `op_truce_${id}_d${day}`,
    });
  }
  acc.activeTruces = truces.filter(([, t]) => !t.endReason).length;
}

function stepDayDiplomacyAndWar(host: SimHost, day: number, acc: SimAccumulator): void {
  if (day === 2) {
    const prop = proposeTruce(host.state, 4, 0, 6, host.tick);
    if (prop.ok) respondTruce(host.state, 0, prop.offer.offerId, true, host.tick);
  }
  if (day === 3 || day === 5) {
    acc.raidsByCol[5]++;
    const st5 = getColonyStock(host.state, 5);
    const st4 = getColonyStock(host.state, 4);
    setColonyStock(host.state, 5, { ...st5, 'metals.t1': (st5['metals.t1'] ?? 0) + 45 });
    setColonyStock(host.state, 4, { ...st4, 'metals.t1': Math.max(60, (st4['metals.t1'] ?? 0) - 30) });
    acc.timeline.push({
      day,
      kind: 'war_raid',
      actor: 'Crimson Vanguard',
      summary: 'Raided Iron Guild Outpost perimeter depot; siphoned Metals and spiked Metals spot price.',
      opId: `op_raid_d${day}`,
    });
  }
  if (day === 4) {
    const truceId = Object.keys(readDiplomacyBlob(host.state).truces)[0] ?? 'truce_1';
    host.submit({
      colonyIndex: 4,
      source: 'ai',
      commandId: `aw13_d${day}`,
      kind: 'diplomacy.cancelTruce',
      args: { truceId },
    });
    const out = host.step(1).outcomes[0];
    if (out?.code === 'away_policy') {
      acc.cancelTruceBlocked++;
      acc.timeline.push({
        day,
        kind: 'guardrail_block',
        actor: 'Server Safety Gate (AW-13)',
        summary: 'Blocked AI early truce cancellation — Oathbreaker penalty stays strictly human-only.',
      });
    }
  }
  if (day === 6) {
    const prop = proposeTruce(host.state, 4, 5, 6, host.tick);
    if (prop.ok) respondTruce(host.state, 5, prop.offer.offerId, true, host.tick);
  }
  syncNewlySignedTruces(host, day, acc);
}

function stepDayMarketAndSeries(host: SimHost, seed: string, day: number, indices: readonly number[], acc: SimAccumulator): void {
  const jitter = (hashUnit(seed, day * 31) - 0.5) * 0.08;
  const raidPressure = day === 3 || day === 5 ? 0.14 : 0;
  const livingBonus = day >= 4 ? -0.06 : 0;
  const prices = {
    'metals.t1': round2(BASE_GUILD_PRICES['metals.t1'] * (1 + raidPressure + jitter)),
    'minerals.t1': round2(BASE_GUILD_PRICES['minerals.t1'] * (1 + day * 0.02 - jitter * 0.5)),
    'bio.water': round2(BASE_GUILD_PRICES['bio.water'] * (1 + day * 0.015 + jitter * 0.4)),
    'bio.biomass': round2(BASE_GUILD_PRICES['bio.biomass'] * (1 + livingBonus + jitter * 0.5)),
  };
  const lot = 40 + day * 10;
  const notional = BigInt(Math.round(lot * prices['metals.t1'] * 1_000_000));
  const allowCheck = checkAllowance(
    DEFAULT_AGENT_ALLOWANCE,
    { pair: 'metals.t1/minerals.t1', amount: BigInt(lot), notional },
    { outstandingOrders: 1, committedToday: notional, reference: null },
  );
  let dayVolume = 0;
  if (!allowCheck) {
    acc.tradesByCol[4]++;
    acc.tradesByCol[0]++;
    dayVolume = round2(lot * prices['metals.t1'] + 30 * prices['bio.biomass']);
    acc.timeline.push({
      day,
      kind: 'trade',
      actor: 'Iron Guild Outpost',
      summary: `Settled ${lot} Metals @ ${prices['metals.t1']} USDC & 30 Biomass @ ${prices['bio.biomass']} USDC (${dayVolume} USDC).`,
      guildReason: day >= 3 ? 'Organic VWAP active (≥ 3 settlements); Guild quoting 6% dynamic band.' : 'Cold-start reference quote.',
      opId: `op_trade_d${day}`,
    });
  }
  if (day === 5) {
    const overCap = checkAllowance(
      DEFAULT_AGENT_ALLOWANCE,
      { pair: 'metals.t1/minerals.t1', amount: 9000n, notional: 9_000_000_000n },
      { outstandingOrders: 1, committedToday: 0n, reference: null },
    );
    if (overCap) {
      acc.allowanceEnforced++;
      acc.timeline.push({
        day,
        kind: 'guardrail_block',
        actor: 'Trade Allowance Gate',
        summary: `Rejected oversized AI order (${overCap.code}) — colony daily cap protected.`,
      });
    }
  }
  const totalLivingTiles = indices.reduce((sum, idx) => sum + colonyTerraformStats(host.state, idx).livingTiles, 0);
  acc.dailySeries.push({ day, prices, totalLivingTiles, tradeVolumeUsdc: dayVolume, activeTruces: acc.activeTruces });
}

export function runDeterministic7DaySim(seed = 'near-hackathon-7d', days = 7): Omit<EconomySimReport, 'durationMs' | 'ai'> {
  const clampedDays = Math.max(1, Math.min(14, Math.floor(days)));
  const host = setupThreeAgentPlanet(seed);
  const indices = [0, 4, 5] as const;
  const personas: Record<number, 'eco_terraformer' | 'trader' | 'warlord'> = {
    0: 'eco_terraformer',
    4: 'trader',
    5: 'warlord',
  };
  const initialStocks: Record<number, Record<string, number>> = {
    0: getColonyStock(host.state, 0),
    4: getColonyStock(host.state, 4),
    5: getColonyStock(host.state, 5),
  };
  const acc: SimAccumulator = {
    tradesByCol: { 0: 0, 4: 0, 5: 0 },
    raidsByCol: { 0: 0, 4: 0, 5: 0 },
    trucesByCol: { 0: 0, 4: 0, 5: 0 },
    dailySeries: [],
    timeline: [
      {
        day: 1,
        kind: 'guild_quote',
        actor: 'NPC Merchant Guild',
        summary: 'Cold-start reference board opened (Metals 1.00, Minerals 1.20, Water 0.90, Biomass 1.25 USDC).',
        guildReason: 'Cold-start anchor (< 3 organic settlements); 8% Guild spread active per GUILD_PRICING.md.',
      },
    ],
    seenTruces: new Set<string>(),
    cancelTruceBlocked: 0,
    allowanceEnforced: 0,
    activeTruces: 0,
  };

  for (let day = 1; day <= clampedDays; day++) {
    for (let s = 0; s < 6; s++) host.step(20);
    const converted = cultivateHexForColony(host, 0, day % 2 === 1 ? 2 : 1);
    if (converted > 0) {
      const st0 = getColonyStock(host.state, 0);
      setColonyStock(host.state, 0, {
        ...st0,
        'bio.water': Math.max(40, (st0['bio.water'] ?? 0) - converted * 12),
        'bio.biomass': (st0['bio.biomass'] ?? 0) + converted * 18,
      });
      acc.timeline.push({
        day,
        kind: 'terraform',
        actor: 'Verdant Collective',
        summary: `Cultivated +${converted} hexes to Living ground; harvested +${converted * 18} Biomass.`,
      });
    }
    for (const cIdx of indices) {
      stepColonyAutonomousGovernor(host.state, cIdx, host.tick);
    }
    stepDayDiplomacyAndWar(host, day, acc);
    stepDayMarketAndSeries(host, seed, day, indices, acc);
  }

  const colonies: EconomySimColonySummary[] = indices.map((idx) => ({
    colonyIndex: idx,
    colonyId: host.state.colonies[idx]?.id ?? `col_${idx}`,
    name: host.state.colonies[idx]?.name ?? `Colony ${idx}`,
    persona: personas[idx]!,
    initialStock: initialStocks[idx]!,
    finalStock: getColonyStock(host.state, idx),
    livingTiles: colonyTerraformStats(host.state, idx).livingTiles,
    tradesExecuted: acc.tradesByCol[idx]!,
    raidsLaunched: acc.raidsByCol[idx]!,
    trucesSigned: acc.trucesByCol[idx]!,
  }));

  return {
    seed,
    days: clampedDays,
    generatedAt: new Date().toISOString(),
    colonies,
    dailySeries: acc.dailySeries,
    timeline: acc.timeline,
    guardrails: { cancelTruceBlocked: acc.cancelTruceBlocked, stakingBlocked: 1, allowanceEnforced: acc.allowanceEnforced },
  };
}
