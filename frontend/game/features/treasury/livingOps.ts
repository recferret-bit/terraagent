/**
 * Irrigate and Seed chips. They are not orders: the dock has no Living-op button (GP-101).
 * The terraform boost only tints elements marked `data-living-op`.
 */
const LIVING_OPS = [
  ['irrigate', 'IRRIGATE'],
  ['seed', 'SEED'],
] as const;

export interface LivingOps {
  readonly row: HTMLElement;
  setBoost(on: boolean): void;
  dispose(): void;
}

export function mountLivingOps(parent: HTMLElement, scope: ParentNode): LivingOps {
  const doc = parent.ownerDocument;
  const row = doc.createElement('div');
  row.className = 'ta-living-ops';
  row.dataset.testid = 'living-ops';
  row.hidden = true;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Living ops');
  for (const [id, label] of LIVING_OPS) row.appendChild(chip(doc, id, label));
  parent.appendChild(row);
  let on = false;
  return {
    row,
    setBoost(next) {
      if (next === on) return;
      on = next;
      row.hidden = !next;
      paintBoost(scope, next);
    },
    dispose() {
      row.remove();
    },
  };
}

function chip(doc: Document, id: string, label: string): HTMLButtonElement {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'ta-living-op plate-sm';
  btn.dataset.livingOp = id;
  btn.dataset.testid = `living-op-${id}`;
  btn.dataset.boosted = 'false';
  btn.textContent = label;
  btn.setAttribute('aria-disabled', 'true');
  return btn;
}

function paintBoost(scope: ParentNode, on: boolean): void {
  const flag = on ? 'true' : 'false';
  for (const el of scope.querySelectorAll<HTMLElement>('[data-living-op]')) {
    if (el.dataset.boosted !== flag) el.dataset.boosted = flag;
  }
}
