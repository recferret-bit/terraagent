import { getStageSpec } from '@terra/sim';

/** Player-facing lessons for full production colonies where all 27 waves (`W00..W27`) are active. */
const SHIPPED_LESSONS: readonly string[] = [
  'Open HQ → Goals and accept Establish Colony. The HQ grades the site and queues a Command Hub, Metals Extractor, and Solar Collector. Track build progress in Queue.',
  'Open HQ → Goals → Grow Economy. Choose Metals and a target rate per minute. Full storage pauses extraction — build a Supply Depot or spend resources, and keep generators ahead of load.',
  'Extend Pylons, add Capacitors and Wind or Thermal power, and run Secure Power to verify net output through nightfall without brownouts.',
  'Build a Robotics Factory, train Scouts and Guards, and place Autocannon Turrets. Queue Defend Area or Clear Nest to protect harvesters from nearby insect hives.',
  'Scout neighboring sectors, place Outpost Beacons to expand territory, and build a Trade Hub to export surplus cargo or trade with Orbital Guild freighters.',
  'Cultivate 30% Living ground to unlock T2 resources, build a Smelter and Chemical Plant, and upgrade Command Hub T2 to expand goal and supply capacity.',
  'Upgrade Robotics Factory T2, build a Research Lab, and deploy Strikers, Sappers, and Envirobots. Queue Terraform Zone to irrigate and seed Living corridors toward 70% T3 access.',
  'Construct a Heavy Foundry, Fusion Reactor, and Arc Towers. Field Tanks and Artillery for siege defense, or negotiate Peace Treaties and 6h War Bonds with neighbors.',
  'Reach 70% Living terrain, upgrade Command Hub T3, and build an Orbital Uplink and Planetary Shield. Command Goliaths, Valkyries, and Archons across land and air.',
  'Construct the Launch Pad, Fuel Synthesizer, and Telemetry Array. Supply Titanium, Exotic Crystal, and fuel across Rocket Stages 1–3 while defending the pad.',
  'Authorize final rocket ignition to complete colony ascension, unlock the Colony Monument, and record the S10 Ascendant chapter on your Colony Deed.',
];

/** Wave-gated lessons preserved when running partial wave sandboxes (`?waves=..08`). */
const WAVE_GATED_LESSONS: readonly string[] = [
  'Open HQ → Goals and accept Establish Colony. The HQ prepares the site and builds a Hub, extractor and solar collector. Watch their orders in Queue.',
  'Open HQ → Goals → Grow Economy. Choose Metals and a production target per minute. Watch the child order and current production; full storage pauses production. Add power if the extractor is offline.',
  'Use HQ → Priorities to balance power and economy. Secure Power verifies actual night output. W03 adds the storage, grid and night generators needed for a positive night target.',
  'Next lesson: build a Robotics Factory, train guards and protect workers. W07 supplies combat and the Defend / Clear Nest goal executors. Defense priority will steer protection and repairs.',
  'Next lesson: scout beyond home, expand territory and connect trade. W04/W10/W27 supply exploration, cargo and sectors. Expansion priority steers claims; economy steers supply. Diplomacy arrives in W18.',
  'Next lesson (W17): choose Tech Up, supply its costs and complete Hub T2. Economy and power priorities govern supporting production; an explicit goal authorizes the upgrade.',
  'Next lesson (W17): prepare terrain and train a balanced force. Terraform priority steers access work; defense steers army composition. Goals must issue real unit and terrain orders.',
  'Next lesson (W17/W18): fortify and learn siege counters. Defense priority steers guards and reinforcements. Raids require explicit authorization; diplomacy must respect truces.',
  'Next lesson (W19): prepare anti-air coverage and air reconnaissance. Defense priority steers counters, power steers their support. Complete the tutorial through actual combat outcomes.',
  'Next lesson (W19): authorize Hub T3 and orbital infrastructure. Balance economy, power and defense; verify costs, supply and coverage before advancing.',
  'Next lesson (W21): prepare rocket components, fuel and telemetry. Track each construction and supply order. Launch requires an explicit player command; sliders never authorize it.',
];

export function stageGuideText(stage: number, current: number, flags?: ReadonlySet<string>): string {
  const spec = getStageSpec(stage);
  const next = getStageSpec(stage + 1);
  const lessons = !flags || flags.has('W21') ? SHIPPED_LESSONS : WAVE_GATED_LESSONS;
  const status = stage > current ? 'Preview — this stage is not reached. ' : '';
  return `${status}${lessons[stage] ?? spec?.teaches ?? ''}${next ? ` Next stage: ${next.unlockConditionText}.` : ' Final stage.'}`;
}
