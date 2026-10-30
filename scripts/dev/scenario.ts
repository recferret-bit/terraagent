// `npm run scenario -- <id> [--ticks N]`: builds a seed scenario headless with SimHost, steps N ticks and prints a summary.
import { createScenarioPlanet, listScenarios } from '../../scenarios/_loader';


const fnv = (b: Uint8Array): string => {
  let h = 0x811c9dc5;
  for (const x of b) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

const args = process.argv.slice(2);
const i = args.indexOf('--ticks');
const ticks = i >= 0 ? Number(args[i + 1]) : 50;
const id = args.find((a, k) => !a.startsWith('--') && (i < 0 || k !== i + 1));
if (!id || !Number.isInteger(ticks) || ticks < 0) {
  console.error(`usage: npm run scenario -- <id> [--ticks N]   (known: ${listScenarios().map((s) => s.id).join(', ')})`);
  process.exit(1);
}

const { host, scenario } = createScenarioPlanet(id, { planetId: 'pl_cli' });
const built = host.tick;
if (ticks > 0) host.step(ticks);
const s = host.state;
const kinds: Record<number, number> = {};
for (let r = 0; r < s.entities.count; r++) kinds[s.entities.cols.kind[r]] = (kinds[s.entities.cols.kind[r]] ?? 0) + 1;
console.log(JSON.stringify({
  scenario: scenario.id, title: scenario.title, waves: scenario.waves, planetId: s.meta.planetId, seed: s.meta.seed,
  planetType: s.meta.planetType, radius: s.grid.radius, tiles: s.grid.count,
  builtAtTick: built, tick: s.meta.tick, entities: s.entities.count, entityKinds: kinds,
  stateHash: fnv(host.snapshot()), dataHash: host.pipeline.config.data.hash,
}, null, 2));
