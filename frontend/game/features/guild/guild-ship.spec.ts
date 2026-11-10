import { describe, expect, it, vi } from 'vitest';
import type { GuildArrivedPayload, GuildDepartedPayload, ServerMessage } from '@terra/contracts';
import { ENTITY_KIND, type ViewEntity } from '@terra/sim';
import * as THREE from 'three';
import { GUILD_HOVER_M, GuildShipRig } from '@terra/render/visuals/space/GuildShipRig';
import { DEFAULT_GUILD_DOT_COLOR, clearExtraMapDot, drawEntityDots, setExtraMapDot } from '../../maps/entityDots';
import type { MapLayerDrawView } from '../../maps/types';
import type { FeatureContext } from '../../core/registry/types';
import guildFeature from './index';
import { GUILD_DOCK_FALLBACK, dockSpotFromView, pickBusiestDock } from './dockSpot';
import { GUILD_TRANSIT_MS, GuildShipPresenter, type GuildDockMark } from './GuildShipPresenter';
import { GuildShipView } from './GuildShipView';

const ARRIVED: GuildArrivedPayload = {
  shipId: 'kestrel',
  planetId: 'pl_1',
  npcId: 'kestrel',
  name: 'Kestrel',
  departAt: 1_700_000_000_000,
  offers: [],
};
const DEPARTED: GuildDepartedPayload = { shipId: 'kestrel', planetId: 'pl_1', npcId: 'kestrel' };

function ent(id: number, kind: number, q: number, r: number, hp = 10): ViewEntity {
  return { id, kind, owner: 0, tier: 1, q, r, x: q, y: r, rot: 0, hp, hpMax: 10, state: 0, progress: 0 };
}

function presenter(opts: { w04: boolean; marker?: (m: GuildDockMark) => void; dock?: boolean }) {
  let t = 0;
  const dockFor = vi.fn(() => ({ q: 4, r: -1, hubId: 9, hubQ: 3, hubR: -1 }));
  const p = new GuildShipPresenter({
    now: () => t,
    w04: opts.w04,
    marker: opts.marker,
    dockFor: opts.dock === false ? undefined : dockFor,
  });
  return {
    p,
    dockFor,
    set(ms: number) {
      t = ms;
      p.sync();
    },
  };
}

