import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResourcesHud } from './ResourcesHud';
import { GameHud } from '../../ui/hud';
import { installMockDocument, MockElement } from '../test-dom';

describe('ResourcesHud - mounting and updates', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('mounts and creates 4 resource chips', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new ResourcesHud(parent);

    const energyChip = (parent as unknown as MockElement).querySelector('[data-family="energy"]');
    const metalsChip = (parent as unknown as MockElement).querySelector('[data-family="metals"]');
    const mineralsChip = (parent as unknown as MockElement).querySelector('[data-family="minerals"]');
    const bioChip = (parent as unknown as MockElement).querySelector('[data-family="bio"]');

    expect(energyChip).not.toBeNull();
    expect(metalsChip).not.toBeNull();
    expect(mineralsChip).not.toBeNull();
    expect(bioChip).not.toBeNull();

    hud.dispose();
    expect((parent as unknown as MockElement).children.length).toBe(0);
  });

  it('updates stock, cap, and income per second from view', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new ResourcesHud(parent);

    hud.update({
      colonies: [
        {
          stock: {
            'metals.t1': 400,
            'metals.t2': 0,
            'metals.t3': 0,
            'minerals.t1': 250,
            'bio.water': 150,
            'bio.biomass': 150,
          },
          caps: { metals: 500, minerals: 500, bio: 500 },
          production: {
            familyIncomePerS: { metals: 1.0, minerals: 0.5, bio: 0.2 },
            incomePerS: { 'metals.t1': 1.0, 'minerals.t1': 0.5, 'bio.water': 0.2 },
            capped: { metals: 0, minerals: 0, bio: 0 },
            produced: {},
          },
          power: { supply: 8, demand: 5, net: 3 },
        },
      ],
    });

    const metalsChip = (parent as unknown as MockElement).querySelector('[data-family="metals"]')!;
    expect(metalsChip.querySelector('.ta-res-chip__stock')?.textContent).toBe('400 / 500');
    expect(metalsChip.querySelector('.ta-res-chip__rate')?.textContent).toBe('+1.0/s');
    expect(metalsChip.getAttribute('data-capped')).toBe('false');

    const mineralsChip = (parent as unknown as MockElement).querySelector('[data-family="minerals"]')!;
    expect(mineralsChip.querySelector('.ta-res-chip__stock')?.textContent).toBe('250 / 500');
    expect(mineralsChip.querySelector('.ta-res-chip__rate')?.textContent).toBe('+0.5/s');

    const bioChip = (parent as unknown as MockElement).querySelector('[data-family="bio"]')!;
    expect(bioChip.querySelector('.ta-res-chip__stock')?.textContent).toBe('300 / 500');
    expect(bioChip.querySelector('.ta-res-chip__rate')?.textContent).toBe('+0.2/s');

    const energyChip = (parent as unknown as MockElement).querySelector('[data-family="energy"]')!;
    expect(energyChip.querySelector('.ta-res-chip__stock')?.textContent).toBe('+8 / −5 E/s');
    expect(energyChip.querySelector('.ta-res-chip__rate')?.textContent).toBe('+3 E/s');

    hud.dispose();
  });
});

