// @vitest-environment jsdom
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { SelectionDetails } from '../shared/SelectionDetails';
import tradeHubFeature, { mountTradeHubPanel } from './index';

type SelectionListener = (s: { selectedEntity: unknown }) => void;

/** Trade tab pane + HUD services (overlay, reveal spy) and a fake landfall selection source. */
function setup(extra: Partial<FeatureContext['services']> = {}) {
  const pane = document.createElement('div');
  pane.setAttribute('data-tab-pane', 'trade');
  const el = document.createElement('div');
  pane.append(el);
  const overlay = document.createElement('div');
  const selectionBar = document.createElement('div');
  document.body.append(pane, overlay, selectionBar);
  const listeners: SelectionListener[] = [];
  const landfall = { getOwnerColonyIndex: () => 0, onChange: (fn: SelectionListener) => { listeners.push(fn); return () => undefined; } };
  const revealHudPanel = vi.fn();
  const ctx: FeatureContext = {
    flags: new Set(['W10']),
    host: 'server',
    services: { track: () => {}, hudOverlay: overlay, revealHudPanel, landfall: landfall as never, selectionDetails: new SelectionDetails(selectionBar), ...extra },
  };
  const inst = mountTradeHubPanel(el, ctx);
  const select = (entity: unknown) => listeners.forEach((fn) => fn({ selectedEntity: entity }));
  const launcher = () => el.querySelector<HTMLElement>('[data-testid=trade-hub-launcher]')!;
  return { pane, el, overlay, selectionBar, ctx, inst, revealHudPanel, select, launcher };
}

const hubEntity = { kind: ENTITY_KIND.tradeHub, entityId: 42, state: ENTITY_STATE.idle };

afterEach(() => document.body.replaceChildren());

describe('Trade Hub in the Colony book: overlay toast, launcher, reveal on programmatic open', () => {
  it('mounts the floating cargo toast in the HUD overlay and removes it on dispose', () => {
    const { el, overlay, inst } = setup();
    expect(overlay.querySelector('[data-testid=cargo-toast]')).not.toBeNull();
    expect(el.querySelector('[data-testid=cargo-toast]')).toBeNull();
    inst.dispose();
    expect(overlay.childElementCount).toBe(0);
    expect(el.childElementCount).toBe(0);
  });

  it('shows the launcher while the panel is closed and hides it once the panel is open in the pane', () => {
    const { launcher, el, ctx, inst } = setup();
    expect(launcher().hidden).toBe(false);
    el.querySelector<HTMLButtonElement>('[data-testid=trade-hub-open]')!.click();
    expect(inst.panel.isOpenState()).toBe(true);
    expect(launcher().hidden).toBe(true);
    ctx.services.openTradeHubPanel!(false);
    expect(launcher().hidden).toBe(false);
    inst.dispose();
  });

  it('openTradeHubPanel / showTradeHubTab / the menu reveal the panel root; closing does not', () => {
    const { ctx, inst, revealHudPanel } = setup();
    ctx.services.openTradeHubPanel!(true, 'import');
    expect(revealHudPanel).toHaveBeenLastCalledWith(inst.panel.root);
    expect(inst.panel.getTab()).toBe('import');
    revealHudPanel.mockClear();
    ctx.services.openTradeHubPanel!(false);
    expect(revealHudPanel).not.toHaveBeenCalled();
    ctx.services.registerTradeHubTab!({ id: 'market', label: 'MARKET', mount: () => ({ dispose() {} }) });
    ctx.services.showTradeHubTab!('market');
    expect(revealHudPanel).toHaveBeenCalledTimes(1);
    expect(inst.panel.isOpenState()).toBe(true);
    ctx.services.openTradeHubPanel!(false);
    tradeHubFeature.menus![0]!.open(ctx);
    expect(revealHudPanel).toHaveBeenCalledTimes(2);
    inst.dispose();
  });

  it('selecting a built Trade Hub opens it in the selection bar without revealing the book; deselecting returns it to the pane', () => {
    const { el, selectionBar, inst, revealHudPanel, select, launcher } = setup();
    select(hubEntity);
    expect(inst.panel.isOpenState()).toBe(true);
    expect(selectionBar.contains(inst.panel.root)).toBe(true);
    expect(revealHudPanel).not.toHaveBeenCalled();
    inst.update!({} as never);
    expect(launcher().hidden).toBe(false); // the pane is not showing the panel
    select(null);
    expect(el.contains(inst.panel.root)).toBe(true);
    expect(inst.panel.isOpenState()).toBe(false);
    inst.dispose();
  });

  it('a constructing hub never auto-opens (negative)', () => {
    const { inst, select } = setup();
    select({ ...hubEntity, state: ENTITY_STATE.constructing });
    expect(inst.panel.isOpenState()).toBe(false);
    inst.dispose();
  });

  it('the CONTRACTS launcher button follows the contracts service and opens the list', () => {
    const setOpen = vi.fn();
    const contracts = { setOpen, isOpen: false };
    const { el, inst, ctx } = setup({ contracts: contracts as never });
    const btn = el.querySelector<HTMLButtonElement>('[data-testid=trade-hub-open-contracts]')!;
    expect(btn.hidden).toBe(false);
    btn.click();
    expect(setOpen).toHaveBeenCalledWith(true);
    contracts.isOpen = true;
    inst.update!({} as never);
    expect(btn.hidden).toBe(true);
    ctx.services.contracts = undefined;
    contracts.isOpen = false;
    inst.update!({} as never);
    expect(btn.hidden).toBe(true);
    inst.dispose();
  });
});
