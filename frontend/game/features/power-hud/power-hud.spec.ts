import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { PowerHud } from './PowerHud';
import { E, ENTITY_STRIDE } from '../../store/replica/viewCodec';
import { installMockDocument, MockElement } from '../test-dom';
import type { FeatureContext, GameView } from '../../core/registry/types';

describe('PowerHud - no clock / balance bar (moved to the top bar)', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('renders only the brownout banner and the inspector', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);
    hud.update({ colonies: [{ power: { supply: 28, demand: 11, net: 17, phase: 'day', clockText: '11:30', daylight: 0.95, brownout: false } }] });
    const p = parent as unknown as MockElement;
    expect(p.querySelector('.ta-power-hud__clock-text')).toBeNull();
    expect(p.querySelector('.ta-power-hud__flow')).toBeNull();
    expect(p.querySelector('.ta-power-hud__brownout')?.getAttribute('data-brownout')).toBe('false');
    hud.dispose();
  });
});

describe('PowerHud - brownout acceptance', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('acceptance: brownout -> banner appears and shed Extractor shows offline: brownout', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);

    // Prior to brownout: daytime, extractor is active
    hud.update({
      colonies: [
        {
          power: {
            supply: 28,
            demand: 11,
            net: 17,
            brownout: false,
            phase: 'day',
            clockText: '12:00',
            daylight: 1.0,
          },
        },
      ],
      entities: [
        {
          id: 101,
          kind: ENTITY_KIND.metalsExtractor,
          hp: 500,
          hpMax: 500,
          state: ENTITY_STATE.active,
        },
      ],
    });

    const mockParent = parent as unknown as MockElement;
    const banner = mockParent.querySelector('.ta-power-hud__brownout')!;
    expect(banner.getAttribute('data-brownout')).toBe('false');

    const inspector = mockParent.querySelector('.ta-building-inspector')!;
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Resource Extractor');
    expect(inspector.querySelector('.ta-building-inspector__state')?.textContent).toBe('ONLINE');
    expect(inspector.getAttribute('data-offline')).toBe('false');

    // Brownout strikes: supply drops, group 3 shed, extractor 101 goes offline
    hud.update({
      colonies: [
        {
          power: {
            supply: 8,
            demand: 5,
            rawDemand: 11,
            net: 3,
            brownout: true,
            shedGroupsActive: [3],
            shedEntityIds: [101],
            offlineReasons: { 101: 'offline: brownout' },
            phase: 'night',
            clockText: '21:00',
            daylight: 0.0,
          },
        },
      ],
      entities: [
        {
          id: 101,
          kind: ENTITY_KIND.metalsExtractor,
          hp: 500,
          hpMax: 500,
          state: ENTITY_STATE.offlineBrownout,
        },
      ],
    });

    // 1. Banner appears
    expect(banner.getAttribute('data-brownout')).toBe('true');
    expect(banner.textContent).toContain('BROWNOUT — SHEDDING GROUP 3');

    // 2. Shed Extractor shows offline: brownout
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Resource Extractor');
    expect(inspector.querySelector('.ta-building-inspector__state')?.textContent).toBe('OFFLINE: BROWNOUT');
    expect(inspector.querySelector('.ta-building-inspector__reason')?.textContent).toBe('offline: brownout');
    expect(inspector.getAttribute('data-state')).toBe('offline: brownout');
    expect(inspector.getAttribute('data-offline')).toBe('true');

    hud.dispose();
  });
});

