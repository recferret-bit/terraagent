import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const eslint = new ESLint({ cwd: repoRoot });
const hostFile = resolve(repoRoot, 'shared/sim/src/host/_fixture.ts');

async function lint(source: string) {
  const [res] = await eslint.lintText(source, { filePath: hostFile });
  return res.messages;
}

describe('host purity (SIM-D-06)', () => {
  it('passes clean host code', async () => {
    expect(await lint('export const f = (a: number) => Math.floor(a);\n')).toEqual([]);
  });
  it('bans Node imports', async () => {
    const msgs = await lint("import { Worker } from 'node:worker_threads';\nexport const w = Worker;\n");
    expect(msgs.some((m) => m.ruleId === 'no-restricted-imports' && m.severity === 2)).toBe(true);
  });
  it('bans DOM and Node globals', async () => {
    for (const body of ['window.postMessage(1);', 'document.title;', 'process.exit();', 'setTimeout(() => 1, 1);', 'performance.now();']) {
      const msgs = await lint(`export function f() { ${body} }\n`);
      expect(msgs.some((m) => m.ruleId === 'no-restricted-globals' && m.severity === 2), body).toBe(true);
    }
  });
});
