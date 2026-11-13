// Interactive controller for Section 06 (#economics): mounts the 4 Income Lanes,
// Who-Earns-What summary, live Day-1 Staking & Fee Calculator, and Why NEAR breakdown.
import {
  renderIncomeLanesHtml,
  renderSimulatorSplitHtml,
  renderWhyNearHtml,
} from './economicsTemplates';

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
    aiMode.textContent = unlocked ? 'Managed NEAR.AI · 0% P2W' : 'Rule Engine / BYOK · 0% P2W';

    banner.className = `econ-tier-banner ${unlocked ? 'is-unlocked' : ''}`;
    banner.textContent = unlocked
      ? `★ STAKER PERKS ACTIVE (≥10 NEAR): 7.20% Net APY + Server-Sponsored NEAR.AI Autopilot + 50% Trade Fee Discount (1.00% → 0.50%)`
      : `STANDARD TIER (<10 NEAR): 1.00% Platform Trade Fee · Stake ${STAKER_MIN_NEAR - stake} more NEAR to unlock Managed NEAR.AI Autopilot + 0.50% Fee`;
  };

  stakeIn.addEventListener('input', update);
  volIn.addEventListener('input', update);
  update();
}

export function initEconomicsSection(): void {
  const host = document.getElementById('economics-board');
  if (!host) return;

  host.innerHTML = `<div class="sec-head">
      <div>
        <p class="eyebrow">06 · PLAYER EARNINGS &amp; DAY-1 STAKING</p>
        <h2 class="h1">How players &amp; bots earn.<br><span class="sub-blue">Real counterparty demand, zero Pay-to-Win.</span></h2>
      </div>
      <p>Export scarce resources for USDC/NEAR, collect Trade Hub stall royalties, run capped trading bots, or stake ≥10 NEAR from Day 1 to earn 7.20% net APY and cut your platform fees in half.</p>
    </div>
    ${renderIncomeLanesHtml()}
    ${renderSimulatorSplitHtml()}
    ${renderWhyNearHtml()}`;

  bindCalculator(host);
}
