import { getParityCase, listParityCases } from '@terra/scenarios/parity';
import { runLocalParity, type LocalParityRun } from './runLocal';

/** Dev hook for `npm run test:parity` (Playwright): runs a parity case on the browser local host and returns its final snapshot. */
declare global {
  interface Window { __parity: { cases(): string[]; run(id: string): Promise<LocalParityRun> } }
}

window.__parity = {
  cases: () => listParityCases().map((c) => c.id),
  async run(id) {
    const c = getParityCase(id);
    if (!c) throw new Error(`unknown parity case "${id}"`);
    return runLocalParity(c);
  },
};
document.getElementById('out')!.textContent = `engine parity runner ready: ${window.__parity.cases().join(', ')}`;
