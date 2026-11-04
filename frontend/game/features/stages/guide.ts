import { getStageSpec } from '@terra/sim';

/** Tutorial continuity includes upcoming features, explicitly identified until their owning waves land. */
const LESSONS: readonly string[] = [
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

export function stageGuideText(stage: number, current: number): string {
  const spec = getStageSpec(stage);
  const next = getStageSpec(stage + 1);
  const status = stage > current ? 'Preview — this stage is not reached. ' : '';
  return `${status}${LESSONS[stage] ?? spec?.teaches ?? ''}${next ? ` Next stage: ${next.unlockConditionText}.` : ' Final stage.'}`;
}
