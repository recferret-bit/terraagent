import {
  GOAL_CATALOG,
  getSuggestedGoalForStage,
  isGoalExecutable,
  type ColonyGoalEntry,
  type GoalKind,
} from '@terra/sim';

export function renderStageSuggestion(
  host: HTMLElement,
  stage: number,
  goals: readonly ColonyGoalEntry[],
  dismissed: boolean,
  accept: (goal: GoalKind) => void,
  dismiss: () => void,
  flags?: ReadonlySet<string>,
  readOnly = false,
): void {
  const goal = getSuggestedGoalForStage(stage);
  const executable = isGoalExecutable(goal, flags);
  const hasW03 = !flags || flags.has('W03');
  const shipped = !flags || flags.has('W21');
  const key = `${stage}:${dismissed}:${goals.some((g) => g.goal === goal)}:${executable}:${hasW03}:${shipped}:${readOnly}`;
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.replaceChildren();
  if (dismissed || goals.some((g) => g.goal === goal)) return;

  const card = document.createElement('div');
  card.className = 'ta-goal-suggestion-card';
  card.dataset.testid = 'goal-suggestion-card';

  const title = document.createElement('strong');
  title.className = 'ta-goal-suggestion-card__title';
  title.textContent = GOAL_CATALOG[goal].label;

  const desc = document.createElement('p');
  desc.className = 'ta-goal-suggestion-card__desc';
  const descriptions: Partial<Record<GoalKind, string>> = {
    establish_colony: 'Prepare site, place Command Hub, and build 1 extractor + 1 generator',
    grow_economy: 'Reach 10 metals/min of actual production. Watch its orders and wait reason below.',
    secure_power: hasW03
      ? 'Verify +10 E/s during night using capacitors or fuel/fusion generation.'
      : 'Verify +10 E/s during night. Positive night targets need W03 night generation.',
    defend_colony: 'Build a Robotics Factory, train guards or turrets, and protect harvesters from fauna.',
    clear_corridor: 'Dispatch combat units to clear nearby insect hives blocking expansion lanes.',
    terraform_zone: 'Grade, irrigate, and seed surrounding hexes into Living ground to unlock T2/T3 tiers.',
    raid_target: 'Muster strike units and raid a rival colony sector (respecting active peace truces).',
  };
  const fallbackDesc = shipped
    ? 'Issue orders via Build, Trade, or AI Director — open Stage Guide for milestones.'
    : 'This lesson needs a future wave. Open the stage guide for its prerequisites.';
  desc.textContent = executable || shipped ? (descriptions[goal] ?? fallbackDesc) : fallbackDesc;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ta-goal-suggestion-card__accept-btn';
  button.dataset.testid = 'goal-suggestion-accept';
  button.disabled = readOnly || !executable;
  button.textContent = !executable
    ? (shipped ? 'MANUAL / DIRECTOR' : 'COMING IN A FUTURE WAVE')
    : 'ACCEPT';
  button.onclick = () => { if (!readOnly) accept(goal); };

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ta-goal-suggestion-card__dismiss-btn';
  close.dataset.testid = 'goal-suggestion-dismiss';
  close.disabled = readOnly;
  close.textContent = 'DO IT MYSELF';
  close.onclick = () => { if (!readOnly) dismiss(); };

  card.append(title, desc, button, close);
  host.append(card);
}
