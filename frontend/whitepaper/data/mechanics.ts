export interface StageRow {
  readonly stage: string;
  readonly name: string;
  readonly milestone: string;
  readonly unlocks: string;
}

export interface TerraformOpRow {
  readonly op: string;
  readonly rule: string;
  readonly costAndEffect: string;
}

export interface BiomeRow {
  readonly key: 'dune' | 'oceanForest' | 'forestRock';
  readonly name: string;
  readonly terrainAndWeather: string;
  readonly startingCurve: string;
  readonly unifierShader: string;
}

export interface ResourceRow {
  readonly id: string;
  readonly label: string;
  readonly family: 'Metals' | 'Minerals' | 'Bio';
  readonly tier: string;
  readonly sourceAndGate: string;
  readonly primarySink: string;
}

export interface MechanicBlock {
  readonly title: string;
  readonly badge: string;
  readonly summary: string;
  readonly metrics: ReadonlyArray<string>;
}

export const STAGE_ROWS: ReadonlyArray<StageRow> = [
  { stage: 'S0', name: 'Landing', milestone: 'Drop pod touches down on landing hex', unlocks: 'Command Hub, Hero commander, basic grade, clear & break orders' },
  { stage: 'S1', name: 'First Light', milestone: 'Command Hub T1 complete (1 min dwell)', unlocks: 'Worker harvester, Metals Extractor, Solar Array, automated harvesting' },
  { stage: 'S2', name: 'The Grid', milestone: 'Extractor + Generator online (2 min dwell)', unlocks: 'Pylon, Capacitor, Wind Turbine, Water Pump, Petroleum Well, Depot, reclaim/bridge' },
  { stage: 'S3', name: 'First Contact', milestone: '6 buildings + 2nd extractor (3 min dwell)', unlocks: 'Scout & Guard units, Robotics Factory, Turret, Radar, Wall, patrol/guard modes' },
  { stage: 'S4', name: 'Neighbor', milestone: 'Robotics Factory T1 + 5 tiles scouted (3 min)', unlocks: 'Combat Engineer, Hauler, Claim Beacon, Trade Hub, Roads, sector claims' },
  { stage: 'S5', name: 'Industrial', milestone: 'Sectors claimed or Command Hub T2 (5 min)', unlocks: 'Command Hub T2, Smelter, Chemical Plant, Shield Dome, upgrades, priority sliders' },
  { stage: 'S6', name: 'Frontier', milestone: 'Refinery + combat or terraform units (5 min)', unlocks: 'Striker, Sapper, Envirobot, Factory T2, Missile Battery, Lab, irrigate & drain' },
  { stage: 'S7', name: 'Heavy Metal', milestone: 'Research Lab + sectors held (8 min dwell)', unlocks: 'Tank, Artillery, Warden, Survey Drone, Foundry, Fusion Reactor, Arc Tower, siege mode' },
  { stage: 'S8', name: 'Apex', milestone: 'Heavy Foundry + Fusion Reactor (10 min)', unlocks: 'Goliath, Valkyrie, Archon, Command Hub T3, Orbital Uplink, Planetary Shield, terrain sculpt' },
  { stage: 'S9', name: 'Orbital', milestone: 'Command Hub T3 + Orbital Uplink (10 min)', unlocks: 'HQ T3, Hauler T3, Launch Pad, Fuel Synthesizer, Telemetry Array, Rocket Stages 1–3' },
  { stage: 'S10', name: 'Ascendant', milestone: 'First colony rocket launches', unlocks: 'Ascendant hull finish, Colony Monument & permanent NEP-171 Deed milestone chapter' },
];

export const TERRAFORM_OPS: ReadonlyArray<TerraformOpRow> = [
  { op: 'Grade / Clear / Break', rule: 'Starter S0 tools: flatten slopes, fell trees, shatter boulders', costAndEffect: 'Yields starter Iron, Silica & Biomass plus a 1% chance to uncover subsurface ore seams' },
  { op: 'Level / Fill / Bridge', rule: 'Raises crater pits and bridges narrow water channels', costAndEffect: 'Consumes Silica + Energy to open continuous supply corridors for Haulers and Raiders' },
  { op: 'Reclaim / Deep Reclaim', rule: 'Raises shallow or deep ocean shelves into buildable ground', costAndEffect: 'High power and worker time; expands tight Ocean island build acreage' },
  { op: 'Irrigate', rule: 'Pipes moisture from Water Extractors across dry ground', costAndEffect: 'Costs 2x Water in Desert biomes; prepares bare rock and sand for Living seeding' },
  { op: 'Seed -> Living', rule: 'Converts irrigated ground into living emerald biosphere', costAndEffect: '+10% unit speed and +5% adjacent extractor yield; unlocks T2 (30%) and T3 (70%) gates' },
  { op: 'Dismantle / Salvage', rule: 'Breaks down obsolete buildings or jettisoned drop-pod hulls', costAndEffect: 'Refunds 50% of construction inputs; strictly blocked for autonomous Away AI (`AW-10`)' },
];