describe('ResourcesHud - capping and breakdown', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('turns red with data-capped="true" and class ta-res-chip--capped when cap is reached', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new ResourcesHud(parent);

    hud.update({
      colonies: [
        {
          stock: { 'metals.t1': 500, 'minerals.t1': 100, 'bio.water': 50 },
          caps: { metals: 500, minerals: 500, bio: 500 },
          production: {
            familyIncomePerS: { metals: 0, minerals: 0, bio: 0 },
            incomePerS: {},
            capped: { metals: 10, minerals: 0, bio: 0 },
            produced: {},
          },
        },
      ],
    });

    const metalsChip = (parent as unknown as MockElement).querySelector('[data-family="metals"]')!;
    expect(metalsChip.getAttribute('data-capped')).toBe('true');
    expect(metalsChip.classList.contains('ta-res-chip--capped')).toBe(true);

    const mineralsChip = (parent as unknown as MockElement).querySelector('[data-family="minerals"]')!;
    expect(mineralsChip.getAttribute('data-capped')).toBe('false');
    expect(mineralsChip.classList.contains('ta-res-chip--capped')).toBe(false);

    hud.dispose();
  });

  it('populates per-tier breakdown with locked status on non-T1', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new ResourcesHud(parent);

    hud.update({
      colonies: [
        {
          stock: { 'metals.t1': 400, 'metals.t2': 0, 'metals.t3': 0 },
          caps: { metals: 500, minerals: 500, bio: 500 },
          production: {
            familyIncomePerS: { metals: 1.0, minerals: 0, bio: 0 },
            incomePerS: { 'metals.t1': 1.0 },
            capped: { metals: 0, minerals: 0, bio: 0 },
            produced: {},
          },
        },
      ],
    });

    const metalsChip = (parent as unknown as MockElement).querySelector('[data-family="metals"]')!;
    const rows = metalsChip.querySelectorAll('.ta-res-breakdown__row');
    expect(rows.length).toBe(3);

    const t1Row = metalsChip.querySelector('[data-res="metals.t1"]')!;
    expect(t1Row.getAttribute('data-locked')).toBe('false');
    expect(t1Row.querySelector('.ta-res-breakdown__amount')?.textContent).toBe('400');
    expect(t1Row.querySelector('.ta-res-breakdown__rate')?.textContent).toBe('+1.0/s');

    const t2Row = metalsChip.querySelector('[data-res="metals.t2"]')!;
    expect(t2Row.getAttribute('data-locked')).toBe('true');
    expect(t2Row.classList.contains('ta-res-tier--locked')).toBe(true);

    expect(metalsChip.querySelector('[data-testid="res-income-metals"]')?.textContent).toBe('Income: +1.0/s');
    expect(metalsChip.querySelector('[data-testid="res-spending-metals"]')?.textContent).toBe('Spending: −0.0/s');
    expect(metalsChip.querySelector('[data-testid="res-net-metals"]')?.textContent).toBe('Net: +1.0/s');

    hud.dispose();
  });
});

describe('ResourcesHud - spending breakdown', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('computes spending rate from active in_progress queue orders in breakdown popover', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new ResourcesHud(parent);

    hud.update({
      colonies: [
        {
          stock: { 'metals.t1': 400, 'minerals.t1': 250, 'bio.water': 150 },
          caps: { metals: 500, minerals: 500, bio: 500 },
          production: {
            familyIncomePerS: { metals: 1.0, minerals: 0.5, bio: 0 },
            incomePerS: { 'metals.t1': 1.0, 'minerals.t1': 0.5 },
            capped: { metals: 0, minerals: 0, bio: 0 },
            produced: {},
          },
          queue: [
            {
              taskId: 'u-harv-1',
              colonyIndex: 0,
              lane: 'units',
              state: 'in_progress',
              cost: { 'metals.t1': 40, 'minerals.t1': 15, 'bio.biomass': 5 },
              buildTicks: 50,
              workRate: 1.0, // 10s -> 4.0 metals/s, 1.5 minerals/s, 0.5 bio/s
            },
          ],
        },
      ],
    });

    const metalsChip = (parent as unknown as MockElement).querySelector('[data-family="metals"]')!;
    expect(metalsChip.querySelector('[data-testid="res-income-metals"]')?.textContent).toBe('Income: +1.0/s');
    expect(metalsChip.querySelector('[data-testid="res-spending-metals"]')?.textContent).toBe('Spending: −4.0/s');
    expect(metalsChip.querySelector('[data-testid="res-net-metals"]')?.textContent).toBe('Net: −3.0/s');

    const t1Row = metalsChip.querySelector('[data-res="metals.t1"]')!;
    expect(t1Row.querySelector('.ta-res-breakdown__rate')?.textContent).toBe('+1.0 / −4.0/s');
    expect(metalsChip.dataset.trend).toBe('down');
    expect(metalsChip.classList.contains('ta-resources-hud__chip--down')).toBe(true);
    expect(metalsChip.classList.contains('ta-resources-hud__chip--up')).toBe(false);

    const mineralsChip = (parent as unknown as MockElement).querySelector('[data-family="minerals"]')!;
    expect(mineralsChip.dataset.trend).toBe('down');
    expect(mineralsChip.classList.contains('ta-resources-hud__chip--down')).toBe(true);

    hud.dispose();
  });
});

