import type { GuildArrivedPayload, GuildDepartedPayload } from '@terra/contracts';
import type { FeatureContext, GameView, HudPanelInstance } from '../../core/registry/types';
import { GuildOffers } from '../guild-tab/GuildOffers';
import { GuildVisitModel } from '../guild-tab/model';
import { formatRejectToast } from '../shared/rejectText';
import {
  clearNotifications,
  getNotificationHistory,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
  removeNotification,
  subscribeNotifications,
  type NotificationCategory,
  type NotificationHistoryEntry,
} from './notificationStore';

type FilterKind = 'all' | 'guild' | 'combat' | 'colony' | 'system';

const FILTERS: ReadonlyArray<{ id: FilterKind; label: string }> = [
  { id: 'all', label: 'ALL' },
  { id: 'guild', label: 'GUILD' },
  { id: 'combat', label: 'COMBAT' },
  { id: 'colony', label: 'COLONY' },
  { id: 'system', label: 'SYSTEM' },
];

function matchesFilter(cat: NotificationCategory, filter: FilterKind): boolean {
  if (filter === 'all') return true;
  if (filter === 'colony') return cat === 'deed' || cat === 'stage' || cat === 'achievement';
  return cat === filter;
}

function formatTime(ms: number): string {
  try {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '';
  }
}

export class NotificationsPanel implements HudPanelInstance {
  readonly root: HTMLElement;
  private readonly guildBadge: HTMLElement;
  private readonly guildModel = new GuildVisitModel();
  private readonly guildOffers: GuildOffers;
  private readonly historyList: HTMLElement;
  private readonly historyEmpty: HTMLElement;
  private readonly markReadBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly filterBtns = new Map<FilterKind, HTMLButtonElement>();
  private filter: FilterKind = 'all';
  private activeShipName: string | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly hostEl: HTMLElement,
    private readonly ctx: FeatureContext,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'ta-notifications';
    this.root.dataset.testid = 'notifications-panel';

    // 1. Current Guild Traders section
    const guildSec = document.createElement('div');
    guildSec.className = 'ta-notifications__section plate-sm';
    guildSec.dataset.testid = 'notifications-guild-traders';
    const guildHdr = document.createElement('div');
    guildHdr.className = 'ta-notifications__header';
    const guildTitle = document.createElement('span');
    guildTitle.className = 'ta-notifications__title';
    guildTitle.textContent = 'CURRENT GUILD TRADERS';
    this.guildBadge = document.createElement('span');
    this.guildBadge.className = 'ta-notifications__badge';
    this.guildBadge.dataset.testid = 'notifications-guild-status';
    this.guildBadge.textContent = 'ORBIT CLEAR';
    guildHdr.append(guildTitle, this.guildBadge);

    const guildBody = document.createElement('div');
    guildBody.dataset.testid = 'notifications-guild-body';
    this.guildOffers = new GuildOffers(guildBody, ctx, this.guildModel);
    this.guildOffers.onShow();
    guildSec.append(guildHdr, guildBody);

    // 2. Notifications History section
    const histSec = document.createElement('div');
    histSec.className = 'ta-notifications__section plate-sm';
    histSec.dataset.testid = 'notifications-history';
    const histHdr = document.createElement('div');
    histHdr.className = 'ta-notifications__header';
    const histTitle = document.createElement('span');
    histTitle.className = 'ta-notifications__title';
    histTitle.textContent = 'NOTIFICATIONS HISTORY';
    const histActions = document.createElement('div');
    histActions.className = 'ta-notifications__actions';
    this.markReadBtn = document.createElement('button');
    this.markReadBtn.type = 'button';
    this.markReadBtn.className = 'btn btn-ghost btn-sm';
    this.markReadBtn.dataset.testid = 'notifications-mark-read';
    this.markReadBtn.textContent = 'MARK READ';
    this.markReadBtn.addEventListener('click', () => markAllNotificationsRead());
    this.clearBtn = document.createElement('button');
    this.clearBtn.type = 'button';
    this.clearBtn.className = 'btn btn-ghost btn-sm';
    this.clearBtn.dataset.testid = 'notifications-clear';
    this.clearBtn.textContent = 'CLEAR';
    this.clearBtn.addEventListener('click', () => clearNotifications());
    histActions.append(this.markReadBtn, this.clearBtn);
    histHdr.append(histTitle, histActions);

    const filterRow = document.createElement('div');
    filterRow.className = 'ta-notifications__filters';
    for (const f of FILTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-notifications__filter';
      btn.dataset.testid = `notifications-filter-${f.id}`;
      btn.textContent = f.label;
      btn.setAttribute('aria-pressed', String(f.id === this.filter));
      btn.addEventListener('click', () => {
        this.filter = f.id;
        for (const [k, b] of this.filterBtns) b.setAttribute('aria-pressed', String(k === this.filter));
        this.renderHistory();
      });
      this.filterBtns.set(f.id, btn);
      filterRow.append(btn);
    }