describe('PowerHud - inspector and selection', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('inspects building from Float32Array entity buffer', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);

    const buf = new Float32Array(ENTITY_STRIDE);
    buf[E.id] = 12;
    buf[E.kind] = ENTITY_KIND.metalsExtractor;
    buf[E.hp] = 450;
    buf[E.hpMax] = 500;
    buf[E.state] = ENTITY_STATE.offlineBrownout;

    hud.update({
      colonies: [
        {
          power: {
            supply: 8,
            demand: 5,
            net: 3,
            brownout: true,
            shedGroupsActive: [3],
            shedEntityIds: [12],
            offlineReasons: { 12: 'offline: brownout' },
          },
        },
      ],
      entities: buf,
    });

    const mockParent = parent as unknown as MockElement;
    const inspector = mockParent.querySelector('.ta-building-inspector')!;
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Resource Extractor');
    expect(inspector.querySelector('.ta-building-inspector__hp')?.textContent).toBe('450 / 500 HP');
    expect(inspector.querySelector('.ta-building-inspector__state')?.textContent).toBe('OFFLINE: BROWNOUT');
    expect(inspector.getAttribute('data-offline')).toBe('true');

    hud.dispose();
  });

  it('allows manual entity selection via selectEntity or view.selectedEntityId', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);

    hud.update({
      colonies: [{ power: { supply: 20, demand: 10, net: 10 } }],
      selectedEntityId: 202,
      entities: [
        { id: 201, kind: ENTITY_KIND.metalsExtractor, hp: 500, hpMax: 500, state: ENTITY_STATE.active },
        { id: 202, kind: ENTITY_KIND.solar, hp: 300, hpMax: 300, state: ENTITY_STATE.active },
      ],
    });

    const mockParent = parent as unknown as MockElement;
    const inspector = mockParent.querySelector('.ta-building-inspector')!;
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Solar Array');
    expect(inspector.querySelector('.ta-building-inspector__hp')?.textContent).toBe('300 / 300 HP');

    hud.selectEntity(201);
    hud.update({
      colonies: [{ power: { supply: 20, demand: 10, net: 10 } }],
      entities: [
        { id: 201, kind: ENTITY_KIND.metalsExtractor, hp: 500, hpMax: 500, state: ENTITY_STATE.active },
        { id: 202, kind: ENTITY_KIND.solar, hp: 300, hpMax: 300, state: ENTITY_STATE.active },
      ],
    });

    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Resource Extractor');

    hud.dispose();
  });
});

describe('PowerHud - requested demand, brownout deficit and own colony', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  const hubOnlyBrownout = {
    supply: 8,
    demand: 5,
    rawDemand: 11,
    net: 3,
    brownout: true,
    shedGroupsActive: [3],
    shedEntityIds: [3],
    offlineReasons: { 3: 'offline: brownout' },
  };

  it('a Hub-only grid with a shed Extractor names its 6 E/s offline in the banner', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);
    hud.update({ colonies: [{ power: hubOnlyBrownout }] });

    const p = parent as unknown as MockElement;
    const banner = p.querySelector('.ta-power-hud__brownout')!;
    expect(banner.getAttribute('data-brownout')).toBe('true');
    expect(banner.textContent).toBe('BROWNOUT — SHEDDING GROUP 3 · 6 E/s OFFLINE');
    hud.dispose();
  });

  it('a brownout with nothing shed does not name a shed group', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);
    hud.update({ colonies: [{ power: { supply: 0, demand: 1.5, rawDemand: 1.5, net: -1.5, brownout: true, shedGroupsActive: [] } }] });
    const banner = (parent as unknown as MockElement).querySelector('.ta-power-hud__brownout')!;
    expect(banner.textContent).toBe('BROWNOUT — DEMAND OVER SUPPLY');
    hud.dispose();
  });

  it("reads the player's colony (seat 1), not colony 0, and inspects only its own buildings", () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const ctx = { services: { landfall: { getOwnerColonyIndex: () => 1 } } } as unknown as FeatureContext;
    const hud = new PowerHud(parent, ctx);
    hud.update({
      colonies: [
        { index: 0, power: { supply: 28, demand: 11, rawDemand: 11, net: 17, brownout: false } },
        { index: 1, power: hubOnlyBrownout },
      ],
      entities: [
        { id: 2, kind: ENTITY_KIND.solar, owner: 0, hp: 300, hpMax: 300, state: ENTITY_STATE.active },
        { id: 3, kind: ENTITY_KIND.metalsExtractor, owner: 1, hp: 500, hpMax: 500, state: ENTITY_STATE.offlineBrownout },
      ],
    } as unknown as GameView);

    const p = parent as unknown as MockElement;
    expect(p.querySelector('.ta-power-hud__brownout')?.textContent).toBe('BROWNOUT — SHEDDING GROUP 3 · 6 E/s OFFLINE');
    const inspector = p.querySelector('.ta-building-inspector')!;
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Resource Extractor');
    expect(inspector.querySelector('.ta-building-inspector__state')?.textContent).toBe('OFFLINE: BROWNOUT');
    hud.dispose();
  });
});

