import { ArchetypeCatalog } from '@shared/engine/kitbash';
import { $ } from '../dom';
import { ANIM_NAME, archetypeStats } from '../content/archetypeStats';

/** Right-hand stats table for the selected archetype. */
export function updateInfo(id: string, drawCalls: number, extraHtml: string) {
  const el = $('#info');
  if (!id) { el.innerHTML = '<h3>No selection</h3>'; return; }
  const e = ArchetypeCatalog.get(id);
  const s = archetypeStats(id);
  const contact = Math.abs(s.minY) <= 0.02;
  el.innerHTML = `<h3>${e.label}<small>${e.id} · ${e.category}</small></h3><table>
    <tr><td>triangles</td><td>${s.tris.toLocaleString()}${s.tris > 3500 ? ' <span class="bad">(&gt;3.5k)</span>' : ''}</td></tr>
    <tr><td>vertices</td><td>${s.verts.toLocaleString()}</td></tr>
    <tr><td>bbox (m)</td><td>${s.size.x.toFixed(2)} × ${s.size.y.toFixed(2)} × ${s.size.z.toFixed(2)}</td></tr>
    <tr><td>ground contact</td><td class="${contact ? 'ok' : 'bad'}">${contact ? '✔' : '✖'} minY ${s.minY.toFixed(3)}</td></tr>
    <tr><td>footprint</td><td>${e.footprint ? e.footprint.join('×') + ' tiles' : '—'}</td></tr>
    <tr><td>part anims</td><td>${s.anim.length ? s.anim.map((a) => ANIM_NAME[a] ?? a).join(', ') : 'n/a'}</td></tr>
    <tr><td>draw calls</td><td>${drawCalls} (merged)</td></tr>
    <tr><td>attributes</td><td>${s.attrs.filter((a) => a !== 'position' && a !== 'normal').join(', ')}</td></tr>
    ${e.notes ? `<tr><td>notes</td><td>${e.notes}</td></tr>` : ''}</table>${extraHtml}`;
}
