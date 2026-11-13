import type { WebFeatureCard } from '../data/features';
import type { EntityCardSpec } from '../data/entitiesCatalog';
import type { CardControlState, WhitepaperLiveStage3D } from '../liveStage3D';

export function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function appendInlineFormatted(parent: HTMLElement, text: string): void {
  const parts = text.split(/`([^`]+)`/g);
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i];
    if (!chunk) continue;
    if (i % 2 === 1) {
      parent.appendChild(makeEl('code', undefined, chunk));
    } else {
      parent.appendChild(document.createTextNode(chunk));
    }
  }
}

export function makeFormattedEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | undefined,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = makeEl(tag, className);
  appendInlineFormatted(node, text);
  return node;
}

export function createSectionShell(
  id: string,
  num: string,
  domain: string,
  title: string,
  lead: string,
): HTMLElement {
  const sec = makeEl('section', 'wp-section wp-reveal');
  sec.id = id;

  const divider = makeEl('div', 'wp-divider');
  const bar = makeEl('div', 'wp-divider-bar');
  bar.append(
    makeEl('span', 'wp-divider-index', num),
    makeEl('div', 'wp-divider-hazard hazard'),
    makeEl('span', 'wp-divider-domain', domain),
  );
  divider.append(bar, makeEl('h2', undefined, title));
  sec.append(divider, makeFormattedEl('p', 'wp-section-lead', lead));
  return sec;
}

export function createCallout(title: string, body: string): HTMLElement {
  const box = makeEl('div', 'wp-callout');
  const strong = makeEl('strong', undefined, `${title}: `);
  box.append(strong);
  appendInlineFormatted(box, body);
  return box;
}

export function createTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): HTMLElement {
  const wrap = makeEl('div', 'wp-table-wrap');
  const table = makeEl('table', 'wp-table');
  const thead = makeEl('thead');
  const htr = makeEl('tr');
  for (const h of headers) htr.appendChild(makeFormattedEl('th', undefined, h));
  thead.appendChild(htr);

  const tbody = makeEl('tbody');
  for (const r of rows) {
    const tr = makeEl('tr');
    for (const cell of r) tr.appendChild(makeFormattedEl('td', undefined, cell));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

export function createFeatureGrid(cards: ReadonlyArray<WebFeatureCard>): HTMLElement {
  const grid = makeEl('div', 'wp-grid-2 wp-reveal');
  for (const item of cards) {
    const card = makeEl('article', 'wp-feature-card plate-sm');
    const head = makeEl('div', 'wp-feature-head');
    head.append(
      makeFormattedEl('h3', 'wp-feature-title', item.title),
      makeEl(
        'span',
        item.layer === 'WEB3'
          ? 'badge badge-recruiting'
          : item.layer === 'NEAR.AI'
            ? 'badge badge-ai'
            : 'badge badge-ok',
        item.badge,
      ),
    );
    const meta = makeEl('div', 'wp-feature-meta');
    for (const c of item.chips) meta.appendChild(makeEl('span', 'wp-chip', c));
    card.append(head, makeFormattedEl('p', 'wp-feature-body', item.summary), meta);
    grid.appendChild(card);
  }
  return grid;
}

export function createEntityCard3D(
  spec: EntityCardSpec,
  stage3D: WhitepaperLiveStage3D,
): HTMLElement {
  const card = makeEl('article', 'wp-card3d plate-sm');
  card.dataset.cardId = spec.id;
  card.dataset.group = spec.group;

  const stage = makeEl('div', 'wp-card3d-stage');
  const canvas = makeEl('canvas', 'wp-card3d-canvas');
  canvas.width = 464;
  canvas.height = 290;
  canvas.setAttribute('aria-label', `${spec.title} 3D model viewport`);
  stage.append(
    canvas,
    makeEl('span', 'wp-card3d-corner', spec.badge),
    makeEl('span', 'wp-card3d-live', 'HOVER / TAP'),
  );

  const body = makeEl('div', 'wp-card3d-body');
  body.append(
    makeEl('h4', 'wp-card3d-title', spec.title),
    makeEl('span', 'wp-card3d-id', `${spec.targetId} · ${spec.footprintOrBudget}`),
    makeFormattedEl('p', 'wp-card3d-desc', spec.desc),
  );

  const actionsBar = buildCardActionsBar(spec, (patch) => stage3D.updateCardState(spec.id, patch));
  if (actionsBar) body.appendChild(actionsBar);

  card.append(stage, body);
  stage3D.registerCard(spec, card, canvas);
  return card;
}

function buildCardActionsBar(
  spec: EntityCardSpec,
  onPatch: (patch: Partial<CardControlState>) => void,
): HTMLElement | null {
  if (spec.stages && spec.stages.length > 0) {
    const row = makeEl('div', 'wp-card3d-actions');
    for (const st of spec.stages) {
      const btn = makeEl('button', `wp-mode-btn${st === 'full' ? ' is-active' : ''}`, st);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        for (const sib of row.querySelectorAll('.wp-mode-btn')) sib.classList.remove('is-active');
        btn.classList.add('is-active');
        onPatch({ stage: st });
      });
      row.appendChild(btn);
    }
    return row;
  }

  if (spec.actions && spec.actions.length > 1) {
    const row = makeEl('div', 'wp-card3d-actions');
    const initial = spec.defaultAction ?? 'idle';
    for (const act of spec.actions) {
      const label = act === 'build33' ? 'build 36%' : act;
      const btn = makeEl('button', `wp-mode-btn${act === initial ? ' is-active' : ''}`, label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        for (const sib of row.querySelectorAll('.wp-mode-btn')) sib.classList.remove('is-active');
        btn.classList.add('is-active');
        onPatch({ action: act });
      });
      row.appendChild(btn);
    }
    return row;
  }
  return null;
}
