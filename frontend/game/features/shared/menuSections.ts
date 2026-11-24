import { hideActiveCardTip } from './menuCards';

/** A labelled block inside the Build or Production card grid. */
export interface MenuGroup {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly keys: readonly string[];
}

export const BUILD_GROUPS: readonly MenuGroup[] = [
  { id: 'hq', title: 'HQ', text: 'One per colony. Trains workers and anchors the grid.', keys: ['commandHub'] },
  {
    id: 'resources',
    title: 'Resources',
    text: 'Extract metals, minerals, water, and petroleum.',
    keys: ['metalsExtractor', 'mineralsQuarry', 'waterExtractor', 'petroleumWell'],
  },
  {
    id: 'power',
    title: 'Power',
    text: 'Generate energy, store a charge, and carry it outward.',
    keys: ['solar', 'wind', 'thermal', 'pylon', 'capacitor'],
  },
  {
    id: 'production',
    title: 'Production',
    text: 'Factories and arrays that build and direct units.',
    keys: ['roboticsFactory', 'droneControlArray'],
  },
  {
    id: 'logistics',
    title: 'Logistics',
    text: 'Depots and the trade hub. Store cargo and ship it.',
    keys: ['supplyDepot', 'depot', 'tradeHub'],
  },
  { id: 'defense', title: 'Defense', text: 'Turrets that hold the perimeter.', keys: ['turret', 'autocannon', 'laserTower'] },
  { id: 'territory', title: 'Territory', text: 'Beacons that claim sectors past the hub.', keys: ['outpostBeacon'] },
];

export const UNIT_GROUPS: readonly MenuGroup[] = [
  { id: 'workers', title: 'Workers', text: 'Harvest, build, and terraform.', keys: ['worker'] },
  { id: 'scouts', title: 'Scouts', text: 'Range ahead and open the map.', keys: ['scout'] },
  { id: 'logistics', title: 'Logistics', text: 'Haul cargo between the hub and the job.', keys: ['hauler'] },
  { id: 'garrison', title: 'Garrison', text: 'Guards and engineers. Hold ground and repair.', keys: ['guard', 'combatEngineer'] },
];

export const ARMY_SECTION_TEXT = 'Built at the Robotics Factory. They walk to the rally point.';

const OTHER_GROUP: MenuGroup = { id: 'other', title: 'Other', text: 'The rest of this list.', keys: [] };

export function menuGroupId(groups: readonly MenuGroup[], key: string): string {
  for (const group of groups) if (group.keys.includes(key)) return group.id;
  return OTHER_GROUP.id;
}

function sectionHead(group: MenuGroup, heads: Map<string, HTMLElement>): HTMLElement {
  const existing = heads.get(group.id);
  if (existing) return existing;
  const head = document.createElement('div');
  head.className = 'ta-menu-section';
  head.setAttribute('data-menu-section', group.id);
  const title = document.createElement('div');
  title.className = 'ta-menu-section__title';
  title.textContent = group.title;
  const text = document.createElement('p');
  text.className = 'ta-menu-section__text';
  text.textContent = group.text;
  head.append(title, text);
  heads.set(group.id, head);
  return head;
}

/** True while no visible section has been placed yet. */
function markSection(head: HTMLElement, on: boolean, lead: boolean): boolean {
  head.setAttribute('data-empty', on ? 'false' : 'true');
  head.setAttribute('data-lead', on && lead ? 'true' : 'false');
  return lead && !on;
}

function matchesChildren(container: HTMLElement, desired: readonly HTMLElement[]): boolean {
  const cur = container.children;
  if (cur.length !== desired.length) return false;
  for (let i = 0; i < desired.length; i++) {
    if (cur[i] !== desired[i]) return false;
  }
  return true;
}

/**
 * Orders `cards` under section headers. A section with no card for the open tier is hidden.
 * `tail` (the army block) stays last. Only mutates DOM when child membership or order changes
 * so hovered cards are not detached on periodic updates.
 */
export function layoutMenuGroups(
  container: HTMLElement,
  groups: readonly MenuGroup[],
  cards: readonly { key: string; el: HTMLElement }[],
  heads: Map<string, HTMLElement>,
  tail?: HTMLElement | null,
): void {
  const buckets = new Map<string, HTMLElement[]>();
  for (const group of groups) buckets.set(group.id, []);
  const other: HTMLElement[] = [];
  for (const card of cards) {
    const bucket = buckets.get(menuGroupId(groups, card.key));
    if (bucket) bucket.push(card.el);
    else other.push(card.el);
  }
  const desired: HTMLElement[] = [];
  let lead = true;
  for (const group of groups) {
    const els = buckets.get(group.id) ?? [];
    if (els.length === 0) {
      heads.get(group.id)?.remove();
      heads.delete(group.id);
      continue;
    }
    const head = sectionHead(group, heads);
    const on = els.some((el) => el.getAttribute('data-tier-on') !== 'false');
    lead = markSection(head, on, lead);
    desired.push(head, ...els);
  }
  if (other.length > 0) {
    const head = sectionHead(OTHER_GROUP, heads);
    const on = other.some((el) => el.getAttribute('data-tier-on') !== 'false');
    markSection(head, on, lead);
    desired.push(head, ...other);
  } else {
    heads.get(OTHER_GROUP.id)?.remove();
    heads.delete(OTHER_GROUP.id);
  }
  if (tail) desired.push(tail);
  if (matchesChildren(container, desired)) return;
  hideActiveCardTip();
  container.replaceChildren(...desired);
}
