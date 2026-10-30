import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { newId } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';
import { LagTransport } from '../../../../frontend/game/net/LagTransport';
import { WsTransport, type SocketLike } from '../../../../frontend/game/net/WsTransport';
import { ReplicaCore } from '../../../../frontend/game/store/replica/ReplicaCore';
import { SimWorkerController } from '../../../../frontend/game/store/worker/SimWorkerController';

const LAG = 300;
const PLANET = devPlanetIds(1, 1)[0]!;
let app: INestApplication | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms: number, step = 5): Promise<number> {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error(`timeout after ${ms} ms`);
    await sleep(step);
  }
  return performance.now() - t0;
}

describe('prediction against the real server with ?lag=300', () => {
  it('shows a nudge on the next frame, confirms it ~2 x lag later and converges', async () => {
    const created = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', GAME_DEV_PLANETS: '1' } });
    await created.app.listen(0, '127.0.0.1');
    app = created.app;
    const port = new URL((await created.app.getUrl()).replace('[::1]', '127.0.0.1')).port;

    const ws = new WsTransport(
      { url: `ws://127.0.0.1:${port}/ws`, accessToken: 'dev:alice', resolve: async () => ({ planetId: PLANET }) },
      { socket: (url) => new WebSocket(url) as unknown as SocketLike, now: () => Date.now(), setTimer: (f, ms) => setTimeout(f, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), random: Math.random, clientVersion: 't' },
    );
    const transport = new LagTransport(ws, LAG);
    // The routing WorldStore does (it needs DOM types, which this package does not load): server messages into the worker.
    let latestView: { entities: Float32Array; count: number } | null = null;
    const ctl = new SimWorkerController((m) => { if (m.t === 'view') latestView = { entities: new Float32Array(m.view.entities), count: m.view.count }; }, new ReplicaCore());
    ctl.handle({ t: 'init', flags: ['W00'], predict: true });
    transport.onMessage((m) => {
      if (m.t === 'welcome') ctl.handle({ t: 'welcome', state: m.d.state, tick: m.d.tick, flags: [...m.d.flags], dataHash: m.d.dataHash, simVersion: m.d.simVersion, serverTimeMs: m.d.serverTimeMs });
      else if (m.t === 'delta') ctl.handle({ t: 'delta', fromTick: m.d.fromTick, toTick: m.d.toTick, diff: m.d.diff });
      else if (m.t === 'cmd.ack') ctl.handle({ t: 'ack', id: m.d.id, appliedAtTick: m.d.appliedAtTick });
      else if (m.t === 'cmd.reject') ctl.handle({ t: 'reject', id: m.d.id, code: m.d.code });
    });
    transport.start();
    try {
      await until(() => latestView !== null, 5000);
      const send = (kind: string, args: unknown, predict: boolean) => {
        const id = newId('cm');
        transport.send({ t: 'cmd', id, d: { kind, args } });
        if (predict) ctl.handle({ t: 'cmdSent', id, kind, args, sentAtMs: Date.now() });
        return id;
      };
      const entity = (host: { view(): { entities: { id: number; x: number }[] } }, id: number) => host.view().entities.find((e) => e.id === id);

      send('dev.spawn', { q: 3, r: 4 }, false);
      await until(() => ctl.core.loaded && ctl.core.simHost.view().entities.length > 0, 5000);
      const id = ctl.core.simHost.view().entities[0].id;
      await sleep(700); // let spawn's ack and deltas settle
      const x0 = entity(ctl.core.simHost, id)!.x;
      const viewX = () => { const v = latestView!; for (let i = 0; i < v.count; i++) if (v.entities[i * 12] === id) return v.entities[i * 12 + 5]; return NaN; };
      expect(viewX()).toBeCloseTo(x0, 4);

      const t0 = performance.now();
      send('dev.nudge', { id, dq: 1 }, true);
      const predictedAfter = await until(() => viewX() > x0 + 0.1, 1000, 1);
      const confirmedAfter = await until(() => entity(ctl.core.simHost, id)!.x > x0 + 0.1, 3000, 5);
      const confirmedAt = performance.now() - t0;
      const predictedVal = viewX();
      await until(() => ctl.predictor.pending.length === 0, 3000);
      const confirmed = entity(ctl.core.simHost, id)!.x;
      await sleep(50);
      const diff = Math.abs(viewX() - confirmed);
      console.log(`[prediction-lag] predicted view after ${predictedAfter.toFixed(1)} ms; confirmed after ${confirmedAt.toFixed(0)} ms (poll ${confirmedAfter.toFixed(0)}); predicted ${predictedVal.toFixed(3)} confirmed ${confirmed.toFixed(3)} final diff ${diff.toFixed(4)}`);
      expect(predictedAfter).toBeLessThanOrEqual(20);
      expect(confirmedAt).toBeGreaterThanOrEqual(2 * LAG - 50);
      expect(diff).toBeLessThan(0.05);
    } finally {
      transport.dispose();
    }
  }, 30_000);
});
