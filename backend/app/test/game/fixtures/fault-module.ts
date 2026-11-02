import { defineCommandHandler, defineSimModule, defineSystem } from '@terra/sim';

/** Set by `test.armSystemThrow`; the `test-fault` system throws once on the step that sees it (in this thread). */
let armed = false;

/**
 * Test-only sim module: `test.throw` makes the step throw in its handler and `test.armSystemThrow` makes the step throw
 * after every command was applied, in a system (BE-12); `test.die` ends the sim thread mid-step (BE-11); `test.reject`
 * rejects with a code and a detail (GP-31).
 */
export default defineSimModule({
  id: 'test-fault',
  wave: 'W00',
  handlers: [
    defineCommandHandler({ kind: 'test.throw', wave: 'W00', handle() { throw new Error('boom'); } }),
    defineCommandHandler({ kind: 'test.armSystemThrow', wave: 'W00', handle() { armed = true; } }),
    defineCommandHandler({ kind: 'test.die', wave: 'W00', handle() { process.exit(1); } }),
    defineCommandHandler({ kind: 'test.reject', wave: 'W00', handle: () => ({ code: 'site_blocked', detail: 'trees on 2 tiles' }) }),
  ],
  systems: [
    defineSystem({
      id: 'test-fault', slot: 14, wave: 'W00',
      run() {
        if (!armed) return;
        armed = false;
        throw new Error('system boom');
      },
    }),
  ],
});
