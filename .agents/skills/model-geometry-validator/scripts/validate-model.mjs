#!/usr/bin/env node
// Validate kitbashed archetypes: floating parts, hairline gaps, interpenetration, z-fighting, animated sweeps,
// plus colour fit, colour separation between functional groups and surface detail (skip those with --geometry-only).
//   node .agents/skills/model-geometry-validator/scripts/validate-model.mjs robot.builder
//   node .agents/skills/model-geometry-validator/scripts/validate-model.mjs --category robot --json
//   node .agents/skills/model-geometry-validator/scripts/validate-model.mjs --all --quiet
// Exit code 1 when any model has an error (warnings do not fail unless --strict).
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--category' && args[i - 1] !== '--tol');

const vite = await createServer({ root: resolve(root, 'frontend'), configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const kit = await vite.ssrLoadModule('/render/kitbash/index.ts');
  const v = await vite.ssrLoadModule('/render/kitbash/validate/index.ts');
  let targets = ids;
  if (flag('--all')) targets = kit.ArchetypeCatalog.list().map((e) => e.id);
  else if (val('--category')) targets = kit.ArchetypeCatalog.list(val('--category')).map((e) => e.id);
  if (!targets.length) { console.error('usage: validate-model.mjs <archetype id> [...] | --category <robot|building|ship|resource|fauna|prop> | --all  [--json] [--quiet] [--strict] [--pairs] [--geometry-only]'); process.exit(2); }

  const reports = [];
  for (const id of targets) {
    if (!kit.ArchetypeCatalog.has(id)) { console.error(`unknown archetype "${id}"`); process.exit(2); }
    reports.push(v.validateArchetype(id, { keepPairs: flag('--pairs'), appearance: !flag('--geometry-only') }));
  }
  if (flag('--json')) console.log(JSON.stringify(reports, null, 2));
  else {
    for (const r of reports) {
      console.log(v.formatReport(r, { quiet: flag('--quiet') }));
      if (flag('--pairs')) for (const p of r.pairs) console.log(`    pair ${p.a}-${p.b} dist ${p.dist.toFixed(3)} crossing ${p.crossing} z ${p.zfight} embed ${p.embedA.toFixed(2)}/${p.embedB.toFixed(2)} depth ${p.depth.toFixed(3)}`);
      console.log('');
    }
    const e = reports.reduce((s, r) => s + r.errors, 0), w = reports.reduce((s, r) => s + r.warnings, 0);
    console.log(`${reports.length} model${reports.length === 1 ? '' : 's'}: ${reports.filter((r) => r.pass).length} pass, ${reports.filter((r) => !r.pass).length} fail · ${e} errors, ${w} warnings`);
  }
  process.exitCode = reports.some((r) => !r.pass || (flag('--strict') && r.warnings)) ? 1 : 0;
} finally { await vite.close(); }
