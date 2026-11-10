// @vitest-environment jsdom
import type { SupplyTradeView } from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { ContractsLog } from './contracts/contractsLog';
import { ContractsPanel } from './contracts/ContractsPanel';
import { isInHudBook } from './hudBook';
import marketFeature from './index';
import type { SupplyPanel } from './supply/SupplyPanel';

const supplyView = { badges: [], mainResource: 'metals.t1', basket: { buy: [], sell: [] } } as unknown as SupplyTradeView;

/** A Colony book pane (TabBook DOM contract) holding the panel element. */
function bookPane(): { pane: HTMLElement; el: HTMLElement } {
  const pane = document.createElement('div');
  pane.setAttribute('data-tab-pane', 'trade');
  const el = document.createElement('div');
  pane.append(el);
  document.body.append(pane);
  return { pane, el };
}

function ctxWith(services: Partial<FeatureContext['services']> = {}): FeatureContext {
  return { flags: new Set(['W13']), host: 'server', services: { track: () => {}, ...services } };
}

const hud = (id: string) => marketFeature.hud!.find((h) => h.id === id)!;

afterEach(() => document.body.replaceChildren());

describe('isInHudBook', () => {
  it('is true inside a tab pane, false for a detached element or a plain slot', () => {
    expect(isInHudBook(bookPane().el)).toBe(true);
    expect(isInHudBook(document.createElement('div'))).toBe(false);
    const slot = document.createElement('div');
    const el = document.createElement('div');
    slot.append(el);
    expect(isInHudBook(el)).toBe(false);
  });
});

describe('ContractsPanel reveal + default open', () => {
  it('reveals its root on every open, never on close', () => {
    const reveal = vi.fn();
    const root = document.createElement('div');
    const panel = new ContractsPanel(root, new ContractsLog(), { reveal });
    expect(root.hidden).toBe(true);
    panel.setOpen(true);
    expect(reveal).toHaveBeenCalledWith(root);
    panel.setOpen(false);
    panel.toggle(); // reopen
    expect(reveal).toHaveBeenCalledTimes(2);
    panel.toggle(); // close
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it('can start open without revealing (book mount must not switch tabs)', () => {
    const reveal = vi.fn();
    const root = document.createElement('div');
    new ContractsPanel(root, new ContractsLog(), { reveal, open: true });
    expect(root.hidden).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('the contracts HUD mount opens the list in a book pane and reveals through revealHudPanel; the menu reveals too', () => {
    const revealHudPanel = vi.fn();
    const { el } = bookPane();
    const ctx = ctxWith({ revealHudPanel });
    const inst = hud('contracts').mount(el, ctx);
    expect(el.hidden).toBe(false);
    expect(revealHudPanel).not.toHaveBeenCalled();
    ctx.services.contracts!.setOpen(false);
    marketFeature.menus!.find((m) => m.id === 'contracts')!.open(ctx);
    expect(el.hidden).toBe(false);
    expect(revealHudPanel).toHaveBeenCalledWith(el);
    inst.dispose();
  });

  it('outside a book the list stays closed until opened (legacy slot)', () => {
    const el = document.createElement('div');
    const inst = hud('contracts').mount(el, ctxWith());
    expect(el.hidden).toBe(true);
    inst.dispose();
  });
});

describe('Supply panel in the Colony book', () => {
  it('starts open in a book pane and its CONTRACTS button opens (never toggles shut) the list', () => {
    const { el } = bookPane();
    const setOpen = vi.fn();
    const inst = hud('supply-trade').mount(el, ctxWith({ contracts: { setOpen, toggle: vi.fn() } as never }));
    const panel = (inst as unknown as { panel: SupplyPanel }).panel;
    expect(panel.isOpen()).toBe(true);
    const contracts = el.querySelector<HTMLButtonElement>('[data-testid=market-open-contracts]')!;
    contracts.click();
    contracts.click();
    expect(setOpen.mock.calls).toEqual([[true], [true]]);
    inst.dispose();
  });

  it('shows the empty-state line while the colony has no supply view, and hides it once data arrives', () => {
    const { el } = bookPane();
    const inst = hud('supply-trade').mount(el, ctxWith());
    const empty = el.querySelector<HTMLElement>('[data-testid=supply-empty]')!;
    inst.update!({ colonies: [{ index: 0 }] } as never);
    expect(empty.hidden).toBe(false);
    inst.update!({ colonies: [{ index: 0, supplyTrade: supplyView }] } as never);
    expect(empty.hidden).toBe(true);
    inst.dispose();
    expect(el.querySelector('[data-testid=supply-empty]')).toBeNull();
  });

  it('outside a book: closed by default and no empty-state line (negative)', () => {
    const el = document.createElement('div');
    const inst = hud('supply-trade').mount(el, ctxWith());
    expect((inst as unknown as { panel: SupplyPanel }).panel.isOpen()).toBe(false);
    expect(el.querySelector('[data-testid=supply-empty]')).toBeNull();
    inst.dispose();
  });
});
