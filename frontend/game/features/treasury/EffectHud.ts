import { effectBadges, type EffectBadge, type EffectBadgeQuery } from './effectModel';
import { mountLivingOps, type LivingOps } from './livingOps';
import { mountShieldVeil, type ShieldVeil } from './shieldVeil';

interface BadgeSlot {
  root: HTMLElement;
  time: HTMLElement;
}

/** Badge plates, the shield veil and the Living-op tint. DOM is built once; a tick rewrites text only when the clock face changes. */
export class EffectHud {
  private readonly shield: BadgeSlot;
  private readonly boost: BadgeSlot;
  private readonly veil: ShieldVeil;
  private readonly living: LivingOps;
  private signature = '';

  constructor(
    private readonly panel: HTMLElement,
    scope: HTMLElement,
  ) {
    this.panel.hidden = true;
    const doc = panel.ownerDocument;
    const root = doc.createElement('div');
    root.className = 'ta-treasury';
    root.dataset.testid = 'treasury-effects';
    const badges = doc.createElement('div');
    badges.className = 'ta-treasury__badges';
    badges.setAttribute('aria-live', 'polite');
    this.shield = badgeSlot(doc, 'meteor_shield', 'SHIELD');
    this.boost = badgeSlot(doc, 'terraform_boost', 'BOOST');
    badges.append(this.shield.root, this.boost.root);
    root.appendChild(badges);
    panel.appendChild(root);
    this.living = mountLivingOps(root, scope);
    this.veil = mountShieldVeil(scope);
  }

  update(query: EffectBadgeQuery): void {
    const badges = effectBadges(query);
    const signature = signatureOf(badges);
    if (signature === this.signature) return;
    this.signature = signature;
    this.paint(badges);
  }

  dispose(): void {
    this.veil.dispose();
    this.living.dispose();
    this.panel.replaceChildren();
    this.panel.hidden = true;
  }

  private paint(badges: readonly EffectBadge[]): void {
    const shield = badges.find((b) => b.kind === 'meteor_shield');
    const boost = badges.find((b) => b.kind === 'terraform_boost');
    writeBadge(this.shield, shield);
    writeBadge(this.boost, boost);
    this.veil.setActive(shield !== undefined);
    this.living.setBoost(boost !== undefined);
    this.panel.hidden = badges.length === 0;
  }
}

function signatureOf(badges: readonly EffectBadge[]): string {
  let out = '';
  for (const b of badges) out += `${b.kind}:${b.timer};`;
  return out;
}

function badgeSlot(doc: Document, kind: string, label: string): BadgeSlot {
  const root = doc.createElement('div');
  root.className = 'ta-treasury__badge plate-sm';
  root.dataset.kind = kind;
  root.dataset.testid = `effect-badge-${kind}`;
  root.hidden = true;
  root.setAttribute('role', 'status');
  const name = doc.createElement('span');
  name.className = 'ta-treasury__kind';
  name.textContent = label;
  const time = doc.createElement('span');
  time.className = 'ta-treasury__time';
  time.dataset.testid = `effect-timer-${kind}`;
  root.append(name, time);
  return { root, time };
}

function writeBadge(slot: BadgeSlot, badge: EffectBadge | undefined): void {
  const show = badge !== undefined;
  if (slot.root.hidden === show) slot.root.hidden = !show;
  if (!badge) return;
  if (slot.time.textContent !== badge.timer) slot.time.textContent = badge.timer;
  const spoken = `${badge.label} ${badge.timer}`;
  if (slot.root.getAttribute('aria-label') !== spoken) slot.root.setAttribute('aria-label', spoken);
}
