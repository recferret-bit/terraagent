#!/usr/bin/env node
// Validate 3D procedural particle presets: multi-layer composition, 3D geometry variety,
// 60/30/10 role hierarchy, CIE Lab colour contrast (ΔE76 >= 15), HDR bloom, ground bounce, and triangle budget.
//   node .agents/skills/particle-effect-validator/scripts/validate-particles.mjs --all
//   node .agents/skills/particle-effect-validator/scripts/validate-particles.mjs work.tree rock
//   node .agents/skills/particle-effect-validator/scripts/validate-particles.mjs --all --json
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const ids = args.filter((a) => !a.startsWith('--'));

const vite = await createServer({
  root: resolve(root, 'frontend'),
  configFile: resolve(root, 'frontend/vite.config.ts'),
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const mod = await vite.ssrLoadModule('/render/particles/index.ts');
  const { ParticlePresetRegistry, validateParticlePreset, formatParticleReport } = mod;

  let presets = [];
  if (flag('--all') || ids.length === 0) {
    presets = ParticlePresetRegistry.list();
  } else {
    for (const id of ids) {
      const p = ParticlePresetRegistry.get(id) ?? ParticlePresetRegistry.getByTargetKind(id);
      if (!p) {
        console.error(`unknown particle preset or targetKind "${id}"`);
        process.exit(2);
      }
      presets.push(p);
    }
  }

  const reports = presets.map((p) => validateParticlePreset(p));
  if (flag('--json')) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const r of reports) {
      console.log(formatParticleReport(r, { quiet: flag('--quiet') }));
      if (!flag('--quiet')) console.log('');
    }
    const e = reports.reduce((s, r) => s + r.errors, 0);
    const w = reports.reduce((s, r) => s + r.warnings, 0);
    console.log(
      `${reports.length} preset${reports.length === 1 ? '' : 's'}: ${reports.filter((r) => r.pass).length} pass, ${reports.filter((r) => !r.pass).length} fail · ${e} errors, ${w} warnings`,
    );
  }
  process.exitCode = reports.some((r) => !r.pass || (flag('--strict') && r.warnings > 0)) ? 1 : 0;
} finally {
  await vite.close();
}