describe('W15-15 guild ship phases', () => {
  it('arrived descends, then docks after 3s, and bobs only while docked', () => {
    const marker = vi.fn();
    const { p, set } = presenter({ w04: true, marker });
    expect(p.arrive(ARRIVED)).toBe(true);
    expect(p.phase('kestrel')).toBe('descending');
    expect(p.pose('kestrel')!.altitudeM).toBeGreaterThan(30);
    expect(p.pose('kestrel')!.bobM).toBe(0);
    expect(marker).not.toHaveBeenCalled();

    set(GUILD_TRANSIT_MS - 1);
    expect(p.phase('kestrel')).toBe('descending');

    set(GUILD_TRANSIT_MS);
    expect(p.phase('kestrel')).toBe('docked');
    expect(p.pose('kestrel')!.altitudeM).toBe(0);
    expect(marker).toHaveBeenCalledTimes(1);
    expect(marker).toHaveBeenCalledWith({ shipId: 'kestrel', q: 4, r: -1, visible: true });

    set(GUILD_TRANSIT_MS + 400);
    expect(p.pose('kestrel')!.bobM).not.toBe(0);
  });

  it('departed lifts off and is gone after another 3s', () => {
    const marker = vi.fn();
    const { p, set } = presenter({ w04: true, marker });
    p.arrive(ARRIVED);
    set(GUILD_TRANSIT_MS);
    p.depart(DEPARTED);
    expect(p.phase('kestrel')).toBe('departing');
    expect(marker).toHaveBeenLastCalledWith({ shipId: 'kestrel', q: 4, r: -1, visible: false });
    expect(p.pose('kestrel')!.flame).toBeGreaterThan(0);

    set(GUILD_TRANSIT_MS * 2 - 1);
    expect(p.phase('kestrel')).toBe('departing');
    expect(p.pose('kestrel')!.altitudeM).toBeGreaterThan(20);
    set(GUILD_TRANSIT_MS * 2);
    expect(p.phase('kestrel')).toBe('gone');
  });

  it('a second arrived for the same ship does not start another descent', () => {
    const { p, dockFor, set } = presenter({ w04: false });
    p.arrive(ARRIVED);
    const started = p.pose('kestrel')!.startedAt;
    expect(p.arrive(ARRIVED)).toBe(false);
    expect(dockFor).toHaveBeenCalledTimes(1);
    expect(p.pose('kestrel')!.startedAt).toBe(started);
    expect(p.phase('kestrel')).toBe('descending');

    set(GUILD_TRANSIT_MS);
    expect(p.arrive({ ...ARRIVED, departAt: ARRIVED.departAt + 1 })).toBe(false);
    expect(p.phase('kestrel')).toBe('docked');
    expect(dockFor).toHaveBeenCalledTimes(1);
  });

  it('depart during descent cancels the descent and lifts off', () => {
    const marker = vi.fn();
    const { p, set } = presenter({ w04: true, marker });
    p.arrive(ARRIVED);
    set(1000);
    const mid = p.pose('kestrel')!.altitudeM;
    expect(p.phase('kestrel')).toBe('descending');
    expect(p.depart(DEPARTED)).toBe(true);
    expect(p.phase('kestrel')).toBe('departing');
    expect(p.pose('kestrel')!.altitudeM).toBeCloseTo(mid, 5);
    expect(marker).not.toHaveBeenCalled();

    set(1000 + 1500);
    expect(p.pose('kestrel')!.altitudeM).toBeGreaterThan(mid);
    expect(p.phase('kestrel')).toBe('departing');

    set(1000 + GUILD_TRANSIT_MS);
    expect(p.phase('kestrel')).toBe('gone');
    expect(p.depart(DEPARTED)).toBe(false);
  });

  it('W04 off never calls the marker', () => {
    const marker = vi.fn();
    const { p, set } = presenter({ w04: false, marker });
    p.arrive(ARRIVED);
    set(GUILD_TRANSIT_MS);
    p.depart(DEPARTED);
    set(GUILD_TRANSIT_MS * 2);
    expect(p.phase('kestrel')).toBe('gone');
    expect(marker).not.toHaveBeenCalled();
  });

  it('after gone, the next arrived starts a new descent', () => {
    const { p, set } = presenter({ w04: false });
    p.arrive(ARRIVED);
    set(GUILD_TRANSIT_MS);
    p.depart(DEPARTED);
    set(GUILD_TRANSIT_MS * 2);
    expect(p.arrive(ARRIVED)).toBe(true);
    expect(p.phase('kestrel')).toBe('descending');
  });
});

describe('W15-15 other planet', () => {
  it('ignores an arrived or departed push for another planet', () => {
    const p = new GuildShipPresenter({ now: () => 0, w04: false, samePlanet: (id) => id === 'pl_1' });
    expect(p.arrive({ ...ARRIVED, planetId: 'pl_2' })).toBe(false);
    expect(p.phase('kestrel')).toBeUndefined();
    expect(p.arrive(ARRIVED)).toBe(true);
    expect(p.depart({ ...DEPARTED, planetId: 'pl_9' })).toBe(false);
    expect(p.phase('kestrel')).toBe('descending');
  });
});

describe('W15-15 dock spot', () => {
  it('picks the hub with more neighbours, one step +q', () => {
    const spot = pickBusiestDock(
      [
        { id: 1, q: 0, r: 0 },
        { id: 2, q: 8, r: 0 },
      ],
      [
        { q: 8, r: 1 },
        { q: 9, r: 0 },
        { q: 7, r: -1 },
      ],
    );
    expect(spot).toEqual({ q: 9, r: 0, hubId: 2, hubQ: 8, hubR: 0 });
  });

  it('with no hub uses the fallback spot', () => {
    expect(pickBusiestDock([], [{ q: 1, r: 1 }])).toEqual(GUILD_DOCK_FALLBACK);
    expect(dockSpotFromView(null)).toEqual(GUILD_DOCK_FALLBACK);
  });

  it('tie goes to the lower id, and a dead hub is ignored', () => {
    expect(
      pickBusiestDock(
        [
          { id: 5, q: 0, r: 0 },
          { id: 2, q: 8, r: 0 },
        ],
        [],
      ).hubId,
    ).toBe(2);
    const view = dockSpotFromView({
      entities: [ent(1, ENTITY_KIND.tradeHub, 0, 0, 0), ent(4, ENTITY_KIND.tradeHub, 3, 1)],
      count: 2,
    });
    expect(view.hubId).toBe(4);
    expect(view).toMatchObject({ q: 4, r: 1 });
  });
});

