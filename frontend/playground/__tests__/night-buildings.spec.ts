// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { bindKeys } from '../keyboard';
import { LightsPanel } from '../panels/LightsPanel';
import { Sidebar } from '../panels/Sidebar';
import { Toolbar } from '../panels/Toolbar';
import { createState, syncURL } from '../state';

afterEach(() => vi.unstubAllGlobals());

function stubHistory(): void {
  vi.stubGlobal('location', { pathname: '/playground.html' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
}

describe('playground night query', () => {
  it('round-trips night=1 and treats a missing param or night=0 as day', () => {
    stubHistory();
    const day = createState(new URLSearchParams(''));
    expect(day.night).toBe(false);
    expect(syncURL(day).has('night')).toBe(false);

    const off = createState(new URLSearchParams('night=0&biome=dune'));
    expect(off.night).toBe(false);
    expect(syncURL(off).has('night')).toBe(false);

    const on = createState(new URLSearchParams('night=1&biome=forestRock&view=side'));
    expect(on.night).toBe(true);
    expect(on.kind).toBe('forestRock');
    const q = syncURL(on);
    expect(q.get('night')).toBe('1');
    expect(q.get('biome')).toBe('forestRock');
    expect(q.get('view')).toBe('side');
    const again = createState(q);
    expect(again.night).toBe(true);
    expect(again.kind).toBe('forestRock');

    on.night = false;
    expect(syncURL(on).has('night')).toBe(false);
  });
});

function mountSidebar(params = ''): Sidebar {
  document.body.innerHTML = '<div id="pg"><aside id="side"></aside><main id="stage"><div id="overlay"></div></main></div>';
  const state = createState(new URLSearchParams(params));
  const side = new Sidebar(state, { onSelect() {}, onRow() {} });
  side.build();
  side.showTab('units');
  return side;
}

function buildingItems(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.grp[data-cat="building"] .item')].map((b) => b.dataset.id ?? '');
}

describe('sidebar building list', () => {
  it('opens every catalog building on the units tab without dropping other categories', () => {
    mountSidebar('');
    expect(document.querySelector<HTMLElement>('[data-side-pane="units"]')!.hidden).toBe(false);
    const body = document.querySelector<HTMLElement>('.grp[data-cat="building"] .cat-body')!;
    expect(body.hidden).toBe(false);
    expect(document.querySelector('.grp[data-cat="building"] .cat-toggle')?.getAttribute('aria-expanded')).toBe('true');
    const buildings = ArchetypeCatalog.list('building');
    expect(buildings.length).toBeGreaterThan(0);
    expect(buildingItems()).toEqual(buildings.map((e) => e.id));
    for (const cat of ['robot', 'ship', 'fauna']) {
      expect(document.querySelector(`.grp[data-cat="${cat}"]`)).toBeTruthy();
      expect(document.querySelector<HTMLElement>(`.grp[data-cat="${cat}"] .cat-body`)!.hidden).toBe(true);
    }
    document.querySelector<HTMLButtonElement>('.grp[data-cat="building"] .cat-toggle')!.click();
    expect(document.querySelector<HTMLElement>('.grp[data-cat="building"] .cat-body')!.hidden).toBe(true);
  });

  it('still filters buildings from the search box', () => {
    mountSidebar('faunaScene=mixed');
    const input = document.querySelector<HTMLInputElement>('#search')!;
    input.value = 'solar';
    input.dispatchEvent(new Event('input'));
    const body = document.querySelector<HTMLElement>('.grp[data-cat="building"] .cat-body')!;
    expect(body.hidden).toBe(false);
    expect(buildingItems()).toEqual(['building.solar']);
  });
});

function toolbarHandlers(onNight: (night: boolean) => void) {
  return {
    onView() {}, onPlanet() {}, onToggle() {}, onShot() {}, onSheet() {}, onBuild() {}, onPose() {}, onWorkTarget() {},
    onDepositStage() {}, onTileState() {}, onNight,
  };
}

describe('toolbar day / night switch', () => {
  it('puts Day and Night on the view tab and marks the active one', () => {
    document.body.innerHTML = '<div id="overlay"></div>';
    const state = createState(new URLSearchParams(''));
    const seen: boolean[] = [];
    const bar = new Toolbar(state, toolbarHandlers((night) => { seen.push(night); state.night = night; bar.syncToggles(); }));
    bar.build();
    const page = document.querySelector<HTMLElement>('[data-page="view"]')!;
    expect(page.hidden).toBe(false);
    const day = document.querySelector<HTMLButtonElement>('#views [data-night="0"]')!;
    const night = document.querySelector<HTMLButtonElement>('#views [data-night="1"]')!;
    expect(day.textContent).toBe('Day');
    expect(night.textContent).toBe('Night');
    expect(day.title).toContain('checking building lights');
    expect(night.title).toContain('checking building lights');
    expect(day.classList.contains('pg-btn')).toBe(true);
    expect(night.classList.contains('pg-btn')).toBe(true);
    expect(day.classList.contains('on')).toBe(true);
    expect(night.classList.contains('on')).toBe(false);
    expect([...document.querySelectorAll('#views [data-v]')].map((b) => (b as HTMLElement).dataset.v)).toEqual(['iso', 'front', 'side', 'top']);
    night.click();
    expect(seen).toEqual([true]);
    expect(night.classList.contains('on')).toBe(true);
    expect(day.classList.contains('on')).toBe(false);
  });
});

describe('lights panel night button', () => {
  it('asks for the opposite of state.night and labels Night: ON / OFF from that flag', () => {
    document.body.innerHTML = '<div id="overlay"></div>';
    const state = createState(new URLSearchParams('night=1'));
    const seen: boolean[] = [];
    const panel = new LightsPanel(state, { onNightToggle(night) { seen.push(night); }, onClose() {} });
    panel.build();
    const btn = document.querySelector<HTMLButtonElement>('#lp-night-btn')!;
    expect(btn.textContent).toBe('Night: ON');
    expect(btn.classList.contains('on')).toBe(true);
    btn.click();
    expect(seen).toEqual([false]);
    expect(state.night).toBe(true);
    state.night = false;
    panel.syncNightButton();
    expect(btn.textContent).toBe('Night: OFF');
    expect(btn.classList.contains('on')).toBe(false);
  });
});

describe('n key', () => {
  it('toggles night unless an input is focused, and does not steal l or 1', () => {
    const got = { night: 0, toggle: [] as string[], view: [] as string[] };
    bindKeys({
      cycle() {},
      view(v) { got.view.push(v); },
      toggle(k) { got.toggle.push(k); },
      focus() {},
      night() { got.night += 1; },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(got.night).toBe(1);
    expect(got.toggle).toEqual(['lights']);
    expect(got.view).toEqual(['iso']);
  });
});
