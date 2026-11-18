// Interactive controller for Section 06 (#economics): mounts the 4 Income Lanes
// and the unified Day-1 Lossless Staking & Fee Calculator.
import { renderEconomicsBoardHtml } from './economicsTemplates';

const GROSS_APY = 0.09;
const USER_YIELD_SHARE = 0.8;
const STAKER_MIN_NEAR = 10;

function bindCalculator(root: HTMLElement): void {
  const stakeIn = root.querySelector<HTMLInputElement>('#econ-stake-slider');
  const volIn = root.querySelector<HTMLInputElement>('#econ-vol-slider');
  const stakeOut = root.querySelector<HTMLElement>('#econ-stake-out');
  const volOut = root.querySelector<HTMLElement>('#econ-vol-out');
  const banner = root.querySelector<HTMLElement>('#econ-tier-banner');
  const userYield = root.querySelector<HTMLElement>('#econ-user-yield');
  const protoYield = root.querySelector<HTMLElement>('#econ-proto-yield');
  const feeSaved = root.querySelector<HTMLElement>('#econ-fee-saved');
  const aiMode = root.querySelector<HTMLElement>('#econ-ai-mode');
  if (!stakeIn || !volIn || !stakeOut || !volOut || !banner || !userYield || !protoYield || !feeSaved || !aiMode) return;

  const update = (): void => {
    const stake = Number(stakeIn.value);
    const vol = Number(volIn.value);
    const unlocked = stake >= STAKER_MIN_NEAR;
    const grossNear = stake * GROSS_APY;
    const netNear = grossNear * USER_YIELD_SHARE;
    const protoNear = grossNear - netNear;
    const savedUsdc = unlocked ? vol * 0.005 : 0;

    stakeOut.textContent = `${stake} NEAR`;
    volOut.textContent = `${vol.toLocaleString('en-US')} USDC`;
    userYield.textContent = `${netNear.toFixed(2)} NEAR / yr`;
    protoYield.textContent = `${protoNear.toFixed(2)} NEAR / yr`;
    feeSaved.textContent = unlocked
      ? `${savedUsdc.toFixed(2)} USDC / mo (0.50% fee)`
      : `0.00 USDC / mo (1.00% fee)`;
    aiMode.textContent = unlocked ? 'Managed AI Included' : 'Rule Engine or BYOK';

    banner.className = `econ-tier-banner ${unlocked ? 'is-unlocked' : ''}`;
    banner.textContent = unlocked
      ? `STAKER TIER UNLOCKED (≥10 NEAR) · Principal stays yours · 2-day unbond`
      : `STANDARD TIER (<10 NEAR) · Stake ${STAKER_MIN_NEAR - stake} more NEAR to unlock perks`;
  };

  stakeIn.addEventListener('input', update);
  volIn.addEventListener('input', update);
  update();
}

export function initEconomicsSection(): void {
  const host = document.getElementById('economics-board');
  if (!host) return;

  host.innerHTML = renderEconomicsBoardHtml();

  bindCalculator(host);
}
