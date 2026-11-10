import type { AwayDigestV1 } from '@terra/contracts';
import { alertLines, formatAwayDuration, formatNet, resourceNets, storyText } from './format';

function appendStory(plate: HTMLElement, digest: AwayDigestV1): void {
  const story = storyText(digest.story);
  if (!story) return;
  const p = document.createElement('p');
  p.className = 'ta-away-story';
  p.dataset.testid = 'away-story';
  p.textContent = story;
  plate.append(p);
}

function appendNets(plate: HTMLElement, digest: AwayDigestV1): void {
  const nets = resourceNets(digest.resources);
  if (!nets.length) return;
  const list = document.createElement('ul');
  list.className = 'ta-away-nets';
  list.dataset.testid = 'away-nets';
  for (const row of nets) {
    const li = document.createElement('li');
    li.textContent = `${row.key} ${formatNet(row.net)}`;
    list.append(li);
  }
  plate.append(list);
}

function appendAlerts(plate: HTMLElement, digest: AwayDigestV1): void {
  const lines = alertLines(digest.alerts);
  if (!lines.length) return;
  const list = document.createElement('ul');
  list.className = 'ta-away-alerts';
  list.dataset.testid = 'away-alerts';
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
  plate.append(list);
}

/** One chamfered plate. Text is assigned with `textContent` (no `innerHTML`). */
export function renderAwayDigest(digest: AwayDigestV1, onDismiss: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ta-away-backdrop';
  root.dataset.testid = 'away-digest';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'While you were away');

  const plate = document.createElement('div');
  plate.className = 'ta-away-plate plate';

  const title = document.createElement('h2');
  title.className = 'ta-away-title';
  title.textContent = 'While you were away';
  plate.append(title);
  appendStory(plate, digest);

  const duration = document.createElement('p');
  duration.className = 'ta-away-duration';
  duration.dataset.testid = 'away-duration';
  duration.textContent = formatAwayDuration(digest.durationS);
  plate.append(duration);
  appendNets(plate, digest);

  const attacks = document.createElement('p');
  attacks.className = 'ta-away-attacks';
  attacks.dataset.testid = 'away-attacks';
  attacks.textContent = `Attacks ${digest.attacks.count} · Repelled ${digest.attacks.repelled}`;
  plate.append(attacks);
  appendAlerts(plate, digest);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'ta-away-dismiss';
  dismiss.dataset.testid = 'away-dismiss';
  dismiss.textContent = 'Continue';
  dismiss.onclick = () => onDismiss();
  plate.append(dismiss);

  root.append(plate);
  return root;
}
