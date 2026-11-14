import { TabBook, type BookTabDef } from './TabBook';

export type ColonyTabId =
  | 'player'
  | 'away'
  | 'deed'
  | 'goals'
  | 'hq'
  | 'director'
  | 'combat'
  | 'supply'
  | 'trade'
  | 'notifications';

const TAB_DEFS: readonly BookTabDef<ColonyTabId>[] = [
  { id: 'player', label: 'PLAYER', dialogOnly: true },
  { id: 'away', label: 'AWAY' },
  { id: 'deed', label: 'DEED', dialogOnly: true },
  { id: 'goals', label: 'GOALS', dialogOnly: true },
  { id: 'hq', label: 'HQ AI' },
  { id: 'director', label: 'DIRECTOR' },
  { id: 'combat', label: 'COMBAT' },
  { id: 'supply', label: 'SUPPLY' },
  { id: 'trade', label: 'TRADE', dialogOnly: true },
  { id: 'notifications', label: 'NOTIFICATIONS' },
];

/** `feature/panel` → tab of the right-hand Colony book. A feature's other panels keep their slot. */
const PANEL_TABS: Readonly<Record<string, ColonyTabId>> = {
  'identity/pilot': 'player',
  'achievements/pilot-tracking': 'player',
  'away/away-settings': 'away',
  'deed/colony-deed': 'deed',
  'stages/stage-track-hud': 'goals',
  'goals/goals-panel': 'hq',
  'diplomacy/diplomacy-panel': 'hq',
  'raid/raid-target-picker': 'hq',
  'director/director-status': 'director',
  'combat/combat-alerts': 'combat',
  'combat-tuning/combat-tuning': 'combat',
  'market/supply-trade': 'supply',
  'trade-hub/trade-hub-panel': 'trade',
  'market/contracts': 'trade',
  'market/market-tab': 'trade',
  'notifications/notifications-panel': 'notifications',
};

/** The Colony book tab a HUD panel lives in, or null when it keeps its own slot. */
export function resolveColonyTab(featureId: string, panelId: string): ColonyTabId | null {
  return PANEL_TABS[`${featureId}/${panelId}`] ?? null;
}

/**
 * The Colony book: combined with the Command Dock on the right side (`top-right`), housing Player, Away,
 * Deed, Goals, HQ AI, Director, Combat, Supply, Trade, and Notifications. Dialog-only tabs (`player`, `deed`,
 * `goals`, `trade`) open their modal dialogs directly on click without showing a side-tab pane.
 */
export class ColonyBook {
  readonly book: TabBook<ColonyTabId>;

  constructor(slotEl: HTMLElement, availableTabs: ReadonlySet<ColonyTabId>, onSpineClick?: (tab: ColonyTabId) => void) {
    this.book = new TabBook(slotEl, {
      side: 'right',
      tabs: TAB_DEFS.filter((d) => availableTabs.has(d.id)),
      className: 'ta-colony-book',
      testId: 'colony-book',
      tabTestIdPrefix: 'colony-tab-',
      toggleTestId: 'colony-book-toggle',
      ariaLabel: 'Colony',
      onSpineClick,
    });
  }

  get el(): HTMLElement {
    return this.book.el;
  }

  containerFor(tab: ColonyTabId): HTMLElement {
    return this.book.containerFor(tab);
  }

  dispose(): void {
    this.book.dispose();
  }
}