    this.historyEmpty = document.createElement('div');
    this.historyEmpty.className = 'ta-notifications__empty';
    this.historyEmpty.dataset.testid = 'notifications-empty';
    this.historyEmpty.textContent = 'No notifications recorded yet.';

    this.historyList = document.createElement('ul');
    this.historyList.className = 'ta-notifications__list';
    this.historyList.dataset.testid = 'notifications-history-list';

    histSec.append(histHdr, filterRow, this.historyEmpty, this.historyList);
    this.root.append(guildSec, histSec);
    this.hostEl.append(this.root);

    this.bindEvents();
    this.renderHistory();
  }

  private bindEvents(): void {
    const store = this.ctx.services.store;
    if (store?.onGuildArrived) {
      this.cleanups.push(store.onGuildArrived((p) => this.onGuildArrived(p)));
    }
    if (store?.onGuildDeparted) {
      this.cleanups.push(store.onGuildDeparted((p) => this.onGuildDeparted(p)));
    }
    if (store?.onCommandRejected) {
      this.cleanups.push(
        store.onCommandRejected((r) => {
          if (r.kind === 'market.acceptGuildOffer') {
            this.guildModel.setReject(formatRejectToast(r.code, undefined, r.kind));
          }
        }),
      );
    }
    this.cleanups.push(subscribeNotifications(() => this.renderHistory()));
  }

  private onGuildArrived(p: GuildArrivedPayload): void {
    const name = p.name || p.npcId || p.shipId;
    this.activeShipName = name;
    this.guildBadge.textContent = `${name} DOCKED`;
    this.guildBadge.dataset.active = 'true';
    this.guildModel.arrive(p);
    pushNotification({
      category: 'guild',
      title: 'Guild Trader Docked',
      message: `Guild trader ${name} has docked — ${p.offers.length} offers`,
      dedupeKey: `guild-arrived:${p.shipId}:${p.departAt}`,
      onSelect: () => {
        this.ctx.services.revealHudPanel?.(this.hostEl);
      },
    });
  }

  private onGuildDeparted(p: GuildDepartedPayload): void {
    const name = this.activeShipName || p.npcId || p.shipId;
    this.activeShipName = null;
    this.guildBadge.textContent = 'DEPARTED';
    this.guildBadge.dataset.active = 'false';
    this.guildModel.depart(p);
    pushNotification({
      category: 'guild',
      title: 'Guild Trader Departed',
      message: `Guild trader ${name} has departed`,
      dedupeKey: `guild-departed:${p.shipId}`,
      onSelect: () => {
        this.ctx.services.revealHudPanel?.(this.hostEl);
      },
    });
  }

  private renderHistory(): void {
    const all = getNotificationHistory();
    const filtered = all.filter((e) => matchesFilter(e.category, this.filter));
    const unread = getUnreadNotificationCount();
    this.ctx.services.setHudTabBadge?.(this.hostEl, unread > 0 ? unread : null);
    this.markReadBtn.disabled = unread === 0;
    this.clearBtn.disabled = all.length === 0;
    this.historyEmpty.hidden = filtered.length > 0;
    this.historyList.replaceChildren(...filtered.map((item) => this.buildHistoryRow(item)));
  }

  private buildHistoryRow(item: NotificationHistoryEntry): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ta-notif-item';
    li.dataset.testid = 'notification-history-item';
    li.dataset.notificationId = item.id;
    li.dataset.category = item.category;
    li.dataset.unread = String(!item.read);

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'ta-notif-item__main';
    mainBtn.dataset.testid = 'notification-history-click';
    mainBtn.addEventListener('click', () => {
      markNotificationRead(item.id);
      item.onSelect?.();
    });

    const top = document.createElement('div');
    top.className = 'ta-notif-item__top';
    const cat = document.createElement('span');
    cat.className = 'ta-notif-item__cat';
    cat.textContent = `${item.category.toUpperCase()} · ${item.title}`;
    const time = document.createElement('span');
    time.className = 'ta-notif-item__time';
    time.textContent = formatTime(item.createdAt);
    top.append(cat, time);

    const msg = document.createElement('div');
    msg.className = 'ta-notif-item__msg';
    msg.textContent = item.message;

    mainBtn.append(top, msg);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ta-notif-item__close';
    closeBtn.dataset.testid = 'notification-history-close';
    closeBtn.setAttribute('aria-label', 'Remove notification');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeNotification(item.id);
    });

    li.append(mainBtn, closeBtn);
    return li;
  }

  update(_view: GameView): void {
    this.guildOffers.onShow();
  }

  dispose(): void {
    for (const fn of this.cleanups.splice(0)) fn();
    this.guildOffers.dispose();
    this.root.remove();
  }
}
