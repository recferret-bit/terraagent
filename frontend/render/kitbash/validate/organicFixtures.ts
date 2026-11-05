import { KitbashBuilder } from '../KitbashRegistry';
import { organ } from '../greebles/organic/shapes';
import { FAUNA_SPECIES_ZONES } from '../faunaVisualRegistry';
import { validateModel } from './ModelValidator';
import type { ModelInput, Report } from './types';

function fixture(): ModelInput {
  const b = new KitbashBuilder(FAUNA_SPECIES_ZONES.blackAnt);
  b.addPart(organ([0.3, 0.3, 0.3], 1), 'hullPrimary', { name: 'shell', position: [0, 0.3, 0] });
  b.addPart(organ([0.13, 0.15, 0.13], 2), 'frameGunmetal', { name: 'membrane', position: [0, 0.68, 0] });
  const { built } = KitbashBuilder.capture(() => b.build());
  const model = built[0];
  const pos = model.geometry.getAttribute('position');
  let offset = 0;
  const parts = model.parts.map(p => {
    const tris = new Float32Array(p.vertexCount * 3);
    for (let i = 0; i < p.vertexCount; i++) {
      tris[i * 3] = pos.getX(offset + i); tris[i * 3 + 1] = pos.getY(offset + i); tris[i * 3 + 2] = pos.getZ(offset + i);
    }
    offset += p.vertexCount;
    return { ...p, tris };
  });
  model.geometry.dispose();
  return { id: 'organic.fixture', label: 'organic fixture', source: 'builder', parts };
}

/** Shared by the CLI validator self-test and Vitest. Every profile rule has a positive and negative fixture. */
export function organicValidatorFixtures(): Array<{ name: string; report: Report; expected?: string }> {
  const cases: Array<{ name: string; change?: (m: ModelInput) => void; expected?: string }> = [
    { name: 'smooth nonemissive organic shell is valid' },
    { name: 'untyped tissue is rejected', change: m => { m.parts[1].tissue = 0; }, expected: 'ORGANIC_TISSUE' },
    { name: 'metallic biological joint is rejected', change: m => { m.parts[1].metalness = 0.8; }, expected: 'ORGANIC_METAL' },
    { name: 'invalid tissue roughness is rejected', change: m => { m.parts[0].roughness = NaN; }, expected: 'ORGANIC_ROUGHNESS' },
    { name: 'rigid shell cannot use flexible channel', change: m => { m.parts[0].animType = 60; }, expected: 'ORGANIC_FLEX' },
    { name: 'dark unreadable tissue is rejected', change: m => { for (const p of m.parts) p.color = 0x020202; }, expected: 'ORGANIC_TOO_DARK' },
    { name: 'single tissue response is reported', change: m => { m.parts[1].tissue = 1; }, expected: 'ORGANIC_UNIFORM' },
    { name: 'organic floating tissue remains invalid', change: m => { for (let i = 1; i < m.parts[1].tris.length; i += 3) m.parts[1].tris[i] += 0.5; }, expected: 'FLOATING_PART' },
    { name: 'bounded secretory pulse is valid', change: m => { m.parts[1].tissue = 3; m.parts[1].animType = 60; } },
  ];
  return cases.map(c => {
    const model = fixture(); c.change?.(model);
    return { name: c.name, report: validateModel(model, { minParts: 2 }), expected: c.expected };
  });
}
