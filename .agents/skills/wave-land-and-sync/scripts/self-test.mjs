#!/usr/bin/env node
// Self-test for the `wave-land-and-sync` skill: runs the sandbox test suites in `scripts/wave/*.test.mjs`.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const r = spawnSync(
  process.execPath,
  ['--test', resolve(root, 'scripts/wave/wave.test.mjs'), resolve(root, 'scripts/wave/land-sync.test.mjs')],
  { cwd: root, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
