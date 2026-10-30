import { flagsFromList } from '@terra/contracts';
import { compileData, createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { ENTITY_STRIDE } from '../replica/viewCodec';
import { SimWorkerController } from '../worker/SimWorkerController';
import type { FromWorker } from '../worker/protocol';

describe('SimWorkerController prediction messages', () => {
  it('emits a predicted view on cmdSent, rolls back and reports on reject, confirmed-only with predict off', () => {
    for (const predict of [true, false]) {
      const auth = new SimHost({ flags: ['W00'] });
      auth.load(createPlanet({ type: 'flat', seed: 'ctl' }));
      auth.submit({ colonyIndex: null, source: 'dev', commandId: 'cm_s', kind: 'dev.spawn', args: { q: 1, r: 1 } });
      auth.step(1);
      const out: FromWorker[] = [];
      const ctl = new SimWorkerController((m) => out.push(m), undefined, () => 5000);
      ctl.handle({ t: 'init', flags: ['W00'], predict });
      ctl.handle({ t: 'welcome', state: auth.snapshot(), tick: auth.tick, flags: ['W00'], dataHash: compileData(flagsFromList(['W00'])).hash, simVersion: SIM_VERSION, serverTimeMs: 9000 });
      const id = auth.view().entities[0].id;
      const xOf = () => { const v = (out.filter((m) => m.t === 'view').at(-1) as Extract<FromWorker, { t: 'view' }>).view; return new Float32Array(v.entities)[5]; };
      const x0 = xOf();
      ctl.handle({ t: 'cmdSent', id: 'cm_1', kind: 'dev.nudge', args: { id, dq: 1 }, sentAtMs: 1 });
      if (predict) expect(xOf()).toBeGreaterThan(x0 + 0.1); else expect(xOf()).toBe(x0);
      ctl.handle({ t: 'reject', id: 'cm_1', code: 'unknown_entity' });
      expect(xOf()).toBe(x0);
      expect(out.some((m) => m.t === 'cmdRejected' && m.code === 'unknown_entity')).toBe(true);
      expect(ENTITY_STRIDE).toBe(12);
    }
  });
});
