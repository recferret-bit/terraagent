import { makeBtn, makeDiv } from '../shared/dom';
import './hubLauncher.css';

export interface TradeHubLauncherActions {
  /** Opens the Trade Hub panel in its pane. */
  openHub(): void;
  /** Opens the Contracts list; absent (or returning false from `hasContracts`) hides the button. */
  openContracts?(): void;
  hasContracts?(): boolean;
}

/**
 * The Trade tab's resting state (Colony book): when the Trade Hub panel is closed or lives in the selection bar, the
 * tab still says what it is for and how to open it. Hidden outside a tab book by CSS (`hubLauncher.css`).
 */
export class TradeHubLauncher {
  readonly el = makeDiv('ta-trade-hub-launcher', 'trade-hub-launcher');
  private readonly contractsBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, private readonly actions: TradeHubLauncherActions) {
    const actionsRow = makeDiv('ta-trade-hub-launcher__actions');
    const openBtn = makeBtn('btn btn-ghost btn-sm', 'trade-hub-open', 'OPEN TRADE HUB', () => actions.openHub());
    openBtn.dataset.dialogTrigger = 'true';
    this.contractsBtn = makeBtn('btn btn-ghost btn-sm', 'trade-hub-open-contracts', 'CONTRACTS', () => actions.openContracts?.());
    actionsRow.append(openBtn, this.contractsBtn);
    this.el.append(
      makeDiv('ta-trade-hub-launcher__title', undefined, 'INTER-COLONY TRADE HUB'),
      makeDiv('ta-trade-hub-launcher__note', undefined, 'Export cargo to orbit and import it back. Select your Trade Hub, or open the panel here.'),
      actionsRow,
    );
    parent.appendChild(this.el);
    this.sync(false);
  }

  /** `hubShown`: the Trade Hub panel is open in this pane, so the launcher steps aside. */
  sync(hubShown: boolean): void {
    this.el.hidden = hubShown;
    this.contractsBtn.hidden = !this.actions.openContracts || this.actions.hasContracts?.() === false;
  }

  dispose(): void {
    this.el.remove();
  }
}
