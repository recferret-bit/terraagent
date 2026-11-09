import 'reflect-metadata';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import type { AppEnv } from '../../src/core/tokens';
import { PlanetHost } from '../../src/game/thread/planet-host';
import { SnapshotService } from '../../src/game/persistence/snapshot.service';
import type { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { AuditMetadataRequiredError, LobbyPersistenceService, MemoryLobbyStore, WorldLifecycleService } from '../../src/lobby';

const ON = { SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: 60, NODE_ENV: 'test' } as unknown as AppEnv;
const OFF = { SNAPSHOTS: 'off', SNAPSHOT_EVERY_S: 60, NODE_ENV: 'test' } as unknown as AppEnv;

describe('seal and end save points', () => {
  it('pause records SEAL and a committed archive records END; a rejected pause records nothing', async () => {
    const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
    const lifecycle = new WorldLifecycleService(persistence);
    const calls: [string, string][] = [];
    lifecycle.setSnapshotSavePoint(async (planetId, kind) => { calls.push([planetId, kind]); });
    const { world } = await persistence.provisionCanonicalWorld({ type: 'desert' });

    await expect(lifecycle.pausePlanetAdmission({ planetId: world.id, actor: '   ', reason: 'no' })).rejects.toThrow(AuditMetadataRequiredError);
    expect(calls).toEqual([]);

    await lifecycle.pausePlanetAdmission({ planetId: world.id, actor: 'ops', reason: 'stop new founders' });
    expect(calls).toEqual([[world.id, 'SEAL']]);

    await expect(lifecycle.transitionWorldLifecycle({ planetId: world.id, toLifecycle: 'SEALED' })).rejects.toThrow();
    expect(calls).toEqual([[world.id, 'SEAL']]);

    await lifecycle.archiveWorld({ planetId: world.id, actor: 'ops', reason: 'explicit end' });
    expect(calls).toEqual([[world.id, 'SEAL'], [world.id, 'END']]);
  });

  it('asks the loaded planet for SEAL and END, skips an unloaded planet, and does not retag after giving up', async () => {
    const saved: string[] = [];
    let listener: ((id: string, s: { tick: number; bytes: Uint8Array }) => void) | undefined;
    const planets = {
      isLoaded: (id: string) => id === 'p',
      loadedIds: () => ['p'],
      requestSnapshot: (id: string) => { if (id === 'p') queueMicrotask(() => listener?.('p', { tick: saved.length + 1, bytes: new Uint8Array([1]) })); },
      onPlanetLoaded: () => {},
      onPlanetUnloaded: () => {},
      onPlanetSnapshot: (fn: (id: string, s: { tick: number; bytes: Uint8Array }) => void) => { listener = fn; },
    };
    const store = {
      save: async (_id: string, _tick: number, kind: string) => { saved.push(kind); return { sizeBytes: 1 }; },
      prune: async () => 0,
    };
    const root = pino({ level: 'silent' });
    const svc = new SnapshotService(planets as never, store as unknown as SnapshotStore, new MetricsRegistry(), ON, root);
    await svc.seal('missing');
    expect(saved).toEqual([]);
    await svc.seal('p');
    await svc.end('p');
    expect(saved).toEqual(['SEAL', 'END']);

    const quiet = {
      ...planets,
      requestSnapshot: () => {},
      onPlanetSnapshot: (fn: (id: string, s: { tick: number; bytes: Uint8Array }) => void) => { listener = fn; },
    };
    const late: string[] = [];
    const lateStore = { save: async (_id: string, _tick: number, kind: string) => { late.push(kind); return { sizeBytes: 1 }; }, prune: async () => 0 };
    const givingUp = new SnapshotService(quiet as never, lateStore as unknown as SnapshotStore, new MetricsRegistry(), ON, root);
    await givingUp.capture('p', 'SEAL', 15);
    listener?.('p', { tick: 9, bytes: new Uint8Array([9]) });
    await vi.waitFor(() => expect(late).toEqual(['PERIODIC']));

    const off = new SnapshotService(planets as never, store as unknown as SnapshotStore, new MetricsRegistry(), OFF, root);
    await off.seal('p');
    expect(saved).toEqual(['SEAL', 'END']);
  });
});

describe('snapshot compression stays off the sim step', () => {
  it('step posts no snapshot; snapshotNow encodes and does not gzip', () => {
    const out: { t: string; bytes?: Uint8Array }[] = [];
    const host = new PlanetHost(0, ['W00'], (m) => { out.push(m); });
    host.handle({ t: 'load', planetId: 'pl_z', params: { type: 'flat' } });
    expect(host.stepPlanet('pl_z', 1)).toBe(true);
    expect(out.some((m) => m.t === 'snapshot')).toBe(false);
    host.handle({ t: 'snapshotNow', planetId: 'pl_z' });
    const snaps = out.filter((m) => m.t === 'snapshot');
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.bytes?.[0]).not.toBe(0x1f);
    expect(snaps[0]?.bytes?.[1]).not.toBe(0x8b);
  });
});
