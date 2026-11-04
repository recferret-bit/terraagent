// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ClientView } from '../../store/replica/viewCodec';
import { MinimalHud } from './index';

/** The top-bar energy chip's hover while the HQ cell is the Hub grid's store (`power-core/hqCell.ts`). */
function freshBody(): HTMLElement {
  document.body.replaceChildren();
  return document.body;
}

describe('Top-bar power breakdown with the HQ cell as the grid store', () => {
  it('at night the HQ cell carries the deficit: Income is generation, Net negative, a Stored line says draining', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent, { ownerColonyIndex: 0 });
    const hq = { entityId: 2, owner: 0, tier: 1, q: 2, r: -1, x: 2, y: -1, hp: 800, hpMax: 800, cell: 640, cellMax: 800, workRate: 1.5, viewRadius: 9, targetQ: 2, targetR: -1, currentJob: 'idle' as const, queueCount: 0 };
    const night = { generationPerS: 16, supply: 19, demand: 19, rawDemand: 19, net: 0, brownout: false, hqCellLinked: true, hqCellDischargePerS: 3 };
    const colony = { index: 0, id: 'col-0', name: 'The Grid', color: 0, status: 'active', power: night, hq };
    hud.update({ tick: 10, colonies: [colony] } as unknown as ClientView);

    const cellEl = parent.querySelector<HTMLElement>('[data-testid="hud-hq-cell"]')!;
    expect(cellEl.querySelector('[data-testid="res-cell-energy"]')?.textContent).toBe('HQ Cell: 640 / 800 E');
    expect(cellEl.querySelector('[data-testid="res-income-energy"]')?.textContent).toBe('Income (Supply): +16 E/s');
    expect(cellEl.querySelector('[data-testid="res-net-energy"]')?.textContent).toBe('Net: −3 E/s');
    expect(cellEl.querySelector<HTMLElement>('[data-testid="res-shed-energy"]')!.hidden).toBe(true);
    const stored = cellEl.querySelector<HTMLElement>('[data-testid="res-stored-energy"]')!;
    expect(stored.hidden).toBe(false);
    expect(stored.textContent).toBe('Stored: −3 E/s (draining)');

    const day = { generationPerS: 29, supply: 29, demand: 19, rawDemand: 19, net: 10, brownout: false, hqCellChargePerS: 10 };
    hud.update({ tick: 11, colonies: [{ ...colony, power: day }] } as unknown as ClientView);
    expect(stored.textContent).toBe('Stored: +10 E/s (charging)');
    hud.update({ tick: 12, colonies: [{ ...colony, power: { ...day, hqCellChargePerS: 0 } }] } as unknown as ClientView);
    expect(stored.hidden).toBe(true);
    hud.dispose();
  });
});
