import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { PowerHud } from './PowerHud';
import { installMockDocument, MockElement } from '../test-dom';

describe('PowerHud - balance and clock', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('renders power balance and day/night clock', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);

    hud.update({
      colonies: [
        {
          power: {
            supply: 28,
            demand: 11,
            net: 17,
            phase: 'day',
            clockText: '11:30',
            daylight: 0.95,
            brownout: false,
          },
        },
      ],
    });

    const mockParent = parent as unknown as MockElement;
    expect(mockParent.querySelector('.ta-power-hud__flow')?.textContent).toBe('+28 / −11 E/s');
    expect(mockParent.querySelector('.ta-power-hud__net')?.textContent).toBe('+17 E/s');
    expect(mockParent.querySelector('.ta-power-hud__clock-icon')?.textContent).toBe('☀');
    expect(mockParent.querySelector('.ta-power-hud__clock-text')?.textContent).toBe('11:30');
    expect(mockParent.querySelector('.ta-power-hud__daylight')?.textContent).toBe('95%');

    hud.dispose();
  });

  it('shows moon icon and 0% daylight at night', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new PowerHud(parent);

    hud.update({
      colonies: [
        {
          power: {
            supply: 8,
            demand: 14,
            net: -6,
            phase: 'night',
            clockText: '23:00',
            daylight: 0.0,
            brownout: true,
            shedGroupsActive: [3],
            shedEntityIds: [42],
            offlineReasons: { 42: 'offline: brownout' },
          },
        },
      ],
    });

    const mockParent = parent as unknown as MockElement;
    expect(mockParent.querySelector('.ta-power-hud__clock-icon')?.textContent).toBe('☾');
    expect(mockParent.querySelector('.ta-power-hud__clock-text')?.textContent).toBe('23:00');
    expect(mockParent.querySelector('.ta-power-hud__daylight')?.textContent).toBe('0%');
    expect(mockParent.querySelector('.ta-power-hud__net')?.getAttribute('data-deficit')).toBe('true');

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
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Metals Extractor');
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
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Metals Extractor');
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

    const buf = new Float32Array(12);
    buf[0] = 12;
    buf[1] = ENTITY_KIND.metalsExtractor;
    buf[8] = 450;
    buf[9] = 500;
    buf[10] = ENTITY_STATE.offlineBrownout;

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
    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Metals Extractor');
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

    expect(inspector.querySelector('.ta-building-inspector__title')?.textContent).toBe('Metals Extractor');

    hud.dispose();
  });
});
