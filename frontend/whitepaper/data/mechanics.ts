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
  { stage: 'S0', name: 'Landing', milestone: 'Pod touches down on landing hex', unlocks: 'Command Hub, Hero (`hq`), basic `grade` / `clear` / `break` orders' },
  { stage: 'S1', name: 'First Light', milestone: 'Command Hub T1 complete (1 min dwell)', unlocks: 'Worker (`worker`), Metals Extractor, Solar Array, `harvest` loop' },
  { stage: 'S2', name: 'The Grid', milestone: 'Extractor + Generator online (2 min dwell)', unlocks: 'Pylon, Capacitor, Wind, Water Extractor, Petroleum Well, Supply Depot, `fill` / `bridge` / `dismantle`' },
  { stage: 'S3', name: 'First Contact', milestone: '6 buildings + 2nd extractor (3 min dwell)', unlocks: 'Scout & Guard units, Robotics Factory, Turret, Pulse Turret, Wall, Radar, Thermal, `patrol` / `hold` / `guard`' },
  { stage: 'S4', name: 'Neighbor', milestone: 'Robotics Factory T1 + 5 tiles scouted (3 min)', unlocks: 'Combat Engineer, Hauler, Territory/Outpost Beacon, Trade Hub, Road, `claimSector`' },
  { stage: 'S5', name: 'Industrial', milestone: 'Sectors claimed or Command Hub T2 (5 min)', unlocks: 'Command Hub T2, Smelter, Chemical Plant, Thermal Generator, Shield Dome, `upgrade`, `prioritySliders`' },
  { stage: 'S6', name: 'Frontier', milestone: 'Refinery + combat/terraform units (5 min)', unlocks: 'Striker, Sapper, Envirobot, Robotics Factory T2, Capacitor T2, Missile Battery, Research Lab, `irrigate` / `tunnel` / `drain` / `stabilize` / `tradeContract`' },
  { stage: 'S7', name: 'Heavy Metal', milestone: 'Research Lab + sectors (8 min dwell)', unlocks: 'Tank, Artillery, Warden, Survey Drone, Heavy Foundry, Fusion Reactor, Shield Gen T2, Arc Tower, `siegeMode` / `artilleryBarrage` / `airRecon`' },
  { stage: 'S8', name: 'Apex', milestone: 'Heavy Foundry + Fusion Reactor (10 min)', unlocks: 'Goliath, Valkyrie, Archon, Terraforming Rig, Command Hub T3, Apex Bay, Orbital Uplink, Planetary Shield, `raiseMountain` / `carveCanyon` / `seedForest` / `purifyStep`' },
  { stage: 'S9', name: 'Orbital', milestone: 'Command Hub T3 + Orbital Uplink (10 min)', unlocks: 'HQ T3, Hauler T3, Launch Pad, Fuel Synthesizer, Telemetry Array, Rocket Stages 1–3' },
  { stage: 'S10', name: 'Ascendant', milestone: 'First colony rocket launched', unlocks: 'Ascendant Skin, Colony Monument & permanent NEP-171 Deed milestone chapter' },
];

export const TERRAFORM_OPS: ReadonlyArray<TerraformOpRow> = [
  { op: 'Grade / Clear / Break', rule: 'S0 baseline ops: flatten slopes, clear forest, break surface boulders', costAndEffect: 'Yields `metals.t1` / `minerals.t1` / `bio.biomass` + `1%` subsurface deposit discovery roll' },
  { op: 'Level / Fill / Bridge', rule: 'Raises craters/holes and spans shallow channels for ground paths', costAndEffect: 'Consumes `minerals.t1` + Energy · connects isolated ridges for Haulers & Raiders' },
  { op: 'Reclaim / Deep Reclaim', rule: 'Raises coastal shallow or deep ocean tiles into buildable dry shelf', costAndEffect: 'High power & worker cycles · expands tight Ocean archipelago build acreage' },
  { op: 'Irrigate', rule: 'Pipes moisture from Water Extractors / Hydro into dry tiles', costAndEffect: 'Desert costs `2x` Water (`desertIrrigateWaterMult: 2`) · prepares soil for seeding' },
  { op: 'Seed -> Living', rule: 'Converts irrigated/terraformed hexes into Living green terrain', costAndEffect: '`+10%` unit move speed & `+5%` adjacent extractor yield; unlocks T2 (`30%`) & T3 (`70%`) gates' },
  { op: 'Dismantle / Salvage', rule: 'Reclaims abandoned structures or jettisoned `ship.dropPodShell` hulls', costAndEffect: 'Returns `50%` build inputs (`demolishRefundRatio: 0.5`); blocked for Away AI (`AW-10`)' },
];

export const BIOME_ROWS: ReadonlyArray<BiomeRow> = [
  {
    key: 'dune',
    name: 'Kharon Dunes (`desert` / `dune`)',
    terrainAndWeather: 'Highland mesas, shifting dunes, solar abundance, electrostatic storms & meteor strikes',
    startingCurve: 'High Iron (`150`) & Silica (`160`) baseline; scarce Water (`30`) & Crystal (`15`), `2x` irrigation water',
    unifierShader: 'Ochre windblown dust accumulation across bottom `0.0–1.1m` hull skirt & plinths',
  },
  {
    key: 'oceanForest',
    name: 'Thalassa Verde (`ocean` / `oceanForest`)',
    terrainAndWeather: 'Archipelago hexes, shallow/deep water flats, dense forest canopy & volumetric twisters',
    startingCurve: 'Rich Water (`180`) & Biomass (`150`); lower Iron (`60`), Reclaim / Deep Reclaim ops create land',
    unifierShader: 'Humid emerald moss creep on foundation plinths & animated planar water reflections',
  },
  {
    key: 'forestRock',
    name: 'Granite Hollow (`temperate` / `forestRock`)',
    terrainAndWeather: 'Basalt ridges, balanced lakes, dense metallic seams & storm lightning cells',
    startingCurve: 'Balanced baseline (`100` Iron, `120` Silica, `110` Water, `100` Biomass, `100` Exotic Crystal)',
    unifierShader: 'Cool frost & lichen weathering across lower chassis plates & rock facets',
  },
];

