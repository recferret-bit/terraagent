import { GOAL_CATALOG, getSuggestedGoalForStage, isGoalExecutable, type ColonyGoalEntry, type GoalKind } from '@terra/sim';

export function renderStageSuggestion(
  host: HTMLElement, stage: number, goals: readonly ColonyGoalEntry[], dismissed: boolean,
  accept: (goal: GoalKind) => void, dismiss: () => void,
): void {
  const goal = getSuggestedGoalForStage(stage);
  const key = `${stage}:${dismissed}:${goals.some((g) => g.goal === goal)}`;
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
    secure_power: 'Verify +10 E/s during night. Positive night targets need W03 night generation.',
  };
  desc.textContent = descriptions[goal] ?? 'This lesson needs a future wave. Open the stage guide for its prerequisites.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ta-goal-suggestion-card__accept-btn';
  button.dataset.testid = 'goal-suggestion-accept';
  button.disabled = !isGoalExecutable(goal);
  button.textContent = button.disabled ? 'COMING IN A FUTURE WAVE' : 'ACCEPT';
  button.onclick = () => accept(goal);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ta-goal-suggestion-card__dismiss-btn';
  close.dataset.testid = 'goal-suggestion-dismiss';
  close.textContent = 'DO IT MYSELF';
  close.onclick = dismiss;
  card.append(title, desc, button, close);
  host.append(card);
}
