import { TabBook, type BookTabDef } from './TabBook';

export type ColonyTabId = 'player' | 'away' | 'deed' | 'goals' | 'hq' | 'director' | 'combat' | 'supply' | 'trade';

const TAB_DEFS: readonly BookTabDef<ColonyTabId>[] = [
  { id: 'player', label: 'PLAYER' },
  { id: 'away', label: 'AWAY' },
  { id: 'deed', label: 'DEED' },
  { id: 'goals', label: 'GOALS' },
  { id: 'hq', label: 'HQ AI' },
  { id: 'director', label: 'DIRECTOR' },
  { id: 'combat', label: 'COMBAT' },
  { id: 'supply', label: 'SUPPLY' },
  { id: 'trade', label: 'TRADE' },
];

/** `feature/panel` → tab of the left-hand Colony book. A feature's other panels keep their slot. */
const PANEL_TABS: Readonly<Record<string, ColonyTabId>> = {
  'identity/pilot': 'player',
  'achievements/pilot-tracking': 'player',
  'away/away-settings': 'away',
  'deed/colony-deed': 'deed',
  'stages/stage-track-hud': 'goals',
  'goals/goals-panel': 'hq',
  'director/director-status': 'director',
  'combat/combat-alerts': 'combat',
  'combat-tuning/combat-tuning': 'combat',
  'market/supply-trade': 'supply',
  'trade-hub/trade-hub-panel': 'trade',
  'market/contracts': 'trade',
  'market/market-tab': 'trade',
};

/** The Colony book tab a HUD panel lives in, or null when it keeps its own slot. */
export function resolveColonyTab(featureId: string, panelId: string): ColonyTabId | null {
  return PANEL_TABS[`${featureId}/${panelId}`] ?? null;
}

/**
 * The Colony book: the left tab book (top left, under the minimap), the mirror of the Command Dock. One tab per
 * colony surface: Player (guest pilot / NEAR identity, opens first), Away (W09 budget; W22 adds the mercenary hire switch and max spend), Deed, Goals (stage track), HQ AI (AI toggle, HQ
 * goals, priorities), Director, Combat, Supply and Trade. Only tabs whose panels are mounted exist.
 */
export class ColonyBook {
  readonly book: TabBook<ColonyTabId>;

  constructor(slotEl: HTMLElement, availableTabs: ReadonlySet<ColonyTabId>) {
    this.book = new TabBook(slotEl, {
      side: 'left',
      tabs: TAB_DEFS.filter((d) => availableTabs.has(d.id)),
      className: 'ta-colony-book',
      testId: 'colony-book',
      tabTestIdPrefix: 'colony-tab-',
      toggleTestId: 'colony-book-toggle',
      ariaLabel: 'Colony',
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
