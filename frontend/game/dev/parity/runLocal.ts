import type { ParityCase } from '@terra/scenarios/parity';
import { TICK_MS } from '@terra/sim';
import { LocalHostCore } from '../../store/local/LocalHostCore';
import { memorySnapshotStore } from '../../store/local/snapshotStore';

export interface LocalParityRun {
  readonly id: string;
  readonly tick: number;
  /** Final planet snapshot (engine bytes), base64. */
  readonly snapshotB64: string;
  /** Command outcomes by command id (`ok` or the reject code), to compare with the server host's. */
  readonly outcomes: Record<string, string>;
}

/** `parity-<index in the log>`: the same ids on both hosts. */
export const parityCommandId = (index: number): string => `parity-${index}`;

const toB64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** A manual clock for the scheduler: timers fire only when `advance` moves time past them. */
function manualClock() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  return {
    now: () => now,
    schedule: (fn: () => void, d: number) => { const t = { at: now + d, fn, live: true }; timers.push(t); return () => { t.live = false; }; },
    advanceTo(end: number): void {
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.live = false; now = Math.max(now, due.at); due.fn();
      }
      now = Math.max(now, end);
    },
  };
}

/**
 * Runs a parity case on the browser local host: the real `LocalHostCore` (scheduler, command precheck, queue, engine) on
 * a manual clock, so each scheduler slot (due every `TICK_MS`) is exactly one tick. The log's commands go in as client
 * `cmd` messages right before the slot that applies them, as the page sends them. Warp is host-clock only and not used.
 */
export async function runLocalParity(c: ParityCase & { readonly id: string }): Promise<LocalParityRun> {
  const clock = manualClock();
  const outcomes: Record<string, string> = {};
  const core = await LocalHostCore.create({ scenario: c.scenario, waves: null }, {
    now: clock.now, wallMs: () => 1_700_000_000_000 + clock.now(), schedule: clock.schedule,
    store: memorySnapshotStore(), saveEveryMs: Number.MAX_SAFE_INTEGER,
  }, (m) => {
    if (m.t === 'error') throw new Error(m.message);
    if (m.t !== 'server') return;
    if (m.msg.t === 'cmd.ack') outcomes[m.msg.d.id] = 'ok';
    else if (m.msg.t === 'cmd.reject') outcomes[m.msg.d.id] = m.msg.d.code;
  });
  const start = core.tick;
  for (let i = 0; i < c.ticks; i++) {
    c.log.forEach((x, n) => {
      if (x.atTick === i) core.handle({ t: 'client', msg: { t: 'cmd', id: parityCommandId(n), d: { kind: x.kind, args: x.args } } });
    });
    clock.advanceTo(i * TICK_MS); // slot i is due at i * TICK_MS: exactly one step
    if (core.tick !== start + i + 1) throw new Error(`local host: expected tick ${start + i + 1} after slot ${i}, got ${core.tick}`);
  }
  const snapshotB64 = toB64(core.simHost.snapshot());
  core.stop();
  return { id: c.id, tick: core.tick, snapshotB64, outcomes };
}
