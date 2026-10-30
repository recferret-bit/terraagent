// Lint fixture (not linted by `npm run lint`, see eslint.config.js): a sim system using every banned API.
// purity.spec.ts lints this text as if it lived in shared/sim/src/systems/_fixture/index.ts.
import { readFileSync } from 'node:fs';
import { defineSystem } from '../../src/kernel/system';

export default defineSystem({
  id: 'fixture',
  slot: 5,
  wave: 'W00',
  async run() {
    const r = Math.random();
    const t = Date.now();
    setTimeout(() => undefined, 1);
    readFileSync('/etc/hosts');
    await Promise.resolve(r + t);
  },
});
