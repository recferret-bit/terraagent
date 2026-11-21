//! Simulated-APY accrual (mock / testnet) and the 80/20 split, plus the position view projection.
use crate::{StakingPositionView, StakingRecord, CFG_YIELD_BP_KEY, DEFAULT_PROTOCOL_YIELD_SHARE_BP, YEAR_MS};
use near_sdk::env;

/// Overflow-free reward accrual matching `@terra/sim` / `yocto.ts`:
/// `floor(staked * apy_bp * elapsed_ms / (10_000 * 365 * 86_400_000))`.
pub(crate) fn compute_accrued_reward_delta(staked: u128, apy_bp: u32, elapsed_ms: u64) -> u128 {
    if staked == 0 || apy_bp == 0 || elapsed_ms == 0 {
        return 0;
    }
    let den: u128 = 10_000u128 * YEAR_MS;
    let factor: u128 = (apy_bp as u128) * (elapsed_ms as u128);
    (staked / den) * factor + ((staked % den) * factor) / den
}

pub(crate) fn read_protocol_yield_bp() -> u32 {
    match env::storage_read(CFG_YIELD_BP_KEY) {
        Some(bytes) if bytes.len() == 4 => {
            let mut arr = [0u8; 4];
            arr.copy_from_slice(&bytes);
            let bp = u32::from_le_bytes(arr);
            if bp <= 10_000 {
                bp
            } else {
                DEFAULT_PROTOCOL_YIELD_SHARE_BP
            }
        }
        _ => DEFAULT_PROTOCOL_YIELD_SHARE_BP,
    }
}

/// Splits gross accrued validator yield into `(staker_reward, protocol_yield)` using `yield_bp` (`0..=10_000`).
pub(crate) fn compute_split_reward_delta(
    staked: u128,
    apy_bp: u32,
    elapsed_ms: u64,
    yield_bp: u32,
) -> (u128, u128) {
    let gross = compute_accrued_reward_delta(staked, apy_bp, elapsed_ms);
    let share = (yield_bp.min(10_000)) as u128;
    let protocol_cut = (gross / 10_000u128) * share + ((gross % 10_000u128) * share) / 10_000u128;
    (gross.saturating_sub(protocol_cut), protocol_cut)
}

pub(crate) fn project_record(
    record: &StakingRecord,
    apy_bp: u32,
    now_ms: u64,
    yield_bp: u32,
) -> (StakingRecord, u128) {
    let mut next = record.clone();
    let mut protocol_cut = 0u128;
    if next.last_accrued_at_ms > 0 && now_ms > next.last_accrued_at_ms {
        let elapsed = now_ms - next.last_accrued_at_ms;
        let (user_reward, cut) = compute_split_reward_delta(next.staked, apy_bp, elapsed, yield_bp);
        next.rewards = next.rewards.saturating_add(user_reward);
        protocol_cut = cut;
    }
    if next.unbonding > 0 {
        if let Some(ready_at) = next.unbonding_ready_at_ms {
            if now_ms >= ready_at {
                next.withdrawable = next.withdrawable.saturating_add(next.unbonding);
                next.unbonding = 0;
                next.unbonding_ready_at_ms = None;
            }
        }
    }
    // Monotonic timestamp progression prevents out-of-order clock skew from double-accruing yield.
    next.last_accrued_at_ms = next.last_accrued_at_ms.max(now_ms);
    (next, protocol_cut)
}

pub(crate) fn to_view(account_id: &str, pool_id: &str, rec: &StakingRecord) -> StakingPositionView {
    StakingPositionView {
        account_id: account_id.to_string(),
        pool_id: pool_id.to_string(),
        staked: rec.staked.to_string(),
        unbonding: rec.unbonding.to_string(),
        unbonding_ready_at_ms: rec.unbonding_ready_at_ms,
        withdrawable: rec.withdrawable.to_string(),
        rewards: rec.rewards.to_string(),
        early_exit_fee: None,
    }
}
