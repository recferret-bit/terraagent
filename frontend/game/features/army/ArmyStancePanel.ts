import type { ArmyOrdersController, ArmyOrdersSnapshot, ArmyStance } from './ArmyOrdersController';
import { syncDomOrderMarkers } from './OrderMarkersRenderer';

const STANCE_DEFS: ReadonlyArray<{ stance: ArmyStance; label: string; title: string }> = [
  { stance: 'hold', label: 'HOLD', title: 'Hold position and fire in range without moving' },
  { stance: 'defend', label: 'DEFEND', title: 'Defend area within an 8-tile leash around anchor' },
  { stance: 'hunt', label: 'HUNT', title: 'Seek nearest spotted hostile within 15 tiles' },
];

export class ArmyStancePanel {
  readonly el: HTMLElement;
  readonly markersEl: HTMLElement;
  private readonly countBadgeEl: HTMLElement;
  private readonly stanceButtons = new Map<ArmyStance, HTMLButtonElement>();
  private readonly attackMoveBtn: HTMLButtonElement;
  private readonly offChange: () => void;

  constructor(
    parent: HTMLElement,
    private readonly controller: ArmyOrdersController,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'plate ta-army-panel';
    this.el.dataset.testid = 'army-stance-panel';
    this.el.dataset.visible = 'false';
    this.el.hidden = true;

    const head = document.createElement('div');
    head.className = 'ta-army-panel__head';
    const labelEl = document.createElement('span');
    labelEl.className = 'ta-army-panel__label';
    labelEl.textContent = 'ARMY ORDERS';
    this.countBadgeEl = document.createElement('span');
    this.countBadgeEl.className = 'ta-army-panel__count';
    this.countBadgeEl.dataset.testid = 'army-selected-count';
    this.countBadgeEl.textContent = '0';
    head.append(labelEl, this.countBadgeEl);

    const stancesRow = document.createElement('div');
    stancesRow.className = 'ta-army-panel__stances';
    stancesRow.setAttribute('role', 'group');
    stancesRow.setAttribute('aria-label', 'Combat stance');

    for (const def of STANCE_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm plate-sm ta-army-panel__stance-btn';
      btn.setAttribute('data-stance', def.stance);
      btn.setAttribute('data-testid', `army-stance-${def.stance}`);
      btn.setAttribute('data-active', def.stance === 'defend' ? 'true' : 'false');
      btn.setAttribute('aria-pressed', def.stance === 'defend' ? 'true' : 'false');
      btn.title = def.title;
      btn.textContent = def.label;
      btn.onclick = () => {
        this.controller.setStance(def.stance);
      };
      this.stanceButtons.set(def.stance, btn);
      stancesRow.appendChild(btn);
    }

    this.attackMoveBtn = document.createElement('button');
    this.attackMoveBtn.type = 'button';
    this.attackMoveBtn.className = 'btn btn-sm plate-sm ta-army-panel__attack-move-btn';
    this.attackMoveBtn.setAttribute('data-attack-move-btn', 'true');
    this.attackMoveBtn.setAttribute('data-testid', 'army-attack-move-btn');
    this.attackMoveBtn.setAttribute('data-armed', 'false');
    this.attackMoveBtn.setAttribute('aria-pressed', 'false');
    this.attackMoveBtn.title = 'Arm Attack-Move [A]: left-click a tile to advance and engage hostiles';
    this.attackMoveBtn.textContent = 'ATTACK-MOVE [A]';
    this.attackMoveBtn.onclick = () => {
      this.controller.setAttackMoveArmed(!this.controller.isAttackMoveArmed());
    };

    this.el.append(head, stancesRow, this.attackMoveBtn);

    this.markersEl = document.createElement('div');
    this.markersEl.className = 'ta-army-markers';
    this.markersEl.dataset.testid = 'army-order-markers';

    parent.append(this.el, this.markersEl);

    this.offChange = this.controller.onChange((snap) => this.render(snap));
  }

  render(snap: ArmyOrdersSnapshot = this.controller.getSnapshot()): void {
    const count = snap.selectedEntityIds.length;
    const visible = count > 0;
    this.el.hidden = !visible;
    this.el.dataset.visible = String(visible);
    this.el.dataset.selectedCount = String(count);
    this.countBadgeEl.textContent = String(count);

    for (const [stance, btn] of this.stanceButtons.entries()) {
      const active = snap.currentStance === stance;
      btn.setAttribute('data-active', String(active));
      btn.setAttribute('aria-pressed', String(active));
    }

    this.attackMoveBtn.setAttribute('data-armed', String(snap.attackMoveArmed));
    this.attackMoveBtn.setAttribute('aria-pressed', String(snap.attackMoveArmed));

    syncDomOrderMarkers(this.markersEl, snap.orderMarkers);
  }

  dispose(): void {
    this.offChange();
    this.el.remove();
    this.markersEl.remove();
  }
}