describe('ResourcesHud - trend highlight', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('highlights chip green when increasing, red when decreasing, and neutral when flat', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new ResourcesHud(parent);

    hud.update({
      colonies: [
        {
          stock: { 'metals.t1': 100, 'minerals.t1': 100, 'bio.water': 100 },
          caps: { metals: 500, minerals: 500, bio: 500 },
          production: {
            familyIncomePerS: { metals: 2.0, minerals: 0, bio: 0 },
            incomePerS: { 'metals.t1': 2.0 },
          },
        },
      ],
    });

    const metalsChip = (parent as unknown as MockElement).querySelector('[data-family="metals"]')!;
    const mineralsChip = (parent as unknown as MockElement).querySelector('[data-family="minerals"]')!;
    const bioChip = (parent as unknown as MockElement).querySelector('[data-family="bio"]')!;

    expect(metalsChip.dataset.trend).toBe('up');
    expect(metalsChip.classList.contains('ta-resources-hud__chip--up')).toBe(true);
    expect(mineralsChip.dataset.trend).toBe('flat');
    expect(mineralsChip.classList.contains('ta-resources-hud__chip--up')).toBe(false);
    expect(mineralsChip.classList.contains('ta-resources-hud__chip--down')).toBe(false);

    // Stock delta fallback when rate is 0
    hud.update({
      colonies: [
        {
          stock: { 'metals.t1': 100, 'minerals.t1': 110, 'bio.water': 90 },
          caps: { metals: 500, minerals: 500, bio: 500 },
          production: {
            familyIncomePerS: { metals: 0, minerals: 0, bio: 0 },
            incomePerS: {},
          },
        },
      ],
    });

    expect(metalsChip.dataset.trend).toBe('flat');
    expect(mineralsChip.dataset.trend).toBe('up');
    expect(mineralsChip.classList.contains('ta-resources-hud__chip--up')).toBe(true);
    expect(bioChip.dataset.trend).toBe('down');
    expect(bioChip.classList.contains('ta-resources-hud__chip--down')).toBe(true);

    hud.dispose();
  });
});

describe('GameHud in ui/hud.ts', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installMockDocument();
  });

  afterEach(() => {
    uninstall();
  });

  it('supports legacy setResources and updates DOM', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new GameHud(parent, 'Kharon', 42, { onResume: () => {}, onReturn: () => {} });

    hud.setResources({ energy: 120, metal: 60, water: 40, bio: 10 });

    const mockParent = parent as unknown as MockElement;
    expect(mockParent.querySelector('#r-energy')?.textContent).toBe('120');
    expect(mockParent.querySelector('#r-metal')?.textContent).toBe('60');
    expect(mockParent.querySelector('#r-bio')?.textContent).toBe('10');

    hud.dispose();
  });

  it('updates 3 family chips and energy chip from ledger view and marks capped', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const hud = new GameHud(parent, 'Kharon', 42, { onResume: () => {}, onReturn: () => {} });

    hud.updateFromLedger({
      colonies: [
        {
          stock: { 'metals.t1': 500, 'minerals.t1': 250, 'bio.water': 100 },
          caps: { metals: 500, minerals: 500, bio: 500 },
          production: {
            familyIncomePerS: { metals: 2.0, minerals: 0.5, bio: 0.1 },
            incomePerS: { 'metals.t1': 2.0 },
          },
          power: { supply: 8, demand: 5, net: 3 },
        },
      ],
    });

    const mockParent = parent as unknown as MockElement;
    expect(mockParent.querySelector('#r-metal')?.textContent).toBe('500 / 500');
    expect(mockParent.querySelector('#r-metals-rate')?.textContent).toBe('+2.0/s');
    expect(mockParent.querySelector('#chip-metals')?.getAttribute('data-capped')).toBe('true');
    expect(mockParent.querySelector('#chip-metals')?.classList.contains('ta-res-chip--capped')).toBe(true);

    expect(mockParent.querySelector('#r-mineral')?.textContent).toBe('250 / 500');
    expect(mockParent.querySelector('#chip-minerals')?.getAttribute('data-capped')).toBe('false');

    expect(mockParent.querySelector('#r-energy')?.textContent).toBe('+8 / −5');

    hud.dispose();
  });
});
