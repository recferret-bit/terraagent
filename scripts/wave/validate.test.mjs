// Node test-runner wrapper for the pre-landing wave validation skill & harness (`npm run test:wave`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const selfTest = join(root, '.agents', 'skills', 'wave-landing-validator', 'scripts', 'self-test.mjs');

test('wave-landing-validator self-test suite passes all AST, duplication, architecture, wiring, and 2-iteration harness checks', () => {
  const r = spawnSync('node', [selfTest], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /11\/11 wave-landing-validator self-tests passed/);
});
