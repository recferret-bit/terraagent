import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const eslint = new ESLint({ cwd: repoRoot });

async function moveErrors(source: string, file: string) {
  const [res] = await eslint.lintText(source, { filePath: resolve(repoRoot, file) });
  return res.messages.filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('SIM-M-01'));
}

const SYSTEM = 'shared/sim/src/systems/_fixture/index.ts';
const head = "import { setField } from '../../ecs/store';\nimport type { PlanetState } from '../../kernel/state';\n";

describe('position-write lint (SIM-M-01: no teleports)', { timeout: 30_000 }, () => {
  const writes: Array<[string, string]> = [
    ['setField x', "export const f = (s: PlanetState) => setField(s.entities, 0, 'x', 1, 1);\n"],
    ['setField q', "export const f = (s: PlanetState) => setField(s.entities, 0, 'q', 1, 1);\n"],
    ['cols.y[] =', 'export const f = (s: PlanetState) => { const cols = s.entities.cols; cols.y[0] = 3; };\n'],
    ['entities.cols.r[] +=', 'export const f = (s: PlanetState) => { s.entities.cols.r[0] += 1; };\n'],
    ['cols.x[]++', 'export const f = (s: PlanetState) => { const cols = s.entities.cols; cols.x[0]++; };\n'],
    ["cols['y'][] =", "export const f = (s: PlanetState) => { const cols = s.entities.cols; cols['y'][0] = 3; };\n"],
    ['cols.q.fill()', 'export const f = (s: PlanetState) => { s.entities.cols.q.fill(0); };\n'],
    ['cols.x.set()', 'export const f = (s: PlanetState) => { const cols = s.entities.cols; cols.x.set([1], 0); };\n'],
    ['adminRelocateEntity', "import { adminRelocateEntity } from '../../ecs/placement';\nexport const f = (s: PlanetState) => adminRelocateEntity(s.entities, 0, 1, 1, 1);\n"],
  ];
  for (const [name, body] of writes) {
    it(`rejects ${name} in a system`, async () => {
      expect(await moveErrors(head + body, SYSTEM)).toHaveLength(1);
    });
  }

  it('allows other columns, hex-index tables and admin relocation from systems/dev', async () => {
    const ok = "export const f = (s: PlanetState, idx: { q: Int16Array }) => { setField(s.entities, 0, 'hp', 1, 1); s.entities.cols.rot[0] = 1; idx.q[0] = 2; };\n";
    expect(await moveErrors(head + ok, SYSTEM)).toEqual([]);
    const admin = "import { adminRelocateEntity } from '../../ecs/placement';\nexport const f = (s: PlanetState) => adminRelocateEntity(s.entities, 0, 1, 1, 1);\n";
    expect(await moveErrors(head + admin, 'shared/sim/src/systems/dev/_fixture.ts')).toEqual([]);
    expect(await moveErrors(head + "export const f = (s: PlanetState) => setField(s.entities, 0, 'x', 1, 1);\n", 'shared/sim/src/systems/dev/_fixture.ts')).toHaveLength(1);
  });

  it('allows position writes only in locomotion and the spawn/admin placement helpers', async () => {
    const write = "export const f = (s: PlanetState) => setField(s.entities, 0, 'x', 1, 1);\n";
    expect(await moveErrors(head.replaceAll('../../', '../../'), 'shared/sim/src/units/movement/locomotion.ts')).toEqual([]);
    expect(await moveErrors(head + write, 'shared/sim/src/units/movement/locomotion.ts')).toEqual([]);
    expect(await moveErrors(head + write, 'shared/sim/src/units/commands/move.ts')).toHaveLength(1);
  });

  it('the committed sim source has no position writes outside those files', async () => {
    const results = await eslint.lintFiles([resolve(repoRoot, 'shared/sim/src')]);
    const hits = results.flatMap((r) => r.messages.filter((m) => m.message.includes('SIM-M-01')).map((m) => `${r.filePath}:${m.line}`));
    expect(hits).toEqual([]);
  });
});
