import type { StakingPoolInfo, StakingPositionDto } from '@terra/contracts';

export const REAL_NEAR_COPY =
  'Real NEAR from your wallet — not game currency, no in-game bonus';

export function formatStakerPerksBanner(stakedNear: number): string {
  if (stakedNear >= 10) {
    return 'PERKS ACTIVE (>= 10 NEAR): 7.2% Net APY · Managed NEAR.AI Autopilot ON · 0.50% Market Fee (20% yield -> TerraAgent Protocol)';
  }
  return 'Stake >= 10 NEAR from Day 1: 7.2% Net APY (20% yield -> TerraAgent Protocol) · Unlocks Managed NEAR.AI Autopilot + 50% Lower Market Fee (0.50%)';
}

export const DEFAULT_STAKING_POOLS: readonly StakingPoolInfo[] = [
  {
    poolId: 'astro-stakers.poolv1.near',
    name: 'Astro Stakers',
    apyBp: 900,
  },
  {
    poolId: 'chorus-one.poolv1.near',
    name: 'Chorus One',
    apyBp: 900,
  },
];

export function formatPoolOptionText(pool: StakingPoolInfo): string {
  const grossPct = (pool.apyBp / 100).toFixed(pool.apyBp % 100 === 0 ? 0 : 2);
  const netPct = ((pool.apyBp * 0.8) / 100).toFixed(1);
  return `${pool.poolId} (${netPct}% net / ${grossPct}% validator APY)`;
}

export function formatUnbondingSummary(pos: StakingPositionDto | null): string {
  if (!pos) return 'None';
  const withdrawable = Number(pos.withdrawable || '0');
  const unbonding = Number(pos.unbonding || '0');
  if (withdrawable > 0) {
    return `Ready (${pos.withdrawable} NEAR)`;
  }
  if (unbonding > 0) {
    return `Unbonding (4 epochs · ${pos.unbonding} NEAR)`;
  }
  return 'None';
}

export function buildStakingHeader() {
  const headerEl = document.createElement('div');
  headerEl.className = 'ta-staking-panel__header';

  const title = document.createElement('h3');
  title.className = 'ta-staking-panel__title';
  title.textContent = 'COLONY DEED · DAY-1 NEAR STAKING';

  const walletBalanceEl = document.createElement('span');
  walletBalanceEl.className = 'ta-deed-panel__chip';
  walletBalanceEl.dataset.testid = 'staking-wallet-balance';
  walletBalanceEl.textContent = 'Wallet: 100 NEAR';

  headerEl.appendChild(title);
  headerEl.appendChild(walletBalanceEl);
  return { headerEl, walletBalanceEl };
}

export function buildStakingClaimRow(onClaimClick: () => void) {
  const row = document.createElement('div');
  row.className = 'ta-staking-panel__claim-row';

  const accountStatusEl = document.createElement('span');
  accountStatusEl.className = 'ta-staking-panel__pos-value';
  accountStatusEl.dataset.testid = 'staking-account-status';
  accountStatusEl.textContent = 'Account not claimed';

  const claimBtnEl = document.createElement('button');
  claimBtnEl.type = 'button';
  claimBtnEl.className = 'btn btn-sm';
  claimBtnEl.dataset.testid = 'staking-claim-btn';
  claimBtnEl.textContent = 'Claim your colony account to stake';
  claimBtnEl.onclick = onClaimClick;

  row.appendChild(accountStatusEl);
  row.appendChild(claimBtnEl);
  return { row, accountStatusEl, claimBtnEl };
}

export function buildStakingFormRow(onStakeClick: () => void) {
  const formRow = document.createElement('div');
  formRow.className = 'ta-staking-panel__form-row';

  const poolField = document.createElement('label');
  poolField.className = 'ta-staking-panel__field';
  const poolLabel = document.createElement('span');
  poolLabel.className = 'ta-staking-panel__pos-label';
  poolLabel.textContent = 'Validator Pool (Whitelisted)';
  const poolSelect = document.createElement('select');
  poolSelect.className = 'ta-staking-panel__select';
  poolSelect.dataset.testid = 'staking-pool-select';
  poolField.appendChild(poolLabel);
  poolField.appendChild(poolSelect);

  const amountField = document.createElement('label');
  amountField.className = 'ta-staking-panel__field';
  const amountLabel = document.createElement('span');
  amountLabel.className = 'ta-staking-panel__pos-label';
  amountLabel.textContent = 'Amount (NEAR)';
  const amountInput = document.createElement('input');
  amountInput.type = 'text';
  amountInput.inputMode = 'decimal';
  amountInput.value = '10';
  amountInput.className = 'ta-staking-panel__input';
  amountInput.dataset.testid = 'staking-amount-input';
  amountField.appendChild(amountLabel);
  amountField.appendChild(amountInput);

  const stakeBtn = document.createElement('button');
  stakeBtn.type = 'button';
  stakeBtn.className = 'btn btn-sm btn-primary';
  stakeBtn.dataset.testid = 'staking-stake-btn';
  stakeBtn.textContent = 'Stake';
  stakeBtn.onclick = onStakeClick;

  formRow.appendChild(poolField);
  formRow.appendChild(amountField);
  formRow.appendChild(stakeBtn);
  return { formRow, poolSelect, amountInput, stakeBtn };
}

