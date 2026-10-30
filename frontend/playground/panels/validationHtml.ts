import type { Report } from '@shared/engine/kitbash/validate';
import { esc } from '../dom';
import { VAL_LIST_MAX } from '../content/Validation';

export function validationHtml(r: Report | null, id: string): string {
  if (!r) return '';
  let n = 0;
  const rows = r.issues.filter((i) => i.severity !== 'info').slice(0, VAL_LIST_MAX).map((i) => `<li class="sev-${i.severity}" title="${esc(i.message + (i.hint ? '  FIX: ' + i.hint : ''))}"><i>${++n}</i><b>${i.code}</b> ${esc(i.message.length > 150 ? i.message.slice(0, 147) + '…' : i.message)}</li>`).join('');
  const more = r.errors + r.warnings - VAL_LIST_MAX;
  return `<div class="vl-head ${r.pass ? 'ok' : 'bad'}">VALIDATION · ${r.errors} error${r.errors === 1 ? '' : 's'} · ${r.warnings} warning${r.warnings === 1 ? '' : 's'} · ${r.partCount} parts</div><ol class="vl">${rows || '<li class="sev-ok"><b>CLEAN</b> No floating parts, overlaps or animation collisions.</li>'}${more > 0 ? `<li class="sev-ok"><b>+${more} MORE</b> Run <code>npm run validate:models -- ${id}</code> for the full list.</li>` : ''}</ol>`;
}
