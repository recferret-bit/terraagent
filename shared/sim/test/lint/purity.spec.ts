import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const fixturePath = resolve(repoRoot, 'shared/sim/src/systems/_fixture/index.ts');
const eslint = new ESLint({ cwd: repoRoot });

async function lint(source: string) {
  const [res] = await eslint.lintText(source, { filePath: fixturePath });
  return res.messages;
}

const sys = (body: string, imports = '') =>
  `${imports}\nimport { defineSystem } from '../../kernel/system';\nexport default defineSystem({ id: 'x', slot: 5, wave: 'W00', run() { ${body} } });\n`;

describe('sim purity lint (SIM-D-06)', () => {
  it('passes a clean system', async () => {
    expect(await lint(sys('const n = Math.floor(1.5); void n;'))).toEqual([]);
  });

  const cases: Array<[string, string, string?, string?]> = [
    ['Math.random', 'Math.random();', undefined, 'no-restricted-properties'],
    ['Date.now', 'Date.now();', undefined, 'no-restricted-globals'],
    ['setTimeout', 'setTimeout(() => undefined, 1);', undefined, 'no-restricted-globals'],
    ['process', 'process.exit();', undefined, 'no-restricted-globals'],
    ['fetch', "fetch('/x');", undefined, 'no-restricted-globals'],
    ['node:fs import', 'void readFileSync;', "import { readFileSync } from 'node:fs';", 'no-restricted-imports'],
    ['path import', 'void join;', "import { join } from 'path';", 'no-restricted-imports'],
    ['@terra/render import', 'void x;', "import { x } from '@terra/render/foo';", 'no-restricted-imports'],
    ['async function', '(async () => 1)();', undefined, 'no-restricted-syntax'],
    ['await', 'void 0;', undefined, 'no-restricted-syntax'],
  ];
  for (const [name, body, imports, rule] of cases) {
    it(`rejects ${name}`, async () => {
      const src = name === 'await' ? 'export async function f() { await 1; }\n' : sys(body, imports);
      const msgs = await lint(src);
      const hit = msgs.find((m) => m.ruleId === rule);
      expect(hit, JSON.stringify(msgs)).toBeDefined();
      expect(hit?.severity).toBe(2);
      expect(hit?.message).toContain('SIM-D-06');
    });
  }

  it('allows @terra/contracts', async () => {
    const msgs = await lint(sys('void 0;', "import type { SimCommandV1 } from '@terra/contracts';"));
    expect(msgs.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  it('flags every banned API in the committed fixture', async () => {
    const src = readFileSync(resolve(repoRoot, 'shared/sim/test/lint/banned-apis.fixture.ts'), 'utf8');
    const ids = new Set((await lint(src)).map((m) => m.ruleId));
    for (const r of ['no-restricted-properties', 'no-restricted-globals', 'no-restricted-imports', 'no-restricted-syntax']) expect(ids.has(r)).toBe(true);
  });

  it('does not lint tests with the sim rules', async () => {
    const [res] = await eslint.lintText('Math.random();\n', { filePath: resolve(repoRoot, 'shared/sim/test/x.spec.ts') });
    expect(res.messages).toEqual([]);
  });
});