export function buildStakingPositionGrid() {
  const grid = document.createElement('div');
  grid.className = 'ta-staking-panel__position';
  grid.dataset.testid = 'staking-position-summary';

  const makeCell = (label: string, testid: string, initial: string) => {
    const cell = document.createElement('div');
    cell.className = 'ta-staking-panel__pos-cell';
    const l = document.createElement('span');
    l.className = 'ta-staking-panel__pos-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'ta-staking-panel__pos-value';
    v.dataset.testid = testid;
    v.textContent = initial;
    cell.appendChild(l);
    cell.appendChild(v);
    grid.appendChild(cell);
    return v;
  };

  const stakedValEl = makeCell('Staked', 'staking-staked-value', '0 NEAR staked');
  const rewardsValEl = makeCell('Net Rewards (7.2% APY)', 'staking-rewards-value', '0 NEAR');
  const unbondingValEl = makeCell('Unbonding', 'staking-unbonding-value', 'None');
  const withdrawableValEl = makeCell('Withdrawable', 'staking-withdrawable-value', '0 NEAR');

  return { grid, stakedValEl, rewardsValEl, unbondingValEl, withdrawableValEl };
}

export function buildStakingActionsRow(opts: {
  onUnstake: () => void;
  onWithdraw: () => void;
}) {
  const row = document.createElement('div');
  row.className = 'ta-staking-panel__actions-row';

  const btnGroup = document.createElement('div');
  btnGroup.className = 'ta-staking-panel__btn-group';

  const unstakeBtn = document.createElement('button');
  unstakeBtn.type = 'button';
  unstakeBtn.className = 'btn btn-sm';
  unstakeBtn.dataset.testid = 'staking-unstake-btn';
  unstakeBtn.textContent = 'Unstake';
  unstakeBtn.disabled = true;
  unstakeBtn.onclick = opts.onUnstake;

  const withdrawBtn = document.createElement('button');
  withdrawBtn.type = 'button';
  withdrawBtn.className = 'btn btn-sm';
  withdrawBtn.dataset.testid = 'staking-withdraw-btn';
  withdrawBtn.textContent = 'Withdraw';
  withdrawBtn.disabled = true;
  withdrawBtn.onclick = opts.onWithdraw;

  btnGroup.appendChild(unstakeBtn);
  btnGroup.appendChild(withdrawBtn);

  const statusMsgEl = document.createElement('span');
  statusMsgEl.className = 'ta-staking-panel__status-msg';
  statusMsgEl.dataset.testid = 'staking-status-msg';
  statusMsgEl.textContent = '';

  row.appendChild(btnGroup);
  row.appendChild(statusMsgEl);
  return { row, unstakeBtn, withdrawBtn, statusMsgEl };
}

export function renderStakingPoolOptions(
  poolSelectEl: HTMLSelectElement,
  pools: readonly StakingPoolInfo[],
): void {
  const prevVal = poolSelectEl.value;
  while (poolSelectEl.firstChild) {
    poolSelectEl.removeChild(poolSelectEl.firstChild);
  }
  for (const pool of pools) {
    const opt = document.createElement('option');
    opt.value = pool.poolId;
    opt.textContent = formatPoolOptionText(pool);
    poolSelectEl.appendChild(opt);
  }
  if (prevVal && pools.some((p) => p.poolId === prevVal)) {
    poolSelectEl.value = prevVal;
  }
}

export function upsertStakingPositionList(
  positions: readonly StakingPositionDto[],
  next: StakingPositionDto,
): readonly StakingPositionDto[] {
  const idx = positions.findIndex((p) => p.pool === next.pool);
  if (idx >= 0) {
    const copy = [...positions];
    copy[idx] = next;
    return copy;
  }
  return [next, ...positions];
}
