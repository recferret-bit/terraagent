import { RESOURCE_KEYS, type AgentDecisionFeedItemV1, type SimInputFeedItemV1 } from '@terra/contracts';
import { capsOf, type QueueEntry, type ViewColony } from '@terra/sim';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { forEachEntity, type ClientView } from '../../store/replica/viewCodec';
import { isReadOnlySpectator, ownColonyIndex } from '../shared/colony';
import { formatSignedEPerS, gridBalance, readColonyPower } from '../shared/power';
import { readColonySupply } from '../shared/supply';

type InspectorTab = 'inputs' | 'decisions' | 'summary';

const STD_RESOURCE_KEYS: ReadonlySet<string> = new Set<string>(RESOURCE_KEYS);

function stockAmt(stock: Record<string, number>, key: string): number {
  return Math.floor(stock[key] ?? 0);
}

function formatFamilyBadge(prefix: string, total: number, cap: number): string {
  return cap > 0 ? `${total}/${Math.floor(cap)}` : `${prefix}:${total}`;
}

function extraStockSummary(stock: Record<string, number>): string {
  const extra: string[] = [];
  for (const [k, v] of Object.entries(stock)) {
    if (!STD_RESOURCE_KEYS.has(k) && typeof v === 'number' && v !== 0) {
      extra.push(`${k}:${Math.floor(v)}`);
    }
  }
  return extra.join(' ');
}

function formatQueueTaskDetail(q: QueueEntry): string {
  const task = (q.task ?? {}) as unknown as Record<string, unknown>;
  const kind = typeof task.kind === 'string' ? task.kind : 'task';
  const subject =
    typeof task.building === 'string' ? task.building :
    typeof task.unit === 'string' ? `${task.unit}${typeof task.tier === 'number' ? ` T${task.tier}` : ''}` :
    typeof task.op === 'string' ? task.op :
    typeof task.goal === 'string' ? task.goal :
    typeof task.project === 'string' ? task.project :
    typeof task.entityId === 'number' ? `#${task.entityId}` : '';
  const count = typeof task.count === 'number' && task.count > 1 ? ` x${task.count}` : '';
  const coords = typeof task.q === 'number' && typeof task.r === 'number' ? ` @(${task.q},${task.r})` : '';
  const label = subject ? `${kind} ${subject}${count}${coords}` : kind;
  return `${label} · ${Math.round((q.progress ?? 0) * 100)}%`;
}

function escapeArgs(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  try {
    const s = JSON.stringify(raw);
    return s.length > 96 ? `${s.slice(0, 93)}...` : s;
  } catch {
    return String(raw);
  }
}

function summarizeStock(col: ViewColony): string {
  const s = col.stock ?? {};
  const m = Math.floor((s['metals.t1'] ?? 0) + (s['metals.t2'] ?? 0) + (s['metals.t3'] ?? 0));
  const n = Math.floor((s['minerals.t1'] ?? 0) + (s['minerals.t2'] ?? 0) + (s['minerals.t3'] ?? 0));
  const b = Math.floor((s['bio.water'] ?? 0) + (s['bio.biomass'] ?? 0) + (s['bio.t2'] ?? 0) + (s['bio.t3'] ?? 0));
  return `M:${m} N:${n} B:${b}`;
}

export class SpectatorPanel implements Disposable {
  readonly root: HTMLElement;
  private readonly botsEl: HTMLElement;
  private readonly feedEl: HTMLElement;
  private readonly visionBtn: HTMLButtonElement;
  private readonly scopeBtn: HTMLButtonElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly tickEl: HTMLElement;
  private readonly tabBtns = new Map<InspectorTab, HTMLButtonElement>();
  private tab: InspectorTab = 'inputs';
  private allActorsScope = false;
  private collapsed = false;
  private lastView: GameView | null = null;
  private unsubFeed: (() => void) | null = null;
  private unsubLandfall: (() => void) | null = null;
  private lastFeedKey = '';
  private readonly botCards = new Map<
    number,
    {
      btn: HTMLButtonElement;
      nameEl: HTMLElement;
      badgeEl: HTMLElement;
      metaEl: HTMLElement;
      stockEl: HTMLElement;
    }
  >();

