import { ArchetypeCatalog } from '@terra/render/kitbash';
import { $, esc } from '../dom';
import type { FaunaSceneStats } from '../content/FaunaSceneHost';
import type { WildlifeSceneStats } from '../content/WildlifeSceneHost';
import type { MarchStats } from '../content/marchScene';
import { ANIM_NAME, archetypeStats } from '../content/archetypeStats';
import { floraStats, getFloraEntry, isFloraId } from '../content/floraCatalog';
import { bindDock } from './dock';

let infoDocked = false;
const sceneMarkup = new WeakMap<HTMLElement, string>();

function ensureInfoDock(el: HTMLElement): void {
  if (infoDocked) return;
  infoDocked = true;
  bindDock({
    id: 'info',
    panel: el,
    edge: 'right',
    showLabel: 'INFO',
    showTitle: 'Hide or show selected object',
  });
}

function infoHead(title: string): string {
  return `<div class="info-head">${title}</div>`;
}

/** Scene summaries consume the same host statistics as the Hive, Wildlife, and March controls. */
export function updateSceneInfo(stats: FaunaSceneStats | WildlifeSceneStats | MarchStats): void {
  const el = $('#info');
  ensureInfoDock(el);
  if ('birdsTotal' in stats) {
    const title = stats.kind ? `Wildlife · ${stats.kind}` : 'Wildlife ecosystem';
    const rows: Array<[string, string | number]> = [
      ['hour', `${String(Math.round(stats.hour)).padStart(2, '0')}:00`],
      ['birds', `${stats.birdsTotal} (${stats.birdSpecies} spp)`],
      ['mammals', `${stats.landAnimalsTotal} (${stats.landSpecies} spp)`],
      ['grazing / hunt / sleep', `${stats.grazing} / ${stats.hunting} / ${stats.sleeping}`],
      ['fleeing', stats.fleeing],
    ];
    const html = `${infoHead(`<h3>${esc(title)}<small>Living biosphere</small></h3>`)}<table>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${esc(String(value))}</td></tr>`).join('')}</table><p>Select a model in Units to inspect its sculpted anatomy.</p>`;
    if (sceneMarkup.get(el) !== html) { el.innerHTML = html; sceneMarkup.set(el, html); }
    return;
  }
  const fauna = 'populationCount' in stats;
  const title = fauna ? (!stats.scene ? 'Hive scene' : stats.scene === 'mixed' ? 'Mixed hive scene' : ArchetypeCatalog.get(`fauna.hive.${stats.scene}`).label) : 'Group march';
  const mode = fauna ? stats.modeLabel : stats.pace === 'own' ? 'Own pace' : 'Together';
  const rows: Array<[string, string | number]> = [['mode', mode], ['tick', stats.tick]];
  if (fauna) rows.push(['population', `${stats.populationCount} / ${stats.maxPopulation}`], ['hives', stats.hives.length], ['waves', stats.waveCount], ['projectiles', stats.activeProjectiles]);
  else rows.push(['units', stats.units], ['moving', stats.moving], ['idle', stats.arrived], ['occupied tiles', stats.distinct]);
  const html = `${infoHead(`<h3>${esc(title)}<small>Scene overview</small></h3>`)}<table>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${esc(String(value))}</td></tr>`).join('')}</table><p>Select a model in Units to inspect its geometry and ground contact.</p>`;
  if (sceneMarkup.get(el) !== html) { el.innerHTML = html; sceneMarkup.set(el, html); }
}

/** Right-hand stats table for the selected archetype. */
export function updateInfo(id: string, drawCalls: number, extraHtml: string) {
  const el = $('#info');
  sceneMarkup.delete(el);
  ensureInfoDock(el);
  if (!id) {
    el.innerHTML = infoHead('<h3>No selection</h3>');
    return;
  }
  if (isFloraId(id)) {
    const entry = getFloraEntry(id)!;
    const s = floraStats(entry);
    const contactCell = s.plantedSkirt
      ? `<td class="ok">✔ minY ${s.minY.toFixed(3)} (planted skirt)</td>`
      : `<td class="${s.groundedOk ? 'ok' : 'bad'}">${s.groundedOk ? '✔' : '✖'} minY ${s.minY.toFixed(3)}</td>`;
    el.innerHTML = `${infoHead(`<h3>${esc(entry.label)}<small>${esc(entry.id)} · ${entry.group}</small></h3>`)}<table>
      <tr><td>triangles</td><td>${s.tris.toLocaleString()}</td></tr>
      <tr><td>vertices</td><td>${s.verts.toLocaleString()}</td></tr>
      <tr><td>bbox (m)</td><td>${s.size.x.toFixed(2)} × ${s.size.y.toFixed(2)} × ${s.size.z.toFixed(2)}</td></tr>
      <tr><td>ground contact</td>${contactCell}</tr>
      <tr><td>biome</td><td>${esc(entry.biomeHint)}</td></tr>
      <tr><td>wind sway</td><td>${entry.isRock ? 'static rock' : `active (×${entry.sway.toFixed(2)})`}</td></tr>
      <tr><td>draw calls</td><td>${drawCalls} (${entry.isRock ? 'rock' : 'foliage'})</td></tr>
      <tr><td>attributes</td><td>${s.attrs.filter((a) => a !== 'position' && a !== 'normal').join(', ') || 'position, normal'}</td></tr>
      <tr><td>notes</td><td>${esc(entry.description)}</td></tr></table>`;
    return;
  }
  const e = ArchetypeCatalog.get(id);
  const s = archetypeStats(id);
  const c = s.contact;
  const contactCell = !c
    ? `<td>— (orbital, no ground rule) minY ${s.minY.toFixed(3)}</td>`
    : `<td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✔' : '✖'} minY ${c.minY.toFixed(3)}${c.skirt ? ' (−0.1 m plinth skirt)' : ''}</td>`;
  el.innerHTML = `${infoHead(`<h3>${e.label}<small>${e.id} · ${e.category}</small></h3>`)}<table>
    <tr><td>triangles</td><td>${s.tris.toLocaleString()}${s.tris > 3500 ? ' <span class="bad">(&gt;3.5k)</span>' : ''}</td></tr>
    <tr><td>vertices</td><td>${s.verts.toLocaleString()}</td></tr>
    <tr><td>bbox (m)</td><td>${s.size.x.toFixed(2)} × ${s.size.y.toFixed(2)} × ${s.size.z.toFixed(2)}</td></tr>
    <tr><td>ground contact</td>${contactCell}</tr>
    <tr><td>footprint</td><td>${e.footprint ? e.footprint.join('×') + ' tiles' : '—'}</td></tr>
    <tr><td>part anims</td><td>${s.anim.length ? s.anim.map((a) => (typeof a === 'number' ? (ANIM_NAME[a] ?? a) : a)).join(', ') : 'n/a'}</td></tr>
    <tr><td>draw calls</td><td>${drawCalls} (merged)</td></tr>
    <tr><td>attributes</td><td>${s.attrs.filter((a) => a !== 'position' && a !== 'normal').join(', ')}</td></tr>
    ${e.notes ? `<tr><td>notes</td><td>${e.notes}</td></tr>` : ''}</table>${extraHtml}`;
}
