import { describe, expect, it, vi } from 'vitest';
import { hexIndex, setTileTerrain, spawnHqUnit, TERRAIN } from '@terra/sim';
import { LocalHost } from '../../store/WorldStore';
import { LandfallController } from './index';

describe('order feedback: an unreachable move is reported once', () => {
  it('a walled-in target ends the move in the sim and the client toasts it exactly once (predicted + confirmed views)', () => {
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const idx = hexIndex(host.state.grid.radius);
    for (const [q, r] of [[6, 0], [4, 0], [5, 1], [5, -1], [4, 1], [6, -1]]) setTileTerrain(host.state.grid, idx.indexOf(q, r), TERRAIN.rock);
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const failed = vi.fn();
    const ctl = new LandfallController({ ownerColonyIndex: 0, onOrderFailed: failed });
    ctl.onView(host.sync(true));
    host.store.sendCommand({ type: 'moveUnit', entityId: hqId, q: 5, r: 0 });
    const view = host.step(1);
    ctl.onView(view);
    ctl.onView(view); // the same failure again (e.g. predicted, then confirmed)
    ctl.onView(host.step(3));
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toMatchObject({ code: 'no_path', kind: 'move', source: 'player' });
  });

  it('two unreachable orders in a row are two toasts; auto work that cannot reach its tile is never toasted', () => {
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const idx = hexIndex(host.state.grid.radius);
    for (const [q, r] of [[6, 0], [4, 0], [5, 1], [5, -1], [4, 1], [6, -1]]) setTileTerrain(host.state.grid, idx.indexOf(q, r), TERRAIN.rock);
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const failed = vi.fn();
    const ctl = new LandfallController({ ownerColonyIndex: 0, onOrderFailed: failed });
    ctl.onView(host.sync(true));
    host.store.sendCommand({ type: 'moveUnit', entityId: hqId, q: 5, r: 0 });
    ctl.onView(host.step(2));
    host.store.sendCommand({ type: 'moveUnit', entityId: hqId, q: 5, r: 0 });
    ctl.onView(host.step(2));
    host.store.sendCommand({ type: 'enqueueTask', terraform: { op: 'grade', tiles: [{ q: 5, r: 0 }] } });
    ctl.onView(host.step(10));
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('a failure that happened before the client joined is not toasted', () => {
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const idx = hexIndex(host.state.grid.radius);
    for (const [q, r] of [[6, 0], [4, 0], [5, 1], [5, -1], [4, 1], [6, -1]]) setTileTerrain(host.state.grid, idx.indexOf(q, r), TERRAIN.rock);
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    host.store.sendCommand({ type: 'moveUnit', entityId: hqId, q: 5, r: 0 });
    host.step(2);
    const failed = vi.fn();
    const ctl = new LandfallController({ ownerColonyIndex: 0, onOrderFailed: failed });
    ctl.onView(host.step(1));
    expect(failed).not.toHaveBeenCalled();
  });
});

describe('stop key', () => {
  it('stopSelected sends stopUnit for the selected HQ only', () => {
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const sendCommand = vi.fn();
    const ctl = new LandfallController({ ownerColonyIndex: 0, store: { sendCommand } });
    ctl.onView(host.sync(true));
    expect(ctl.stopSelected()).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith({ type: 'stopUnit', entityId: hqId });
    ctl.deselect();
    expect(ctl.stopSelected()).toBe(false);
  });
});
