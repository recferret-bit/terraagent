import type { ColonySupply } from '@terra/sim';
import { supplyLevel, SUPPLY_CAP_TEXT, type SupplyLevel } from '../shared/supply';

/** Header slot text: `used / cap`, `— / —` before the host sent the colony's supply. */
export function formatSupplyValue(s: ColonySupply | null): string {
  return s ? `${s.used} / ${s.cap}` : '— / —';
}

/** One-line tooltip of the header slot. */
export function supplyTitle(s: ColonySupply | null): string {
  if (!s) return 'Unit supply';
  const level = supplyLevel(s);
  const tail = level === 'full' ? ` · ${SUPPLY_CAP_TEXT}` : '';
  return `Unit supply: ${s.used} / ${s.cap} (units ${s.units}, in production ${s.reserved})${tail}`;
}

function line(container: HTMLElement, testid: string, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `ta-res-breakdown__flow-line${cls ? ` ${cls}` : ''}`;
  el.setAttribute('data-testid', testid);
  container.appendChild(el);
  return el;
}

function ensureDom(container: HTMLElement): void {
  if (container.querySelector('[data-testid="res-supply-units"]')) return;
  container.replaceChildren();
  const hdr = document.createElement('div');
  hdr.className = 'ta-res-breakdown__header';
  hdr.textContent = 'UNIT SUPPLY';
  container.appendChild(hdr);
  const flow = document.createElement('div');
  flow.className = 'ta-res-breakdown__flow';
  line(flow, 'res-supply-units');
  line(flow, 'res-supply-reserved');
  line(flow, 'res-supply-cap', 'ta-res-breakdown__net');
  container.appendChild(flow);
  const sources = document.createElement('div');
  sources.className = 'ta-res-breakdown__sources';
  sources.setAttribute('data-testid', 'res-supply-sources');
  container.appendChild(sources);
  line(container, 'res-supply-hint', 'ta-res-breakdown__spending');
}

/**
 * The supply hover breakdown: units alive, supply reserved by production, and each cap source
 * (`Command Hub ×1 +10`, `Supply Depot ×2 +16`) with the data ceiling.
 */
export function renderSupplyBreakdown(container: HTMLElement, s: ColonySupply | null): SupplyLevel {
  ensureDom(container);
  const level = supplyLevel(s);
  const set = (id: string, text: string, hidden = false) => {
    const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) return;
    el.textContent = text;
    el.hidden = hidden;
  };
  set('res-supply-units', `Units: ${s?.units ?? 0}`);
  set('res-supply-reserved', `In production: ${s?.reserved ?? 0}`);
  set('res-supply-cap', `Used ${s?.used ?? 0} / cap ${s?.cap ?? 0}${s && s.cap >= s.max ? ` (max ${s.max})` : ''}`);
  set('res-supply-hint', SUPPLY_CAP_TEXT, level !== 'full');

  const box = container.querySelector<HTMLElement>('[data-testid="res-supply-sources"]');
  if (box) {
    const key = (s?.sources ?? []).map((x) => `${x.building}:${x.count}:${x.total}`).join('|');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.replaceChildren();
      for (const src of s?.sources ?? []) {
        const row = document.createElement('div');
        row.className = 'ta-res-breakdown__row';
        row.setAttribute('data-supply-source', src.building);
        const name = document.createElement('span');
        name.className = 'ta-res-breakdown__name';
        name.textContent = `${src.label} ×${src.count}`;
        const amt = document.createElement('span');
        amt.className = 'ta-res-breakdown__rate';
        amt.textContent = `+${src.total}`;
        row.append(name, amt);
        box.appendChild(row);
      }
      if (!s?.sources.length) {
        const none = document.createElement('div');
        none.className = 'ta-res-breakdown__row';
        none.textContent = 'No supply source yet (Command Hub)';
        box.appendChild(none);
      }
    }
  }
  return level;
}
