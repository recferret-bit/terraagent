// Interactive controller for Section 06 (#economics): mounts the 4 Income Lanes and the Staking & Fee Calculator.
import { renderEconomicsBoardHtml } from './economicsTemplates';
import { bindStakeCalculator } from './stakeCalculator';

export function initEconomicsSection(): void {
  const host = document.getElementById('economics-board');
  if (!host) return;
  if (host.children.length === 0) host.innerHTML = renderEconomicsBoardHtml();
  bindStakeCalculator(host);
}
