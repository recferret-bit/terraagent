import { commandGate, flagsFromList, newId, precheckClientCommand, type SimCommandV1 } from '@terra/contracts';
import { createScenarioPlanet } from '@terra/scenarios';
import type { ParityCase } from '@terra/scenarios/parity';
import { snapshot } from '@terra/sim';
import { SimThreadPool } from '../../backend/app/src/game/sim-thread-pool';
import type { FromThread } from '../../backend/app/src/game/thread/protocol';

export interface ServerParityRun {
  readonly tick: number;
  readonly snapshot: Uint8Array;
  /** Command outcomes by command id (`ok` or the reject code). */
  readonly outcomes: Record<string, string>;
}

const commandId = (index: number): string => `parity-${index}`;

/**
 * Runs a parity case on the server host: the real sim thread (`worker_threads` Worker running `PlanetHost`, as the app does)
 * with `autoStep: false`, loaded from the scenario snapshot exactly as `ScenariosService` loads a dev planet. Commands pass
 * the ingress precheck and are queued before the step that applies them; every step is `ctl step` with dt 1.
 */
export async function runServerParity(c: ParityCase): Promise<ServerParityRun> {
  const planetId = newId('pl');
  const { host } = createScenarioPlanet(c.scenario, { planetId });
  const flags = [...host.pipeline.config.flags];
  const pool = new SimThreadPool({ threads: 1, flags, autoStep: false });
  const outcomes: Record<string, string> = {};
  let errors: string[] = [];
  let onSnapshot: ((b: Uint8Array) => void) | undefined;
  let onLoaded: (() => void) | undefined;
  pool.listen((_t, m: FromThread) => {
    if (m.t === 'ack') outcomes[m.commandId] = 'ok';
    else if (m.t === 'reject') outcomes[m.commandId] = m.code;
    else if (m.t === 'error') errors = [...errors, m.message];
    else if (m.t === 'snapshot') onSnapshot?.(m.bytes);
    else if (m.t === 'loaded') onLoaded?.();
  });
  try {
    await pool.start();
    const loaded = new Promise<void>((r) => { onLoaded = r; });
    const bytes = snapshot(host.state);
    pool.sendToPlanet(planetId, { t: 'load', planetId, snapshot: bytes, flags }, [bytes.buffer as ArrayBuffer]);
    await loaded;
    const fset = flagsFromList(flags);
    for (let i = 0; i < c.ticks; i++) {
      c.log.forEach((x, n) => {
        if (x.atTick !== i) return;
        const pre = precheckClientCommand(x.kind, x.args, { gate: (k) => commandGate(k, fset), production: false });
        if (!pre.ok) { outcomes[commandId(n)] = pre.code; return; }
        const cmd: SimCommandV1 = { colonyIndex: null, source: 'dev', commandId: commandId(n), kind: x.kind, args: pre.args };
        pool.sendToPlanet(planetId, { t: 'cmd', planetId, cmd });
      });
      pool.sendToPlanet(planetId, { t: 'ctl', op: 'step', planetId, dt: 1 });
    }
    const final = await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server host: no snapshot within 60 s')), 60_000);
      onSnapshot = (b) => { clearTimeout(timer); resolve(b); };
      pool.sendToPlanet(planetId, { t: 'snapshotNow', planetId });
    });
    if (errors.length) throw new Error(`server host reported errors: ${errors.join('; ')}`);
    return { tick: host.tick + c.ticks, snapshot: final, outcomes };
  } finally {
    await pool.shutdown();
  }
}
