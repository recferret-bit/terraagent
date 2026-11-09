// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createState } from '../state';
import { Sidebar } from '../panels/Sidebar';
import { FaunaScenePanel } from '../panels/FaunaScenePanel';
import { MarchPanel } from '../panels/MarchPanel';

const marchStats = { active: false, pace: 'own' as const, tick: 0, moving: 0, arrived: 0, distinct: 0, units: 0, rock: false, anchor: '—' };
const faunaStats = {
  scene: null, tick: 0, populationCount: 0, maxPopulation: 0, waveCount: 0, modeLabel: 'NEUTRAL' as const,
  paused: false, hives: [], mode: 'bugs' as const, biomeKey: 'dune' as const, seed: 42, rngDraws: 0, bugs: [], activeProjectiles: 0,
};

function mount(params: string) {
  document.body.innerHTML = '<div id="pg"><aside id="side"></aside><main id="stage"><div id="overlay"></div></main></div>';
  const state = createState(new URLSearchParams(params));
  const side = new Sidebar(state, { onSelect() {}, onRow() {} });
  side.build();
  new FaunaScenePanel(state, () => faunaStats, {
    onScene() {}, onMode() {}, onSeed() {}, onPauseToggle() {}, onStep() {}, onReset() {}, onAcidPreview() {},
  }).build();
  new MarchPanel(state, () => marchStats, {
    onPace() {}, onRock() {}, onOrder() {}, onPause() {}, onStep() {}, onReset() {},
  }).build();
  return side;
}

function tab(name: string) {
  const btn = document.querySelector<HTMLButtonElement>(`[data-side-tab="${name}"]`)!;
  const pane = document.querySelector<HTMLElement>(`[data-side-pane="${name}"]`)!;
  return { btn, pane, on: btn.classList.contains('on'), selected: btn.getAttribute('aria-selected'), hidden: pane.hasAttribute('hidden') };
}

describe('sidebar hive / march / units tabs', () => {
  it('defaults to units and mounts the panels into their panes', () => {
    const side = mount('');
    const order = [...document.querySelectorAll('[data-side-tab]')].map((b) => (b as HTMLElement).dataset.sideTab);
    expect(order).toEqual(['hive', 'march', 'units']);
    expect(tab('units').on).toBe(true);
    expect(tab('units').selected).toBe('true');
    expect(tab('units').hidden).toBe(false);
    expect(tab('hive').hidden).toBe(true);
    expect(tab('march').hidden).toBe(true);
    expect(document.querySelector('[data-side-pane="units"] #search')).toBeTruthy();
    expect(document.querySelector('[data-side-pane="units"] #list')).toBeTruthy();
    expect(document.querySelector('[data-side-pane="units"] .side-foot')).toBeTruthy();
    expect(document.querySelector('[data-testid="pg-fauna-panel"]')?.parentElement).toBe(tab('hive').pane);
    expect(document.querySelector('[data-testid="pg-march-panel"]')?.parentElement).toBe(tab('march').pane);
    expect(document.querySelector('[data-dock-hide]')).toBeNull();
    expect(document.querySelector('.pg-hide')).toBeNull();
    expect(document.querySelector('[data-testid="dock-show-side"]')?.textContent).toBe('LIST');
    expect(document.querySelector('[data-dock-show="fauna"], [data-dock-show="march"]')).toBeNull();
    tab('hive').btn.click();
    expect(tab('hive').on).toBe(true);
    expect(tab('hive').hidden).toBe(false);
    expect(tab('units').hidden).toBe(true);
    side.showTab('units');
    expect(tab('units').on).toBe(true);
    expect(tab('units').hidden).toBe(false);
  });

  it('opens hive for a fauna fixture and march when march is set', () => {
    mount('faunaScene=mixed');
    expect(tab('hive').on).toBe(true);
    expect(tab('hive').hidden).toBe(false);
    expect(document.querySelector('[data-testid="pg-fauna-panel"]')?.closest('[hidden]')).toBeNull();
    mount('march=together&faunaScene=mixed');
    expect(tab('march').on).toBe(true);
    expect(tab('march').hidden).toBe(false);
    expect(tab('hive').hidden).toBe(true);
  });

  it('throws when a pane is missing', () => {
    document.body.innerHTML = '<div id="side"></div>';
    const state = createState(new URLSearchParams(''));
    expect(() => new FaunaScenePanel(state, () => faunaStats, {
      onScene() {}, onMode() {}, onSeed() {}, onPauseToggle() {}, onStep() {}, onReset() {}, onAcidPreview() {},
    }).build()).toThrow(/data-side-pane="hive"/);
    expect(() => new MarchPanel(state, () => marchStats, {
      onPace() {}, onRock() {}, onOrder() {}, onPause() {}, onStep() {}, onReset() {},
    }).build()).toThrow(/data-side-pane="march"/);
  });
});