describe('PowerHud - follows the landfall selection (FF-49)', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installMockDocument();
  });
  afterEach(() => {
    uninstall();
  });

  it('a selected building is inspected; a selected unit or nothing falls back to the shed building; dispose unsubscribes', () => {
    type Snap = { selectedEntity: { entityId: number; isUnit: boolean } | null };
    let listener: ((s: Snap) => void) | null = null;
    const landfall = {
      getOwnerColonyIndex: () => 0,
      onChange(fn: (s: Snap) => void) {
        listener = fn;
        fn({ selectedEntity: null });
        return () => { listener = null; };
      },
    };
    const ctx = { services: { landfall } } as unknown as FeatureContext;
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent, ctx);
    const view = {
      colonies: [{ index: 0, power: { supply: 8, demand: 5, rawDemand: 11, net: 3, brownout: true, shedEntityIds: [3], offlineReasons: { 3: 'offline: brownout' } } }],
      entities: [
        { id: 2, kind: ENTITY_KIND.solar, owner: 0, hp: 250, hpMax: 300, state: ENTITY_STATE.active },
        { id: 3, kind: ENTITY_KIND.metalsExtractor, owner: 0, hp: 500, hpMax: 500, state: ENTITY_STATE.offlineBrownout },
      ],
    } as unknown as GameView;
    const title = () => (parent as unknown as MockElement).querySelector('.ta-building-inspector__title')?.textContent;

    hud.update(view);
    expect(title()).toBe('Resource Extractor');
    listener!({ selectedEntity: { entityId: 2, isUnit: false } });
    hud.update(view);
    expect(title()).toBe('Solar Array');
    listener!({ selectedEntity: { entityId: 9, isUnit: true } });
    hud.update(view);
    expect(title()).toBe('Resource Extractor');
    hud.dispose();
    expect(listener).toBeNull();
  });
});

describe('PowerHud - pylon load and overload display', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installMockDocument();
  });
  afterEach(() => {
    uninstall();
  });

  it('displays pylon load and highlights overload state', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);

    hud.update({
      colonies: [
        {
          index: 0,
          power: {
            supply: 150,
            demand: 95,
            pylonLoads: { 50: { flow: 95, max: 80, overloaded: true } },
            overloadedEntityIds: [50],
          },
        },
      ],
      entities: [
        { id: 50, kind: ENTITY_KIND.pylon, owner: 0, hp: 100, hpMax: 100, state: ENTITY_STATE.active },
      ],
      pylonLoads: { 50: { flow: 95, max: 80, overloaded: true } },
    } as unknown as GameView);

    const mockParent = parent as unknown as MockElement;
    const banner = mockParent.querySelector('.ta-power-hud__brownout')!;
    expect(banner.getAttribute('data-overload')).toBe('true');
    expect(banner.textContent).toContain('POWER OVERLOAD');

    const inspector = mockParent.querySelector('.ta-building-inspector')!;
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Power Pylon');
    expect(inspector.querySelector('.ta-building-inspector__load')?.textContent).toBe('95 / 80 E/s');
    expect(inspector.querySelector('.ta-building-inspector__state')?.textContent).toBe('OVERLOAD');
    expect(inspector.getAttribute('data-overload')).toBe('true');

    hud.dispose();
  });
});
