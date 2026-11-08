// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ENTITY_KIND } from '@terra/sim';
import type { FeatureContext } from '../../../core/registry/types';
import { createMapLayerRegistry } from '../../../maps/layerRegistry';
import type { MapLayerDrawView } from '../../../maps/types';
import {
  barHeightForKind,
  hpColorForRatio,
  isBarSupportedKind,
  isMobileUnitKind,
  UnitHealthBars,
} from '../../../app/online/unitHealthBars';
import {
  ALERT_PING_DURATION_MS,
  combatFeature,
  mountCombatFeature,
} from '../index';

function makeContext(services?: Partial<FeatureContext['services']>): FeatureContext {
  return {
    flags: new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W07']),
    host: 'local',
    services: {
      track: () => undefined,
      ...services,
    },
  };
}

describe('W07-20: UnitHealthBars damaged/selected building HP bars & colony tinting', () => {
  it('shows a building HP bar when damaged or selected, and hides it at full HP when unselected', () => {
    const scene = new THREE.Scene();
    const bars = new UnitHealthBars(scene);
    const mesh = new THREE.Object3D();

    // Full HP and unselected -> no bar created
    bars.sync([{ id: 10, kind: ENTITY_KIND.autocannon, hp: 450, hpMax: 450, mesh }]);
    expect(bars.group.getObjectByName('unit-hp-10')).toBeUndefined();

    // Selecting a full-HP building -> HP bar appears
    bars.setSelectedEntityId(10);
    bars.sync([{ id: 10, kind: ENTITY_KIND.autocannon, hp: 450, hpMax: 450, mesh }]);
    const selectedRoot = bars.group.getObjectByName('unit-hp-10');
    expect(selectedRoot).toBeDefined();
    expect(selectedRoot?.getObjectByName('hp-bar-group')?.visible).toBe(true);

    // Deselecting -> hidden/removed again at full HP
    bars.setSelectedEntityId(null);
    bars.sync([{ id: 10, kind: ENTITY_KIND.autocannon, hp: 450, hpMax: 450, mesh }]);
    expect(bars.group.getObjectByName('unit-hp-10')).toBeUndefined();

    // Damaging the building -> HP bar appears even when unselected
    bars.sync([{ id: 10, kind: ENTITY_KIND.autocannon, hp: 300, hpMax: 450, mesh }]);
    const damagedRoot = bars.group.getObjectByName('unit-hp-10');
    expect(damagedRoot).toBeDefined();
    expect(damagedRoot?.getObjectByName('hp-bar-group')?.visible).toBe(true);

    bars.dispose();
  });

  it('supports W07 mobile units, fauna bugs, buildings, hives, and colony/hostile colour tinting', () => {
    for (const unitKind of ['recon', 'demoTank', 'demoArtillery', 'blackAnt', 'blueBeetle', 'greenSpitter', 'builder']) {
      expect(isMobileUnitKind(unitKind)).toBe(true);
      expect(isBarSupportedKind(unitKind)).toBe(true);
      expect(barHeightForKind(unitKind)).toBe(1.55);
    }

    for (const bldgKind of ['roboticsFactory', 'blackAntHive', 'blueBeetleHive', 'greenSpitterHive']) {
      expect(isBarSupportedKind(bldgKind)).toBe(true);
      expect(barHeightForKind(bldgKind)).toBe(2.6);
    }

    for (const turretKind of ['autocannon', 'laserTower', 'droneControlArray', 'pylon']) {
      expect(isBarSupportedKind(turretKind)).toBe(true);
      expect(barHeightForKind(turretKind)).toBe(1.9);
    }

    // Own colony default green / amber / red
    expect(hpColorForRatio(0.9, 0, 0)).toBe(0x39ff88);
    expect(hpColorForRatio(0.45, 0, 0)).toBe(0xff9b2f);
    expect(hpColorForRatio(0.15, 0, 0)).toBe(0xff3b3b);

    // Hostile fauna (owner < 0) and foreign colony (owner !== ownColonyIndex)
    expect(hpColorForRatio(0.9, -2, 0)).toBe(0xf04848);
    expect(hpColorForRatio(0.9, 1, 0)).toBe(0x38bdf8);

    const scene = new THREE.Scene();
    const bars = new UnitHealthBars(scene);
    bars.sync([{ id: 77, kind: ENTITY_KIND.blackAnt, hp: 60, hpMax: 60, owner: -2, mesh: new THREE.Object3D() }]);
    const antBar = bars.group.getObjectByName('unit-hp-77');
    expect(antBar?.userData.owner).toBe(-2);
    bars.dispose();
  });
});