export const RESOURCE_ROWS: ReadonlyArray<ResourceRow> = [
  { id: 'metals.t1', label: 'Iron', family: 'Metals', tier: 'T1', sourceAndGate: 'Surface veins, Mines & rock breaking (unlocked at landing)', primarySink: 'Hulls, Pylons, Workers, Extractors & Turrets' },
  { id: 'metals.t2', label: 'Light Alloys', family: 'Metals', tier: 'T2', sourceAndGate: 'Smelters & mines at `30%` colony + `50%` ring terraformed (`30%` share)', primarySink: 'Command Hub T2, Robotics T2, Capacitors & Haulers' },
  { id: 'metals.t3', label: 'Titanium', family: 'Metals', tier: 'T3', sourceAndGate: 'Heavy Foundry & deep mines at `70%` terraformed + `50%` ring Living (`20%` share)', primarySink: 'Command Hub T3, Apex units, Launch Pad & Rocket' },
  { id: 'minerals.t1', label: 'Silica', family: 'Minerals', tier: 'T1', sourceAndGate: 'Quarries, rock/slope grading (unlocked at landing)', primarySink: 'Solar matrices, Foundations, Fill ops & Smelters' },
  { id: 'minerals.t2', label: 'Rare Earths', family: 'Minerals', tier: 'T2', sourceAndGate: 'Refined mineral seams at `30%` T2 terraforming gate (`30%` share)', primarySink: 'Radar arrays, Shield Domes, Research Labs & Striker rigs' },
  { id: 'minerals.t3', label: 'Exotic Crystal', family: 'Minerals', tier: 'T3', sourceAndGate: 'Crystal spires at `70%` T3 Living gate (`20%` share)', primarySink: 'Laser Towers, Arc Towers, Telemetry Arrays & Planetary Shields' },
  { id: 'bio.water', label: 'Water', family: 'Bio', tier: 'T1', sourceAndGate: 'Water Extractors, Hydro Generators & Command Hub drip (unlocked at landing)', primarySink: 'Irrigation (`2x` in Desert), Cooling & Biomass cultivation' },
  { id: 'bio.biomass', label: 'Biomass', family: 'Bio', tier: 'T1', sourceAndGate: 'Forest clearings & cultivated Living tiles (unlocked at landing)', primarySink: 'Early fuel, Bio-synthesizers, Seeding & Logistics supplies' },
  { id: 'bio.t2', label: 'Petroleum', family: 'Bio', tier: 'T2', sourceAndGate: 'Oil seep Wells & Chemical Plants at `30%` T2 gate', primarySink: 'Thermal Generators, Heavy armor logistics & Plastics' },
  { id: 'bio.t3', label: 'Gene-stock', family: 'Bio', tier: 'T3', sourceAndGate: 'Living biosphere harvest at `70%` T3 Living gate (`20%` share)', primarySink: 'Advanced biotech projects, Envirobots & T3 Prestige builds' },
];

export const SYSTEM_MECHANICS: ReadonlyArray<MechanicBlock> = [
  {
    title: 'Three-Tier Attention Cadence',
    badge: 'PACING',
    summary: 'Tuned simultaneously for 30-second tactical orders, 5-minute planetary market/raid beats, and multi-session colony progression (`S0 -> S10`).',
    metrics: ['30s: Harvest, grid & terraform queue', '5m: Guild docks, raids & truces', 'Session: Stage S0..S10 & Deeds'],
  },
  {
    title: 'Orbital Solar Clock & 4-Group Power Shedding',
    badge: 'POWER GRID',
    summary: 'Energy is grid power (`E/s`), never stored as cargo. Shared authoritative `@terra/sim` solar elevation cycles day/night; Capacitors buffer dusk before 4 shed groups brown out gracefully.',
    metrics: ['Grid power E/s (never tokenized)', '4 priority shed groups', 'Capacitor E/s charge & discharge'],
  },
  {
    title: 'Bonded Peace Treaties & 6-Hour War Escrows',
    badge: 'DIPLOMACY',
    summary: 'Two-tier treaties (`2h–72h`): free truces brand early breakers `Oathbreaker` for `24h`, while Bonded treaties lock matching `NEAR` or `NEP-245` cargo (`90%` victim / `10%` Protocol slash). `6h` (`108 000` ticks) War Bonds unlock `2x` siphon carry (`40 -> 80`).',
    metrics: ['Peace Bonds: 2h–72h lock', 'War Window: 6h / 108k ticks', 'Slash: 90% Partner / 10% Protocol'],
  },
  {
    title: 'Elimination, Ruin Decay, Rivals & Away Director',
    badge: 'PERSISTENCE',
    summary: 'Two autonomous Rival AI colonies (`conservative` Trader & `risky` Warlord) populate every planet. Defeated bases enter Ruin geometry (`setArchetypeRuin(true)`); Away Director sweeps offline colonies every `180s` and caches `120s` digests.',
    metrics: ['2 Rival AI Colonies per planet', '180s Away Director sweep', 'Visible Ruin shader decay'],
  },
];