  constructor(
    private readonly host: HTMLElement,
    private readonly ctx: FeatureContext,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'ta-spec plate-sm';
    this.root.dataset.testid = 'spectator-panel';
    this.root.dataset.collapsed = 'false';

    const head = document.createElement('div');
    head.className = 'ta-spec__head';

    const title = document.createElement('div');
    title.className = 'ta-spec__title';
    title.textContent = 'SPECTATOR · BOT ONLY';
    this.tickEl = document.createElement('span');
    this.tickEl.className = 'ta-spec__badge';
    this.tickEl.textContent = 'T0';
    title.appendChild(this.tickEl);

    const actions = document.createElement('div');
    actions.className = 'ta-spec__actions';

    this.visionBtn = document.createElement('button');
    this.visionBtn.type = 'button';
    this.visionBtn.className = 'ta-spec__btn';
    this.visionBtn.onclick = () => {
      const next = !(this.ctx.services.isSpectatorVisionAll?.() ?? true);
      this.ctx.services.setSpectatorVisionAll?.(next);
      this.render();
    };

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'ta-spec__btn';
    this.collapseBtn.textContent = 'Hide';
    this.collapseBtn.onclick = () => {
      this.collapsed = !this.collapsed;
      this.root.dataset.collapsed = String(this.collapsed);
      this.collapseBtn.textContent = this.collapsed ? 'Show' : 'Hide';
    };

    actions.append(this.visionBtn, this.collapseBtn);
    head.append(title, actions);

    const body = document.createElement('div');
    body.className = 'ta-spec__body';

    this.botsEl = document.createElement('div');
    this.botsEl.className = 'ta-spec__bots';
    this.botsEl.dataset.testid = 'spectator-bots';

    const tabs = document.createElement('div');
    tabs.className = 'ta-spec__tabs';
    const tabGroup = document.createElement('div');
    tabGroup.className = 'ta-spec__tab-group';
    for (const id of ['inputs', 'decisions', 'summary'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-spec__btn';
      btn.dataset.testid = `spectator-tab-${id}`;
      btn.textContent = id === 'summary' ? 'DETAILS' : id.toUpperCase();
      btn.onclick = () => {
        this.tab = id;
        this.render();
      };
      this.tabBtns.set(id, btn);
      tabGroup.appendChild(btn);
    }

    this.scopeBtn = document.createElement('button');
    this.scopeBtn.type = 'button';
    this.scopeBtn.className = 'ta-spec__btn';
    this.scopeBtn.onclick = () => {
      this.allActorsScope = !this.allActorsScope;
      this.render();
    };

    tabs.append(tabGroup, this.scopeBtn);

    this.feedEl = document.createElement('div');
    this.feedEl.className = 'ta-spec__feed';
    this.feedEl.dataset.testid = 'spectator-feed';

    body.append(this.botsEl, tabs, this.feedEl);
    this.root.append(head, body);
    this.host.appendChild(this.root);

    this.unsubFeed = this.ctx.services.store?.onFeed?.(() => this.render()) ?? null;
    let mountedLandfall = false;
    this.unsubLandfall = this.ctx.services.landfall?.onChange?.(() => {
      if (mountedLandfall) this.render();
    }) ?? null;
    mountedLandfall = true;
    this.syncVisibility();
    this.render();
  }

  private isSpectatorActive(): boolean {
    return isReadOnlySpectator(this.ctx.services);
  }

  private syncVisibility(): boolean {
    const on = this.isSpectatorActive();
    this.root.hidden = !on;
    this.root.style.display = on ? '' : 'none';
    return on;
  }

  update(view: GameView): void {
    this.lastView = view;
    if (!this.syncVisibility()) return;
    this.render();
  }

  private render(): void {
    if (!this.syncVisibility()) return;
    const view = (this.lastView ?? this.ctx.services.store?.latest ?? null) as ClientView | null;
    const inspected = ownColonyIndex(this.ctx.services);
    const allVision = this.ctx.services.isSpectatorVisionAll?.() ?? true;

    const tickText = `T${view?.tick ?? 0}`;
    if (this.tickEl.textContent !== tickText) this.tickEl.textContent = tickText;
    const visionText = allVision ? 'ALL VISION' : 'BOT FOV';
    const visionActive = String(allVision);
    if (this.visionBtn.textContent !== visionText) this.visionBtn.textContent = visionText;
    if (this.visionBtn.dataset.active !== visionActive) this.visionBtn.dataset.active = visionActive;
    const scopeText = this.allActorsScope ? 'ALL BOTS' : `BOT #${inspected}`;
    const scopeActive = String(!this.allActorsScope);
    if (this.scopeBtn.textContent !== scopeText) this.scopeBtn.textContent = scopeText;
    if (this.scopeBtn.dataset.active !== scopeActive) this.scopeBtn.dataset.active = scopeActive;
    for (const [id, btn] of this.tabBtns) {
      const activeStr = String(id === this.tab);
      if (btn.dataset.active !== activeStr) btn.dataset.active = activeStr;
    }

    this.renderBots(view, inspected);
    this.renderFeed(view, inspected);
  }

  private renderBots(view: ClientView | null, inspected: number): void {
    const colonies = (view?.colonies ?? []).filter((c): c is ViewColony => Boolean(c) && c.status !== 'founding');
    if (colonies.length === 0) {
      if (this.botCards.size > 0 || this.botsEl.childElementCount === 0) {
        this.botCards.clear();
        const empty = document.createElement('div');
        empty.className = 'ta-spec__empty';
        empty.textContent = 'Waiting for bot colonies...';
        this.botsEl.replaceChildren(empty);
      }
      return;
    }

    const emptyNotice = this.botsEl.querySelector('.ta-spec__empty');
    if (emptyNotice) emptyNotice.remove();

    const counts = new Map<number, number>();
    if (view?.entities) {
      forEachEntity(view.entities, view.count, (e) => {
        if (e.owner >= 0 && e.hp > 0) counts.set(e.owner, (counts.get(e.owner) ?? 0) + 1);
      });
    }

    const activeIndices = new Set(colonies.map((c) => c.index));
    for (const [idx, rec] of this.botCards) {
      if (!activeIndices.has(idx)) {
        rec.btn.remove();
        this.botCards.delete(idx);
      }
    }

    for (const col of colonies) {
      let rec = this.botCards.get(col.index);
      if (!rec) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ta-spec__bot plate-sm';
        btn.dataset.testid = `spectator-bot-${col.index}`;
        btn.onclick = () => this.ctx.services.inspectColony?.(col.index, true);

        const top = document.createElement('div');
        top.className = 'ta-spec__bot-top';
        const nameEl = document.createElement('span');
        const badgeEl = document.createElement('span');
        badgeEl.className = 'ta-spec__badge';
        top.append(nameEl, badgeEl);

        const metaEl = document.createElement('div');
        metaEl.className = 'ta-spec__meta';
        const stockEl = document.createElement('div');
        stockEl.className = 'ta-spec__meta';

        btn.append(top, metaEl, stockEl);
        this.botsEl.appendChild(btn);
        rec = { btn, nameEl, badgeEl, metaEl, stockEl };
        this.botCards.set(col.index, rec);
      }

      const selectedStr = String(col.index === inspected);
      if (rec.btn.dataset.selected !== selectedStr) rec.btn.dataset.selected = selectedStr;
      const nameStr = col.name || `Bot ${col.index}`;
      if (rec.nameEl.textContent !== nameStr) rec.nameEl.textContent = nameStr;
      const badgeStr = col.isBot === true ? String((col as { botPersona?: unknown }).botPersona ?? 'AI').toUpperCase() : 'PLAYER';
      if (rec.badgeEl.textContent !== badgeStr) rec.badgeEl.textContent = badgeStr;
      const qLen = col.queue?.length ?? 0;
      const entN = counts.get(col.index) ?? 0;
      const metaStr = `#${col.index} · S${col.stage} · E:${entN} · Q:${qLen}`;
      if (rec.metaEl.textContent !== metaStr) rec.metaEl.textContent = metaStr;
      const stockStr = summarizeStock(col);
      if (rec.stockEl.textContent !== stockStr) rec.stockEl.textContent = stockStr;
    }
  }

