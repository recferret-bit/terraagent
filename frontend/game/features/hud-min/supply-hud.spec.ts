// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import type { ColonySupply, QueueEntry } from '@terra/sim';
import type { FeatureContext } from '../../core/registry/types';
import { syncStorageHint } from '../queue-panel/queueChipHelpers';
import { readColonySupply, supplyBlockReason, supplyLevel } from '../shared/supply';
import { formatRejectToast, MinimalHud } from './index';

/** Unit supply in the resource header (owner feedback W03 #2): `used / cap`, level colours, sources breakdown. */

const HUB = { building: 'commandHub', label: 'Command Hub', count: 1, each: 10, total: 10 };
const DEPOT = { building: 'supplyDepot', label: 'Supply Depot', count: 2, each: 8, total: 16 };

function supply(used: number, cap: number, extra: Partial<ColonySupply> = {}): ColonySupply {
  return { used, units: used, reserved: 0, cap, available: Math.max(0, cap - used), max: 200, sources: [HUB], ...extra };
}

function render(colonies: Array<Record<string, unknown>>, ownerColonyIndex = 0): HTMLElement {
  document.body.replaceChildren();
  const hud = new MinimalHud(document.body, { ownerColonyIndex });
  hud.update({ tick: 5, colonies } as never);
  return document.querySelector<HTMLElement>('[data-testid="hud-supply"]')!;
}

describe('supply in the resource header', () => {
  it('shows the own colony used / cap with the supply icon, a breakdown of units, production and cap sources', () => {
    const el = render([
      { index: 0, name: 'Other', supply: supply(9, 10) },
      { index: 1, name: 'Mine', supply: supply(3, 26, { units: 2, reserved: 1, sources: [HUB, DEPOT] }) },
    ], 1);
    expect(el.querySelector('.ta-hud-min__icon--supply')).not.toBeNull();
    expect(el.querySelector('.ta-hud-min__stock-val')!.textContent).toBe('3 / 26');
    expect(el.getAttribute('data-level')).toBe('ok');
    expect(el.title).toBe('Unit supply: 3 / 26 (units 2, in production 1)');
    const box = el.querySelector('[data-testid="res-breakdown-supply"]')!;
    expect(box.querySelector('[data-testid="res-supply-units"]')!.textContent).toBe('Units: 2');
    expect(box.querySelector('[data-testid="res-supply-reserved"]')!.textContent).toBe('In production: 1');
    expect([...box.querySelectorAll('[data-supply-source]')].map((r) => r.textContent)).toEqual(['Command Hub ×1+10', 'Supply Depot ×2+16']);
    expect(box.querySelector<HTMLElement>('[data-testid="res-supply-hint"]')!.hidden).toBe(true);
  });

  it('warns near the cap and alerts at it (with the Supply Depot hint)', () => {
    expect(render([{ index: 0, supply: supply(8, 10) }]).getAttribute('data-level')).toBe('warn');
    const full = render([{ index: 0, supply: supply(10, 10) }]);
    expect(full.getAttribute('data-level')).toBe('full');
    expect(full.getAttribute('data-capped')).toBe('true');
    expect(full.title).toContain('Supply cap reached — build a Supply Depot');
    expect(full.querySelector<HTMLElement>('[data-testid="res-supply-hint"]')!.hidden).toBe(false);
  });

  it('shows no number before the host sent the colony supply', () => {
    expect(render([{ index: 0 }]).querySelector('.ta-hud-min__stock-val')!.textContent).toBe('— / —');
  });

  it('shared helpers: level, block reason, reader', () => {
    expect(supplyLevel(null)).toBe('ok');
    expect(supplyLevel({ used: 7, cap: 10 })).toBe('ok');
    expect(supplyLevel({ used: 12, cap: 10 })).toBe('full'); // over the cap after a depot browned out
    expect(supplyBlockReason({ used: 9, cap: 10 }, 1)).toBeNull();
    expect(supplyBlockReason({ used: 10, cap: 10 }, 1)).toBe('Supply cap reached — build a Supply Depot');
    expect(supplyBlockReason({ used: 10, cap: 10 }, 0)).toBeNull();
    expect(readColonySupply({ colonies: [{ index: 0, supply: { used: 1 } }] }, 0)).toBeNull();
  });

  it('the supply_cap reject toast tells the player what to build', () => {
    expect(formatRejectToast('supply_cap')).toBe('Supply cap reached — build a Supply Depot');
    expect(formatRejectToast('supply_cap', 'Supply cap reached (10 / 10): build a Supply Depot', 'enqueueTask')).toBe('Supply cap reached — build a Supply Depot');
  });
});

describe('queue chip: waiting on supply', () => {
  const entry = (waitReason: QueueEntry['waitReason']) => ({ state: 'waiting', waitReason, waitDetail: `waiting: ${waitReason}` }) as QueueEntry;
  const ctx = (waves: string, startPlacement = vi.fn()) =>
    ({ flags: new Set(parseWaves(waves).list), host: 'server', services: { startPlacement } }) as unknown as FeatureContext;

  it('offers "Build Supply Depot" in W03 (opens the depot ghost) and a greyed hint in W02', () => {
    const chip = document.createElement('div');
    const startPlacement = vi.fn();
    syncStorageHint(chip, entry('supply'), ctx('..03', startPlacement));
    const btn = chip.querySelector<HTMLButtonElement>('[data-testid="queue-supply-hint"]')!;
    expect(btn.textContent).toBe('Build Supply Depot');
    btn.click();
    expect(startPlacement).toHaveBeenCalledWith('supplyDepot');

    syncStorageHint(chip, entry('storage'), ctx('..03'));
    expect(chip.querySelector('[data-testid="queue-supply-hint"]')).toBeNull();
    expect(chip.querySelector('[data-testid="queue-storage-hint"]')).not.toBeNull();

    const w02 = document.createElement('div');
    syncStorageHint(w02, entry('supply'), ctx('..02'));
    expect(w02.querySelector('[data-testid="queue-supply-hint"]')!.getAttribute('aria-disabled')).toBe('true');
  });
});