export const BIOME_ROWS: ReadonlyArray<BiomeRow> = [
  {
    key: 'dune',
    name: 'Kharon Dunes (Desert)',
    terrainAndWeather: 'Highland mesas, shifting sand dunes, peak solar intensity, electrostatic storms & meteors',
    startingCurve: 'Rich starter Iron (150) & Silica (160); scarce Water (30) & Crystal (15), 2x irrigation water cost',
    unifierShader: 'Ochre windblown dust blended across bottom 0–1.1m hull skirts & foundation plinths',
  },
  {
    key: 'oceanForest',
    name: 'Thalassa Verde (Ocean)',
    terrainAndWeather: 'Archipelago islands, deep Gerstner water swells, dense forest canopy & wind twisters',
    startingCurve: 'Abundant Water (180) & Biomass (150); scarce Iron (60), Reclaim ops grow new dry shelves',
    unifierShader: 'Humid emerald moss creep on lower structural plates & shore-distance water foam',
  },
  {
    key: 'forestRock',
    name: 'Granite Hollow (Temperate)',
    terrainAndWeather: 'Basalt ridges, balanced inland lakes, thick ore veins & lightning storm fronts',
    startingCurve: 'Balanced baseline (100 Iron, 120 Silica, 110 Water, 100 Biomass, 100 Exotic Crystal)',
    unifierShader: 'Cool granite frost & lichen weathering across lower chassis plates and outcrop bases',
  },
];

export const RESOURCE_ROWS: ReadonlyArray<ResourceRow> = [
  { id: 'Iron', label: 'Metals T1', family: 'Metals', tier: 'T1', sourceAndGate: 'Surface veins, Mines & rock breaking at landing', primarySink: 'Hulls, Pylons, Workers, Extractors & Turrets' },
  { id: 'Light Alloys', label: 'Metals T2', family: 'Metals', tier: 'T2', sourceAndGate: 'Smelters & mines once 30% of colony + 50% ring is terraformed', primarySink: 'Command Hub T2, Robotics T2, Capacitors & Haulers' },
  { id: 'Titanium', label: 'Metals T3', family: 'Metals', tier: 'T3', sourceAndGate: 'Heavy Foundry & deep mines at 70% Living gate (20% share)', primarySink: 'Command Hub T3, Apex combat frames, Launch Pad & Rocket' },
  { id: 'Silica', label: 'Minerals T1', family: 'Minerals', tier: 'T1', sourceAndGate: 'Quarries and slope grading from landing', primarySink: 'Solar matrices, Foundations, Fill ops & Smelters' },
  { id: 'Rare Earths', label: 'Minerals T2', family: 'Minerals', tier: 'T2', sourceAndGate: 'Refined mineral seams unlocked at 30% T2 gate', primarySink: 'Radar arrays, Shield Domes, Research Labs & Strikers' },
  { id: 'Exotic Crystal', label: 'Minerals T3', family: 'Minerals', tier: 'T3', sourceAndGate: 'Crystal spires unlocked at 70% T3 Living gate (20% share)', primarySink: 'Laser Towers, Arc Towers, Telemetry Arrays & Planetary Shields' },
  { id: 'Water', label: 'Bio T1', family: 'Bio', tier: 'T1', sourceAndGate: 'Water Pumps, Hydro Generators & Command Hub condensation', primarySink: 'Irrigation (2x in Desert), reactor cooling & Biomass seeding' },
  { id: 'Biomass', label: 'Bio T1', family: 'Bio', tier: 'T1', sourceAndGate: 'Forest clearings and Living hex harvests', primarySink: 'Starter fuel, Bio-synthesizers, Seeding & Logistics supplies' },
  { id: 'Petroleum', label: 'Bio T2', family: 'Bio', tier: 'T2', sourceAndGate: 'Oil seep Wells & Chemical Plants at 30% T2 gate', primarySink: 'Thermal Generators, Heavy armor propulsion & Polymers' },
  { id: 'Gene-stock', label: 'Bio T3', family: 'Bio', tier: 'T3', sourceAndGate: 'Living biosphere harvest at 70% T3 Living gate (20% share)', primarySink: 'Advanced biotech assemblies, Envirobots & T3 upgrades' },
];

export const SYSTEM_MECHANICS: ReadonlyArray<MechanicBlock> = [
  {
    title: 'Three-Tier Attention Cadence',
    badge: 'PACING',
    summary: 'Built simultaneously for 30-second tactical orders, 5-minute planetary raids and Guild dockings, and multi-session S0–S10 colony progression.',
    metrics: ['30s: Build, grid & terraform brush', '5m: Guild docks, raids & truces', 'Session: Stage S0–S10 & Deeds'],
  },
  {
    title: 'Orbital Solar Clock & 4-Group Power Shedding',
    badge: 'POWER GRID',
    summary: 'Energy flows continuously as real-time grid wattage (never tokenized). Capacitors buffer dusk before four priority shed groups brown out gracefully at night.',
    metrics: ['Real-time wattage (not cargo)', '4 priority shed groups', 'Capacitor dusk buffering'],
  },
  {
    title: 'Bonded Peace Treaties & 6-Hour War Escrows',
    badge: 'DIPLOMACY',
    summary: 'Free truces brand early breakers Oathbreaker for 24h; Bonded truces lock matching NEAR or NEP-245 cargo (90% victim / 10% Protocol slash). 6h War Bonds unlock 2x Raider siphon.',
    metrics: ['Peace Bonds: 2h–72h lock', 'War Window: 6h / 108k ticks', 'Slash: 90% Victim / 10% Protocol'],
  },
  {
    title: 'Elimination, Ruin Decay, Rivals & Away Director',
    badge: 'PERSISTENCE',
    summary: 'Two autonomous Rival AI colonies share every planet. Eliminated structures visibly rot under the Ruin decay shader while the Away Director steers offline bases every 180 seconds.',
    metrics: ['2 Rival AI Colonies/planet', '180s Away Director sweep', 'Charred Ruin shader state'],
  },
];