function flatMap(at: (q: number, r: number) => { x: number; y: number }): MapLayerDrawView {
  return {
    width: 32,
    height: 32,
    radius: 4,
    tiles: null,
    clientView: null,
    tilePixelRadius: 4,
    axialToPixel: at,
    pixelToAxial: (x: number, y: number) => ({ q: x, r: y }),
  } as MapLayerDrawView;
}

function inkCtx(styles: string[], moves?: number[]): CanvasRenderingContext2D {
  return {
    set fillStyle(c: string) {
      styles.push(c);
    },
    beginPath() {},
    moveTo(x: number) {
      moves?.push(x);
    },
    lineTo() {},
    closePath() {},
    fill() {},
    arc() {},
    stroke() {},
  } as unknown as CanvasRenderingContext2D;
}

/** Mounts the view with a fake transport and a minimap dirty hook. No scene, so no mesh is built. */
function mountVisit(flags: string[], markDirty: ReturnType<typeof vi.fn>): GuildShipView {
  const listeners = new Set<(m: ServerMessage) => void>();
  const ctx = {
    flags: new Set(flags),
    host: 'server',
    services: {
      transport: {
        onMessage(fn: (m: ServerMessage) => void) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      maps: { controller: { scheduler: { markDirty } } },
    },
  } as unknown as FeatureContext;
  const view = new GuildShipView(ctx);
  for (const fn of listeners) fn({ v: 1, t: 'guild.arrived', d: ARRIVED });
  view.update({}, GUILD_TRANSIT_MS / 1000);
  return view;
}

describe('W15-15 minimap mark', () => {
  it('draws a blue ship chevron on the unit-dot pass and removes it when cleared', () => {
    const styles: string[] = [];
    const moves: number[] = [];
    const view = flatMap((q, r) => ({ x: 10 + q, y: 20 + r }));
    setExtraMapDot({ id: 'guild:kestrel', q: 4, r: -1, color: DEFAULT_GUILD_DOT_COLOR, shape: 'ship' });
    drawEntityDots(inkCtx(styles, moves), view);
    expect(styles).toContain(DEFAULT_GUILD_DOT_COLOR);
    expect(moves).toContain(14);
    clearExtraMapDot('guild:kestrel');
    styles.length = 0;
    drawEntityDots(inkCtx(styles), view);
    expect(styles).toEqual([]);
  });

  it('W04 off does not touch the minimap when a visit docks', () => {
    const markDirty = vi.fn();
    const view = mountVisit(['W15'], markDirty);
    expect(markDirty).not.toHaveBeenCalled();
    view.dispose();
  });

  it('W04 on writes the blue dock mark through the unit-dot hook', () => {
    const markDirty = vi.fn();
    const styles: string[] = [];
    const view = mountVisit(['W15', 'W04'], markDirty);
    expect(markDirty).toHaveBeenCalledWith({ minimap: true, globalMap: true });
    drawEntityDots(
      inkCtx(styles),
      flatMap(() => ({ x: 0, y: 0 })),
    );
    expect(styles).toContain(DEFAULT_GUILD_DOT_COLOR);
    clearExtraMapDot('guild:kestrel');
    view.dispose();
  });
});

describe('W15-15 scene parent', () => {
  it('parents the trader on the caller scene with the drop rig under it', () => {
    const rig = new GuildShipRig('dune');
    const scene = new THREE.Group();
    scene.name = 'colony-scene';
    scene.add(rig.root);
    rig.root.name = 'guild-ship:kestrel';
    expect(rig.root.parent).toBe(scene);
    expect(rig.root.getObjectByName('dropRig')).toBeTruthy();
    rig.place({ x: 2, y: 1, z: 3, altitudeM: 32, bobM: 0, flame: 1, time: 0.2, yaw: 0.4 });
    expect(rig.root.position.y).toBeGreaterThan(30);
    rig.place({ x: 2, y: 1, z: 3, altitudeM: 0, bobM: 0.22, flame: 0, time: 1, yaw: 0 });
    expect(rig.root.position.y).toBeCloseTo(1 + GUILD_HOVER_M + 0.22, 5);
    rig.dispose();
    expect(rig.root.parent).toBeNull();
  });

  it('the feature is W15 and has no Guild tab', () => {
    expect(guildFeature.id).toBe('guild');
    expect(guildFeature.wave).toBe('W15');
    expect(guildFeature.hud).toBeUndefined();
    expect(guildFeature.renderers?.map((r) => r.id)).toEqual(['guild-ship']);
  });
});
