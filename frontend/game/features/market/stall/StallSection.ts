import type { MarketSnapshotResponse } from '@terra/contracts';
import type { FeatureContext } from '../../../core/registry/types';
import { makeDiv } from '../../shared/dom';
import { bpText, inventoryRows } from './stallModel';

const cell = (cls: string, text: string): HTMLElement => {
  const e = document.createElement('span');
  e.className = cls;
  e.textContent = text;
  return e;
};

const line = (testid: string, left: string, right: string): HTMLElement => {
  const row = makeDiv('ta-stall__line', testid);
  row.append(cell('ta-stall__k', left), cell('ta-stall__v', right));
  return row;
};

/**
 * Bottom of the in-game MARKET tab: the stall fee as ONE read-only line (the editor, earnings and valuation are on the trade page)
 * and the player's own in-orbit resources (free / reserved), from the REST snapshot.
 */
export class StallSection {
  readonly el = makeDiv('ta-stall', 'market-stall');
  private snap: MarketSnapshotResponse | null = null;

  constructor(_ctx?: FeatureContext) {
    this.render();
  }

  apply(s: MarketSnapshotResponse): void {
    this.snap = s;
    this.render();
  }

  render(): void {
    const inv = inventoryRows(this.snap);
    const title = makeDiv('ta-market__title', undefined, 'IN ORBIT');
    const body = inv.length
      ? inv.map((r) => line('stall-inv', r.resource, `${r.free} free${r.reserved > 0n ? ` + ${r.reserved} reserved` : ''}`))
      : [makeDiv('ta-market__empty', undefined, 'No resources in orbit.')];
    this.el.replaceChildren(line('stall-current', 'Stall fee (read-only)', bpText(this.snap?.stall?.hubFeeBp ?? 0)), title, ...body);
  }

  dispose(): void { this.el.remove(); }
}