  private renderFeed(view: ClientView | null, inspected: number): void {
    const filterIdx = this.allActorsScope ? undefined : inspected;
    if (this.tab === 'summary') {
      this.renderSummaryFeed(view, inspected);
      return;
    }

    if (this.tab === 'inputs') {
      const items: readonly SimInputFeedItemV1[] = this.ctx.services.store?.recentInputs?.(filterIdx) ?? [];
      const feedKey = `inputs|${filterIdx ?? 'all'}|${items.length}|${items[items.length - 1]?.id ?? ''}`;
      if (feedKey === this.lastFeedKey) return;
      this.lastFeedKey = feedKey;
      this.feedEl.replaceChildren();
      if (items.length === 0) return this.appendEmpty('No inputs recorded yet.');
      for (const item of [...items].reverse().slice(0, 40)) {
        this.appendRow(
          `#${item.colonyIndex ?? '-'} · ${item.source} · ${item.kind}`,
          `t${item.atTick}`,
          item.status,
          item.rejectCode ? `${item.rejectCode} ${escapeArgs(item.args)}` : escapeArgs(item.args),
        );
      }
      return;
    }

    const decs: readonly AgentDecisionFeedItemV1[] = this.ctx.services.store?.recentDecisions?.(filterIdx) ?? [];
    const feedKey = `decisions|${filterIdx ?? 'all'}|${decs.length}|${decs[decs.length - 1]?.id ?? ''}`;
    if (feedKey === this.lastFeedKey) return;
    this.lastFeedKey = feedKey;
    this.feedEl.replaceChildren();
    if (decs.length === 0) return this.appendEmpty('No decisions recorded yet.');
    for (const d of [...decs].reverse().slice(0, 40)) {
      this.appendRow(
        `#${d.colonyIndex ?? '-'} · ${d.actorSource} · ${d.decisionKind}`,
        `t${d.atTick}`,
        d.outcome === 'rejected' ? 'rejected' : 'applied',
        d.rationale ? `${d.summary} — ${d.rationale}` : d.summary,
      );
    }
  }