describe('W07-20: CombatAlertsHud screen-edge under-attack pings', () => {
  it('renders an off-screen underAttack edge ping, jumps the camera on click, and expires after 5s', () => {
    let nowMs = 1000;
    const focusTile = vi.fn();
    const panToTile = vi.fn();
    const ctx = makeContext({
      colonyId: 0,
      focusTile,
      maps: {
        layerRegistry: createMapLayerRegistry(),
        panToTile,
      } as unknown as FeatureContext['services']['maps'],
    });

    const host = document.createElement('div');
    const mounted = mountCombatFeature(host, ctx, { now: () => nowMs });
    expect(ctx.services.combatAlerts).toBe(mounted.hud);

    // Emit off-screen underAttack at (25, -18) while camera is at (0, 0)
    mounted.update({
      tick: 50,
      events: [
        {
          kind: 'underAttack',
          tick: 50,
          data: { colonyIndex: 0, q: 25, r: -18, attackerId: 90, entityId: 12 },
        },
      ],
    });

    const pingBtn = host.querySelector('[data-under-attack-ping]') as HTMLButtonElement | null;
    expect(pingBtn).not.toBeNull();
    expect(pingBtn?.getAttribute('data-q')).toBe('25');
    expect(pingBtn?.getAttribute('data-r')).toBe('-18');
    expect(['top', 'bottom', 'left', 'right']).toContain(pingBtn?.getAttribute('data-edge'));

    // Clicking the edge ping focuses the camera at (25, -18)
    pingBtn?.click();
    expect(focusTile).toHaveBeenCalledWith(25, -18, true);
    expect(panToTile).toHaveBeenCalledWith(25, -18);

    // Move camera back to (0, 0) and verify ping expires after 5000 ms
    mounted.hud.setFocusTile(0, 0);
    expect(host.querySelector('[data-under-attack-ping]')).not.toBeNull();

    nowMs += ALERT_PING_DURATION_MS + 10;
    mounted.update({ tick: 75 });
    expect(host.querySelector('[data-under-attack-ping]')).toBeNull();

    mounted.dispose();
    expect(ctx.services.combatAlerts).toBeUndefined();
  });
});

describe('W07-20: CombatAlertsHud event log', () => {
  it('records combat event log entries and focuses the camera when clicking a log entry', () => {
    const focusTile = vi.fn();
    const ctx = makeContext({
      colonyId: 0,
      focusTile,
    });
    const host = document.createElement('div');
    const panelDef = combatFeature.hud?.[0];
    expect(panelDef).toBeDefined();
    const mounted = panelDef!.mount(host, ctx);

    const alerts = ctx.services.combatAlerts!;
    alerts.triggerEvent({ kind: 'underAttack', data: { q: 12, r: -4 } });
    alerts.triggerEvent({ kind: 'raidStarted', data: { species: 'blackAnt', q: 18, r: -9 } });
    alerts.triggerEvent({ kind: 'raidRepelled', data: { unbreached: true, q: 6, r: -2 } });
    alerts.triggerEvent({ kind: 'buildingDestroyed', data: { building: 'autocannon', q: 4, r: 2 } });
    alerts.triggerEvent({ kind: 'unitDestroyed', data: { unit: 'recon', q: 8, r: -3 } });
    alerts.triggerEvent({ kind: 'nestDestroyed', data: { species: 'blueBeetle', q: 22, r: -14 } });

    const logSection = host.querySelector('[data-combat-log]');
    expect(logSection).not.toBeNull();
    expect(logSection?.getAttribute('data-empty')).toBe('false');

    const entries = [...host.querySelectorAll('[data-combat-log-entry]')] as HTMLButtonElement[];
    expect(entries).toHaveLength(6);

    const kinds = entries.map((e) => e.getAttribute('data-event-kind'));
    expect(kinds).toEqual([
      'nestDestroyed',
      'unitDestroyed',
      'buildingDestroyed',
      'raidRepelled',
      'raidStarted',
      'underAttack',
    ]);

    const repelledEntry = entries.find((e) => e.getAttribute('data-event-kind') === 'raidRepelled');
    expect(repelledEntry?.textContent).toContain('(Unbreached)');

    // Clicking the nestDestroyed entry focuses the camera at (22, -14)
    entries[0]?.click();
    expect(focusTile).toHaveBeenCalledWith(22, -14, true);

    mounted.dispose();
  });
});

describe('W07-20: W04 threats map layer integration', () => {
  it('registers the W04 threats map layer and draws hive markers and active alert ping rings', () => {
    const registry = createMapLayerRegistry();
    const ctx = makeContext({
      colonyId: 0,
      maps: {
        layerRegistry: registry,
        panToTile: vi.fn(),
      } as unknown as FeatureContext['services']['maps'],
    });

    const host = document.createElement('div');
    const mounted = mountCombatFeature(host, ctx);

    const threatsLayer = registry.get('threats');
    expect(threatsLayer).toBeDefined();
    expect(threatsLayer?.wave).toBe('W07');

    mounted.hud.pushUnderAttackPing({ q: 14, r: -7 });

    const canvasCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;

    const drawView: MapLayerDrawView = {
      width: 180,
      height: 180,
      radius: 20,
      tiles: null,
      clientView: {
        tick: 10,
        count: 1,
        entities: [
          {
            id: 501,
            kind: ENTITY_KIND.hiveBlackAnt,
            owner: -2,
            q: 20,
            r: -10,
            x: 20,
            y: -10,
            rot: 0,
            hp: 1500,
            hpMax: 1500,
            state: 0,
            progress: 0,
          },
        ],
      } as unknown as MapLayerDrawView['clientView'],
      axialToPixel: (q, r) => ({ x: 90 + q * 3, y: 90 + r * 3 }),
      pixelToAxial: (x, y) => ({ q: Math.round((x - 90) / 3), r: Math.round((y - 90) / 3) }),
      tilePixelRadius: 4,
    };

    threatsLayer!.draw(canvasCtx, drawView);
    expect(canvasCtx.fill).toHaveBeenCalled();
    expect(canvasCtx.arc).toHaveBeenCalled();

    mounted.dispose();
    expect(registry.get('threats')).toBeUndefined();
  });
});
