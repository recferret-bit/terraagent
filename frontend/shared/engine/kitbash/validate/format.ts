import type { Report } from './ModelValidator';

const ICON = { error: '✖', warn: '▲', info: '·' } as const;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Plain-text report for terminals and agent logs. */
export function formatReport(r: Report, opts: { quiet?: boolean } = {}): string {
  const head = `${r.pass ? 'PASS' : 'FAIL'}  ${r.id} (${r.label}) · ${r.partCount} parts · ${r.triCount.toLocaleString('en-US')} tris · minY ${r.minY.toFixed(3)} · ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}${r.source === 'components' ? ' · parts guessed from connected islands (no KitbashBuilder)' : ''}`;
  if (opts.quiet && !r.issues.length) return head;
  const lines = [head];
  for (const i of r.issues) {
    lines.push(`  ${ICON[i.severity]} ${i.code.padEnd(18)} ${i.message}`);
    if (i.hint && i.severity !== 'info') lines.push(`      fix: ${i.hint}`);
  }
  const zones = Object.entries(r.zoneArea).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(' · ');
  lines.push(`  surface by zone: ${zones}`);
  const named = (r.roles ?? []).filter((x) => x.role !== 'other');
  if (named.length) lines.push(`  colour by role:  ${named.map((x) => `${x.role} ${pct(x.share)} ${x.zone} L*${Math.round(x.lightness)}`).join(' · ')} · mean L* ${Math.round(r.meanL ?? 0)}`);
  return lines.join('\n');
}
