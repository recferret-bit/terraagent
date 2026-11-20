//! W28 fee rules. The constants mirror `STAKING_RULES` in `shared/contracts/src/staking/tiers.ts`
//! (`earlyExitFeeBp = 25`, `earlyExitWindowMs = 604_800_000`); change both together.
use crate::mathx::mul_div_floor;

/// Early-unstake fee in basis points (`0.25 %`) routed to `protocol.<owner_id>`.
pub const EARLY_EXIT_FEE_BP: u32 = 25;
/// Principal staked for less than this long pays [`EARLY_EXIT_FEE_BP`] when unstaked (7 days).
pub const EARLY_EXIT_WINDOW_MS: u64 = 604_800_000;
pub const BP_DENOMINATOR: u128 = 10_000;

/// `floor(amount * bp / 10_000)` without overflow.
pub fn bp_of(amount: u128, bp: u32) -> u128 {
    mul_div_floor(amount, bp as u128, BP_DENOMINATOR).unwrap_or(0)
}

/// `25` while the last deposit is strictly younger than 7 days, `0` at exactly 7 days or later and for
/// legacy positions without a recorded deposit clock.
pub fn early_exit_fee_bp(last_staked_at_ms: Option<u64>, now_ms: u64) -> u32 {
    match last_staked_at_ms {
        Some(last) if last > 0 && now_ms.saturating_sub(last) < EARLY_EXIT_WINDOW_MS => {
            EARLY_EXIT_FEE_BP
        }
        _ => 0,
    }
}

/// Fee in yocto charged on `principal` being unstaked.
pub fn early_exit_fee(principal: u128, last_staked_at_ms: Option<u64>, now_ms: u64) -> u128 {
    bp_of(principal, early_exit_fee_bp(last_staked_at_ms, now_ms))
}