  private renderSummaryFeed(view: ClientView | null, inspected: number): void {
    const col = view?.colonies?.find((c) => c && c.index === inspected);
    const recentIn = this.ctx.services.store?.recentInputs?.(inspected) ?? [];
    const recentDec = this.ctx.services.store?.recentDecisions?.(inspected) ?? [];
    let entCount = 0;
    if (view?.entities) {
      forEachEntity(view.entities, view.count, (e) => {
        if (e.owner === inspected && e.hp > 0) entCount += 1;
      });
    }
    const qSig = (col?.queue ?? []).map((q) => `${q.taskId}:${q.state}:${Math.round((q.progress ?? 0) * 100)}`).join(',');
    const goals = ((col as { goals?: Array<{ id?: string; goal?: string; priority?: number; budgetBp?: number; active?: boolean }> } | undefined)?.goals) ?? [];
    const gSig = goals.map((g) => `${g.id ?? g.goal}:${g.priority ?? 0}:${g.active ?? true}`).join(',');
    const s = (col?.stock ?? {}) as Record<string, number>;
    const caps = capsOf((col as { caps?: unknown } | undefined)?.caps, this.ctx.services.store?.simData?.() ?? undefined);
    const grid = gridBalance(readColonyPower(view, inspected));
    const supply = readColonySupply(view, inspected);
    const stockSig = Object.keys(s).sort().map((k) => `${k}:${Math.floor(s[k] ?? 0)}`).join(',');
    const lastInId = recentIn[recentIn.length - 1]?.id ?? '';
    const lastDecId = recentDec[recentDec.length - 1]?.id ?? '';
    const feedKey = `summary|${inspected}|${col?.stage ?? ''}|${col?.status ?? ''}|${entCount}|${grid.supply}:${grid.requested}:${grid.net}:${supply?.used ?? -1}:${supply?.cap ?? -1}|${caps.metals}:${caps.minerals}:${caps.bio}|${stockSig}|${qSig}|${gSig}|${recentIn.length}:${lastInId}|${recentDec.length}:${lastDecId}`;
    if (feedKey === this.lastFeedKey) return;
    this.lastFeedKey = feedKey;
    this.feedEl.replaceChildren();
    if (!col) return this.appendEmpty('Select a bot colony to inspect details.');

    const actorPrefix = col.isBot === true ? 'BOT' : 'COLONY';
    const sectorId = (col as { foundingSectorId?: string }).foundingSectorId ?? 'sec_0_0';
    const supplyText = supply ? ` · supply ${supply.used}/${supply.cap}` : '';
    this.appendRow(`${actorPrefix} #${col.index} · ${col.name}`, `S${col.stage}`, 'applied', `status ${col.status ?? 'active'} · sector ${sectorId} · power ${formatSignedEPerS(grid.net)}${supplyText}`);
    const metalsTotal = stockAmt(s, 'metals.t1') + stockAmt(s, 'metals.t2') + stockAmt(s, 'metals.t3');
    const mineralsTotal = stockAmt(s, 'minerals.t1') + stockAmt(s, 'minerals.t2') + stockAmt(s, 'minerals.t3');
    const bioTotal = stockAmt(s, 'bio.water') + stockAmt(s, 'bio.biomass') + stockAmt(s, 'bio.t2') + stockAmt(s, 'bio.t3');
    this.appendRow('RESOURCES', `${Object.keys(s).length} keys`, 'applied', `${summarizeStock(col)} · caps M:${caps.metals} N:${caps.minerals} B:${caps.bio}`);
    this.appendRow('STOCK · METALS', formatFamilyBadge('M', metalsTotal, caps.metals), 'applied', `T1:${stockAmt(s, 'metals.t1')} T2:${stockAmt(s, 'metals.t2')} T3:${stockAmt(s, 'metals.t3')}`);
    this.appendRow('STOCK · MINERALS', formatFamilyBadge('N', mineralsTotal, caps.minerals), 'applied', `N1:${stockAmt(s, 'minerals.t1')} N2:${stockAmt(s, 'minerals.t2')} N3:${stockAmt(s, 'minerals.t3')}`);
    const extra = extraStockSummary(s);
    this.appendRow('STOCK · BIO', formatFamilyBadge('B', bioTotal, caps.bio), 'applied', `Water:${stockAmt(s, 'bio.water')} Bio:${stockAmt(s, 'bio.biomass')} B2:${stockAmt(s, 'bio.t2')} B3:${stockAmt(s, 'bio.t3')}${extra ? ` · ${extra}` : ''}`);
    const queue = col.queue ?? [];
    const shedPart = grid.shed > 0 ? ` (shed ${grid.shed})` : '';
    const storePart = grid.stored !== 0 ? ` · store ${grid.stored > 0 ? '+' : ''}${grid.stored}` : '';
    this.appendRow('POWER & LOGISTICS', formatSignedEPerS(grid.net), grid.net < 0 ? 'rejected' : 'applied', `prod ${grid.supply} · demand ${grid.requested}${shedPart}${storePart}${supplyText} · entities ${entCount} · goals ${goals.length} · queue ${queue.length}`);
    for (const g of goals.slice(0, 6)) {
      this.appendRow(`GOAL · ${g.goal ?? 'goal'}`, `p${g.priority ?? 0}`, g.active === false ? 'rejected' : 'applied', `budget ${Math.round((g.budgetBp ?? 0) / 100)}%`);
    }
    if (queue.length === 0) {
      this.appendEmpty('Bot queue is currently idle.');
    } else {
      for (const q of queue.slice(0, 12)) {
        this.appendRow(`QUEUE · ${q.lane}`, q.state, 'applied', formatQueueTaskDetail(q));
      }
    }
    const lastIn = recentIn[recentIn.length - 1];
    const lastDec = recentDec[recentDec.length - 1];
    this.appendRow('ACTIVITY · IO', `in:${recentIn.length} dec:${recentDec.length}`, 'applied', `${lastIn ? `last input: ${lastIn.kind} (t${lastIn.atTick})` : 'no inputs'} · ${lastDec ? `last decision: ${lastDec.summary}` : 'no decisions'}`);
  }

  private appendEmpty(text: string): void {
    const empty = document.createElement('div');
    empty.className = 'ta-spec__empty';
    empty.textContent = text;
    this.feedEl.appendChild(empty);
  }

  private appendRow(left: string, right: string, status: string, body: string): void {
    const row = document.createElement('div');
    row.className = 'ta-spec__row';

    const top = document.createElement('div');
    top.className = 'ta-spec__row-top';
    const kEl = document.createElement('span');
    kEl.className = 'ta-spec__row-kind';
    kEl.textContent = left;
    const sEl = document.createElement('span');
    sEl.className = 'ta-spec__row-status';
    sEl.dataset.status = status;
    sEl.textContent = right;
    top.append(kEl, sEl);

    const bEl = document.createElement('div');
    bEl.className = 'ta-spec__row-body';
    bEl.textContent = body;

    row.append(top, bEl);
    this.feedEl.appendChild(row);
  }

  dispose(): void {
    this.unsubFeed?.();
    this.unsubFeed = null;
    this.unsubLandfall?.();
    this.unsubLandfall = null;
    this.botCards.clear();
    this.root.remove();
  }
}
