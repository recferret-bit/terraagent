//! W28: 25 bp `< 7d` early-unstake fee, `compound_yield`, single-step native withdraw rollback and
//! the wallet-scoped `get_account_positions` view.
use super::tests::{ctx, new_contract, ONE_NEAR};
use super::*;
use crate::accrual::compute_split_reward_delta;
use crate::mathx::{mul_div_ceil, mul_div_floor, mul_div_rem};
use near_sdk::test_utils::get_created_receipts;
use near_sdk::testing_env;
use near_sdk::{NearToken, PromiseError, PromiseOrValue};

const OP: &str = "minter.terraagent.testnet";
const POOL: &str = "astro.pool.testnet";
const T0: u64 = 1_700_000_000_000;
const WEEK: u64 = 604_800_000;

fn ts_ctx(who: &str, ms: u64) -> near_sdk::test_utils::VMContextBuilder {
    let mut b = ctx(who);
    b.block_timestamp(ms * 1_000_000);
    b
}

/// Operator-staked `amount` NEAR for `acct` in `POOL` at `at`.
fn staked(amount_near: u128, acct: &str, at: u64) -> StakingVaultContract {
    let mut c = new_contract();
    testing_env!(ctx(OP).build());
    c.credit_near("fund".into(), acct.into(), (amount_near * ONE_NEAR).to_string());
    c.stake("s1".into(), acct.into(), None, POOL.into(), 900, (amount_near * ONE_NEAR).to_string(), at);
    c
}

fn unstake(c: &mut StakingVaultContract, op: &str, acct: &str, amount: u128, at: u64) -> StakingPositionView {
    c.unstake(op.into(), acct.into(), POOL.into(), 900, amount.to_string(), at)
}

#[test]
fn fee_constants_match_staking_rules_ts() {
    assert_eq!(EARLY_EXIT_FEE_BP, 25);
    assert_eq!(EARLY_EXIT_WINDOW_MS, 604_800_000);
    assert_eq!(EARLY_EXIT_WINDOW_MS, 7 * GAME_DAY_MS);
}

#[test]
fn early_exit_fee_bp_exact_boundary_at_seven_days() {
    assert_eq!(fees::early_exit_fee_bp(Some(T0), T0), 25);
    assert_eq!(fees::early_exit_fee_bp(Some(T0), T0 + WEEK - 1), 25);
    assert_eq!(fees::early_exit_fee_bp(Some(T0), T0 + WEEK), 0);
    assert_eq!(fees::early_exit_fee_bp(Some(T0), T0 + WEEK + 1), 0);
    assert_eq!(fees::early_exit_fee_bp(None, T0), 0, "legacy positions without a clock are grandfathered");
    assert_eq!(fees::early_exit_fee_bp(Some(T0), T0 - 5), 25, "clock skew never underflows");
    assert_eq!(fees::early_exit_fee(10 * ONE_NEAR, Some(T0), T0), 25_000_000_000_000_000_000_000);
    assert_eq!(fees::early_exit_fee(3, Some(T0), T0), 0, "dust rounds down");
}

#[test]
fn mul_div_matches_checked_math_and_survives_u128_overflow() {
    assert_eq!(mul_div_floor(7, 3, 2), Some(10));
    assert_eq!(mul_div_ceil(7, 3, 2), Some(11));
    assert_eq!(mul_div_rem(10, 10, 4), Some((25, 0)));
    assert_eq!(mul_div_floor(1, 1, 0), None);
    // 1e30 * 1e30 overflows u128 but the quotient fits.
    let big = 1_000_000_000_000_000_000_000_000_000_000u128;
    assert_eq!(mul_div_floor(big, big, big), Some(big));
    assert_eq!(mul_div_floor(u128::MAX, u128::MAX, u128::MAX), Some(u128::MAX));
    assert_eq!(mul_div_floor(u128::MAX, 2, 1), None, "quotient above u128 is rejected");
    for (a, b, c) in [(123_456_789u128, 987_654_321u128, 1_000_003u128), (u64::MAX as u128, u64::MAX as u128, 7)] {
        assert_eq!(mul_div_floor(a, b, c), a.checked_mul(b).map(|p| p / c));
    }
}

#[test]
fn unstake_inside_seven_days_routes_25bp_to_protocol() {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    let day2 = T0 + 2 * GAME_DAY_MS;
    let (user_yield, proto_yield) = compute_split_reward_delta(10 * ONE_NEAR, 900, day2 - T0, 2_000);
    let u = unstake(&mut c, "u1", "col1.testnet", 10 * ONE_NEAR, day2);
    let fee = 10 * ONE_NEAR / 400; // 0.25 %
    assert_eq!(u.early_exit_fee.as_deref(), Some(fee.to_string().as_str()));
    assert_eq!(u.unbonding, (10 * ONE_NEAR - fee).to_string());
    assert_eq!(u.staked, "0");
    assert_eq!(u.rewards, user_yield.to_string());
    assert_eq!(c.get_protocol_yield_balance(), (proto_yield + fee).to_string());
}

#[test]
fn unstake_at_exactly_seven_days_is_free_and_one_ms_earlier_is_not() {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    let early = unstake(&mut c, "u-early", "col1.testnet", ONE_NEAR, T0 + WEEK - 1);
    assert_eq!(early.early_exit_fee.as_deref(), Some((ONE_NEAR / 400).to_string().as_str()));
    let on_time = unstake(&mut c, "u-ontime", "col1.testnet", ONE_NEAR, T0 + WEEK);
    assert_eq!(on_time.early_exit_fee.as_deref(), Some("0"));
    // Exit fee principal never reaches the unbonding bucket.
    assert_eq!(on_time.unbonding, (2 * ONE_NEAR - ONE_NEAR / 400).to_string());
}

#[test]
fn every_deposit_restarts_the_early_exit_clock_but_not_the_staked_since() {
    let mut c = staked(5, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    c.credit_near("fund2".into(), "col1.testnet".into(), (5 * ONE_NEAR).to_string());
    c.stake("s2".into(), "col1.testnet".into(), None, POOL.into(), 900, (5 * ONE_NEAR).to_string(), T0 + 6 * GAME_DAY_MS);
    let p = &c.get_account_positions("col1.testnet".into(), None, None)[0];
    assert_eq!(p.staked_since_ms, Some(T0));
    assert_eq!(p.last_staked_at_ms, Some(T0 + 6 * GAME_DAY_MS));
    // 8 days after the first deposit but only 2 after the latest: fee applies.
    let u = unstake(&mut c, "u1", "col1.testnet", ONE_NEAR, T0 + 8 * GAME_DAY_MS);
    assert_eq!(u.early_exit_fee.as_deref(), Some((ONE_NEAR / 400).to_string().as_str()));
}

#[test]
fn legacy_position_without_meta_is_grandfathered_until_registered() {
    let mut c = new_contract();
    c.positions.insert(
        pos_key("old.testnet", POOL),
        StakingRecord { staked: 4 * ONE_NEAR, last_accrued_at_ms: T0, ..Default::default() },
    );
    testing_env!(ctx(OP).build());
    assert!(c.get_account_positions("old.testnet".into(), None, None).is_empty());
    c.register_position("old.testnet".into(), POOL.into(), None, Some(T0));
    let listed = c.get_account_positions("old.testnet".into(), None, None);
    assert_eq!((listed.len(), listed[0].asset.as_str(), listed[0].last_staked_at_ms), (1, "NEAR", Some(T0)));
    let u = unstake(&mut c, "u-old", "old.testnet", ONE_NEAR, T0 + GAME_DAY_MS);
    assert_eq!(u.early_exit_fee.as_deref(), Some((ONE_NEAR / 400).to_string().as_str()));
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn register_position_is_operator_only() {
    let mut c = staked(1, "col1.testnet", T0);
    testing_env!(ctx("mallory.testnet").build());
    c.register_position("col1.testnet".into(), POOL.into(), None, None);
}

#[test]
fn compound_rolls_80pct_into_principal_credits_20pct_and_keeps_maturity() {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    let day8 = T0 + 8 * GAME_DAY_MS;
    let (user_yield, proto_yield) = compute_split_reward_delta(10 * ONE_NEAR, 900, day8 - T0, 2_000);
    let r = c.compound_yield(POOL.into(), Some("col1.testnet".into()), Some(900), Some(day8));
    assert_eq!(r.compounded, user_yield.to_string());
    assert_eq!(r.protocol_cut, proto_yield.to_string());
    assert_eq!(r.position.staked, (10 * ONE_NEAR + user_yield).to_string());
    assert_eq!(r.position.rewards, "0");
    assert_eq!(c.get_protocol_yield_balance(), proto_yield.to_string());
    // Maturity clocks untouched: 8 days after the only deposit, so a full exit right now is free.
    let p = &c.get_account_positions("col1.testnet".into(), None, None)[0];
    assert_eq!((p.staked_since_ms, p.last_staked_at_ms), (Some(T0), Some(T0)));
    let u = unstake(&mut c, "u-after-compound", "col1.testnet", 10 * ONE_NEAR + user_yield, day8);
    assert_eq!(u.early_exit_fee.as_deref(), Some("0"));
    assert_eq!(u.unbonding, (10 * ONE_NEAR + user_yield).to_string());
}

#[test]
fn compound_moves_backed_yield_from_reserve_to_position_backing() {
    let mut c = new_contract();
    testing_env!(ts_ctx("alice.testnet", T0).attached_deposit(NearToken::from_near(10)).build());
    c.stake_payable("pay".into(), POOL.into(), 900, T0, None);
    testing_env!(ctx("terraagent.testnet").attached_deposit(NearToken::from_near(2)).build());
    c.fund_yield_reserve();
    testing_env!(ts_ctx("alice.testnet", T0 + 30 * GAME_DAY_MS).build());
    let r = c.compound_yield(POOL.into(), None, Some(900), None);
    let rolled: u128 = r.compounded.parse().unwrap();
    assert!(rolled > 0);
    assert_eq!(c.get_position_native_backing("alice.testnet".into(), POOL.into()), (10 * ONE_NEAR + rolled).to_string());
    assert_eq!(c.get_yield_reserve(), (2 * ONE_NEAR - rolled).to_string());
}

#[test]
#[should_panic(expected = "STAKE_NO_YIELD")]
fn compound_with_zero_yield_panics() {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    c.compound_yield(POOL.into(), Some("col1.testnet".into()), Some(900), Some(T0));
}

#[test]
#[should_panic(expected = "STAKE_NO_YIELD")]
fn compound_without_a_position_panics() {
    let mut c = new_contract();
    testing_env!(ts_ctx("nobody.testnet", T0).build());
    c.compound_yield(POOL.into(), None, None, None);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn compound_for_another_wallet_by_a_non_operator_is_rejected() {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ts_ctx("mallory.testnet", T0 + 9 * GAME_DAY_MS).build());
    c.compound_yield(POOL.into(), Some("col1.testnet".into()), None, None);
}

#[test]
#[should_panic(expected = "STAKE_INVALID_APY")]
fn compound_by_a_wallet_cannot_inflate_apy() {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ts_ctx("col1.testnet", T0 + 9 * GAME_DAY_MS).build());
    c.compound_yield(POOL.into(), None, Some(5_000), None);
}

fn stake_unstake_ready(at_withdraw: u64) -> StakingVaultContract {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    unstake(&mut c, "u1", "col1.testnet", 10 * ONE_NEAR, T0 + WEEK);
    let _ = at_withdraw;
    c
}

#[test]
fn failed_native_transfer_rolls_the_position_back_and_allows_a_retry() {
    let mut c = stake_unstake_ready(0);
    let ready = T0 + WEEK + UNBONDING_DURATION_MS;
    testing_env!(ctx(OP).build());
    let before = c.get_position("col1.testnet".into(), POOL.into(), 900, ready);
    let owed: u128 = before.withdrawable.parse::<u128>().unwrap() + before.rewards.parse::<u128>().unwrap();
    assert!(matches!(
        c.withdraw("w1".into(), "col1.testnet".into(), Some("wallet.testnet".into()), POOL.into(), 900, ready),
        PromiseOrValue::Promise(_)
    ));
    assert!(!get_created_receipts().is_empty(), "transfer + callback receipts are scheduled");
    let mid = c.get_position("col1.testnet".into(), POOL.into(), 0, ready);
    assert_eq!((mid.withdrawable.as_str(), mid.rewards.as_str()), ("0", "0"));

    testing_env!(ctx("staking.terraagent.testnet").build());
    let res = c.on_withdraw(
        "w1".into(), "col1.testnet".into(), POOL.into(), "wallet.testnet".into(),
        before.withdrawable.clone(), before.rewards.clone(), "0".into(), "0".into(),
        Err(PromiseError::Failed),
    );
    assert_eq!(res.withdrawn, "0");
    let restored = c.get_position("col1.testnet".into(), POOL.into(), 0, ready);
    assert_eq!(restored.withdrawable, before.withdrawable);
    assert_eq!(restored.rewards, before.rewards);

    // The op is not cached after a failure: the same op_id can be retried and settles.
    testing_env!(ctx(OP).build());
    assert!(matches!(
        c.withdraw("w1".into(), "col1.testnet".into(), Some("wallet.testnet".into()), POOL.into(), 900, ready),
        PromiseOrValue::Promise(_)
    ));
    testing_env!(ctx("staking.terraagent.testnet").build());
    let ok = c.on_withdraw(
        "w1".into(), "col1.testnet".into(), POOL.into(), "wallet.testnet".into(),
        before.withdrawable, before.rewards, "0".into(), "0".into(), Ok(()),
    );
    assert_eq!(ok.withdrawn, owed.to_string());
}

#[test]
fn native_rollback_also_restores_backing_and_reserve() {
    let mut c = new_contract();
    testing_env!(ts_ctx("alice.testnet", T0).attached_deposit(NearToken::from_near(10)).build());
    c.stake_payable("pay".into(), POOL.into(), 900, T0, None);
    testing_env!(ctx("terraagent.testnet").attached_deposit(NearToken::from_near(2)).build());
    c.fund_yield_reserve();
    testing_env!(ctx(OP).account_balance(NearToken::from_near(30)).build());
    unstake(&mut c, "u", "alice.testnet", 10 * ONE_NEAR, T0 + WEEK);
    let ready = T0 + WEEK + UNBONDING_DURATION_MS;
    let _ = c.withdraw("w".into(), "alice.testnet".into(), None, POOL.into(), 900, ready);
    assert_eq!(c.get_position_native_backing("alice.testnet".into(), POOL.into()), "0");
    let reserve_after = c.get_yield_reserve();
    testing_env!(ctx("staking.terraagent.testnet").build());
    c.on_withdraw(
        "w".into(), "alice.testnet".into(), POOL.into(), "alice.testnet".into(),
        (10 * ONE_NEAR).to_string(), "5".into(), (10 * ONE_NEAR).to_string(), "5".into(),
        Err(PromiseError::Failed),
    );
    assert_eq!(c.get_position_native_backing("alice.testnet".into(), POOL.into()), (10 * ONE_NEAR).to_string());
    assert_eq!(c.get_yield_reserve().parse::<u128>().unwrap(), reserve_after.parse::<u128>().unwrap() + 5);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn withdraw_rejects_unauthorised_caller() {
    let mut c = stake_unstake_ready(0);
    testing_env!(ctx("mallory.testnet").build());
    let _ = c.withdraw("w".into(), "col1.testnet".into(), Some("mallory.testnet".into()), POOL.into(), 900, T0 + WEEK + UNBONDING_DURATION_MS);
}

#[test]
#[should_panic(expected = "no withdrawable NEAR")]
fn withdraw_with_nothing_unbonded_panics() {
    let mut c = staked(10, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    let _ = c.withdraw("w".into(), "col1.testnet".into(), None, POOL.into(), 900, T0 + 1);
}

#[test]
#[should_panic(expected = "STAKE_INVALID_RECIPIENT")]
fn withdraw_rejects_an_invalid_recipient_before_touching_state() {
    let mut c = stake_unstake_ready(0);
    testing_env!(ctx(OP).build());
    let _ = c.withdraw("w".into(), "col1.testnet".into(), Some("BAD ID".into()), POOL.into(), 900, T0 + WEEK + UNBONDING_DURATION_MS);
}

#[test]
#[should_panic(expected = "liquid balance below storage reserve")]
fn withdraw_requires_the_contract_to_hold_the_payout() {
    let mut c = stake_unstake_ready(0);
    testing_env!(ctx(OP).account_balance(NearToken::from_near(1)).build());
    let _ = c.withdraw("w".into(), "col1.testnet".into(), None, POOL.into(), 900, T0 + WEEK + UNBONDING_DURATION_MS);
}

#[test]
fn get_account_positions_lists_every_pool_of_a_wallet_without_colonies() {
    let mut c = new_contract();
    testing_env!(ctx(OP).build());
    c.credit_near("f".into(), "wallet.testnet".into(), (6 * ONE_NEAR).to_string());
    c.stake("a".into(), "wallet.testnet".into(), None, "pool-a".into(), 900, (4 * ONE_NEAR).to_string(), T0);
    c.stake("b".into(), "wallet.testnet".into(), None, "pool-b".into(), 900, (2 * ONE_NEAR).to_string(), T0 + GAME_DAY_MS);
    let all = c.get_account_positions("wallet.testnet".into(), None, None);
    assert_eq!(all.iter().map(|p| p.pool_id.as_str()).collect::<Vec<_>>(), ["pool-a", "pool-b"]);
    assert_eq!((all[0].asset.as_str(), all[0].staked.as_str()), ("NEAR", (4 * ONE_NEAR).to_string().as_str()));
    assert_eq!(all[1].last_staked_at_ms, Some(T0 + GAME_DAY_MS));
    assert!(c.get_account_positions("stranger.testnet".into(), None, None).is_empty());
    // Projection: with apy the stored rewards advance; without it they do not.
    let projected = c.get_account_positions("wallet.testnet".into(), Some(900), Some(T0 + 30 * GAME_DAY_MS));
    assert!(projected[0].rewards.parse::<u128>().unwrap() > 0);
    assert_eq!(all[0].rewards, "0");
}

#[test]
fn emptied_position_forgets_clocks_and_restarts_on_next_deposit() {
    let mut c = staked(2, "col1.testnet", T0);
    testing_env!(ctx(OP).build());
    unstake(&mut c, "u", "col1.testnet", 2 * ONE_NEAR, T0 + WEEK);
    let p = &c.get_account_positions("col1.testnet".into(), None, None)[0];
    assert_eq!((p.staked_since_ms, p.last_staked_at_ms), (None, None));
    c.credit_near("again".into(), "col1.testnet".into(), ONE_NEAR.to_string());
    c.stake("s2".into(), "col1.testnet".into(), None, POOL.into(), 900, ONE_NEAR.to_string(), T0 + 20 * GAME_DAY_MS);
    let p = &c.get_account_positions("col1.testnet".into(), None, None)[0];
    assert_eq!(p.staked_since_ms, Some(T0 + 20 * GAME_DAY_MS));
}

#[test]
fn blocks_third_party_early_exit_clock_reset_across_payable_and_lst_entries() {
    let mut c = staked(100, "whale.testnet", T0);
    // Stranger cannot reset whale's 7-day maturity clock via stake_payable.
    testing_env!(ts_ctx("mallory.testnet", T0 + 10 * GAME_DAY_MS).attached_deposit(NearToken::from_millinear(10)).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.stake_payable("grief-1".into(), POOL.into(), 900, T0 + 10 * GAME_DAY_MS, Some("whale.testnet".into()));
    })).is_err());

    // Stranger cannot reset whale's maturity clock via NEP-141 ft_on_transfer or dust shares.
    testing_env!(ts_ctx("meta-pool.near", T0 + 10 * GAME_DAY_MS).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ft_on_transfer("mallory.testnet".parse().unwrap(), ONE_NEAR.to_string(), r#"{"pool_id":"meta-pool.near","account_id":"whale.testnet"}"#.into());
    })).is_err());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.ft_on_transfer("whale.testnet".parse().unwrap(), "1".into(), r#"{"pool_id":"meta-pool.near"}"#.into());
    })).is_err());

    // Whale's 7-day maturity remains intact -> 0 bp exit fee!
    testing_env!(ctx(OP).build());
    let u = unstake(&mut c, "whale-free-exit", "whale.testnet", 100 * ONE_NEAR, T0 + 10 * GAME_DAY_MS);
    assert_eq!(u.early_exit_fee.as_deref(), Some("0"));
}

#[test]
fn get_account_positions_projects_unbonding_maturity_and_price_mode_rewards_and_enforces_gas_guards() {
    let mut c = stake_unstake_ready(0);
    let ready = T0 + WEEK + UNBONDING_DURATION_MS;
    let listed = c.get_account_positions("col1.testnet".into(), None, Some(ready));
    assert_eq!(listed[0].unbonding, "0");
    assert_eq!(listed[0].withdrawable, (10 * ONE_NEAR).to_string());

    // Price-mode LST pool also projects realized share-appreciation rewards in get_account_positions.
    testing_env!(ctx(OP).build());
    c.bind_lst_pool("meta-pool.near".into(), "meta-pool.near".parse().unwrap());
    testing_env!(ts_ctx("staking.terraagent.testnet", T0).build());
    c.on_lst_price("meta-pool.near".into(), Ok(near_sdk::json_types::U128(crate::lst::PRICE_ONE)));
    testing_env!(ts_ctx("meta-pool.near", T0).build());
    c.ft_on_transfer("whale.testnet".parse().unwrap(), (10 * ONE_NEAR).to_string(), r#"{"pool_id":"meta-pool.near","apy_bp":0}"#.into());
    testing_env!(ts_ctx("staking.terraagent.testnet", T0 + WEEK).build());
    c.on_lst_price("meta-pool.near".into(), Ok(near_sdk::json_types::U128(crate::lst::PRICE_ONE * 12 / 10)));
    let lst_pos = c.get_account_positions("whale.testnet".into(), None, Some(T0 + WEEK));
    assert!(lst_pos[0].rewards.parse::<u128>().unwrap() > 0, "price-mode rewards projected in get_account_positions");

    // Low prepaid gas on withdraw / withdraw_lst / deposit_and_stake_lst fails fast, and 1 yoctoNEAR on withdraw_lst works.
    let mut low_w = ctx(OP);
    low_w.prepaid_gas(near_sdk::Gas::from_tgas(20));
    testing_env!(low_w.build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.withdraw("w-low".into(), "col1.testnet".into(), None, POOL.into(), 900, ready);
    })).is_err());

    let mut low_lst = ts_ctx("whale.testnet", T0 + WEEK);
    low_lst.prepaid_gas(near_sdk::Gas::from_tgas(30));
    testing_env!(low_lst.build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.withdraw_lst("meta-pool.near".into(), "meta-pool.near".parse().unwrap(), ONE_NEAR.to_string(), None, None);
    })).is_err());

    // 1 yoctoNEAR attached deposit on withdraw_lst is accepted; 2 yoctoNEAR is rejected.
    testing_env!(ctx(OP).build());
    c.unstake("u-lst".into(), "whale.testnet".into(), "meta-pool.near".into(), 0, ONE_NEAR.to_string(), T0 + WEEK);
    let lst_ready = T0 + WEEK + UNBONDING_DURATION_MS;
    testing_env!(ts_ctx("whale.testnet", lst_ready).attached_deposit(NearToken::from_yoctonear(2)).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.withdraw_lst("meta-pool.near".into(), "meta-pool.near".parse().unwrap(), ONE_NEAR.to_string(), None, None);
    })).is_err());
    testing_env!(ts_ctx("whale.testnet", lst_ready).attached_deposit(NearToken::from_yoctonear(1)).build());
    let _ = c.withdraw_lst("meta-pool.near".into(), "meta-pool.near".parse().unwrap(), ONE_NEAR.to_string(), None, None);
}

#[test]
fn self_custody_owner_can_unstake_and_withdraw_backed_near_without_operator_and_virtual_self_withdraw_fails() {
    let mut c = new_contract();
    // Alice stakes 10 real NEAR via stake_payable.
    testing_env!(ts_ctx("alice.testnet", T0).account_balance(NearToken::from_near(30)).attached_deposit(NearToken::from_near(10)).build());
    c.stake_payable("self-s1".into(), POOL.into(), 900, T0, None);

    // At day 2, Alice unstakes directly from her own wallet (trying to spoof now_ms = T0 + 100d to dodge exit fee).
    let day2 = T0 + 2 * GAME_DAY_MS;
    testing_env!(ts_ctx("alice.testnet", day2).account_balance(NearToken::from_near(30)).build());
    let u = c.unstake("self-u1".into(), "alice.testnet".into(), POOL.into(), 900, (10 * ONE_NEAR).to_string(), T0 + 100 * GAME_DAY_MS);
    let fee = 10 * ONE_NEAR / 400;
    assert_eq!(u.early_exit_fee.as_deref(), Some(fee.to_string().as_str()), "chain block_timestamp enforces 25 bp exit fee");

    // After 2d unbonding, Alice withdraws directly without operator (unbacked simulated yield stays untouched; principal transfers out).
    let ready = day2 + UNBONDING_DURATION_MS;
    testing_env!(ts_ctx("alice.testnet", ready).account_balance(NearToken::from_near(30)).build());
    assert!(matches!(
        c.withdraw("self-w1".into(), "alice.testnet".into(), None, POOL.into(), 900, ready),
        PromiseOrValue::Promise(_)
    ));

    // A virtual credit_near account cannot self-withdraw real users' NEAR without operator settlement.
    testing_env!(ctx(OP).account_balance(NearToken::from_near(30)).build());
    c.credit_near("virt-f".into(), "virt.testnet".into(), (5 * ONE_NEAR).to_string());
    c.stake("virt-s".into(), "virt.testnet".into(), None, POOL.into(), 0, (5 * ONE_NEAR).to_string(), T0);
    c.unstake("virt-u".into(), "virt.testnet".into(), POOL.into(), 0, (5 * ONE_NEAR).to_string(), T0 + WEEK);
    testing_env!(ts_ctx("virt.testnet", T0 + WEEK + UNBONDING_DURATION_MS).account_balance(NearToken::from_near(30)).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.withdraw("virt-w".into(), "virt.testnet".into(), None, POOL.into(), 0, T0 + WEEK + UNBONDING_DURATION_MS);
    })).is_err());
}

#[test]
fn deposit_and_stake_lst_rejects_stale_cached_price_and_uses_live_callback_price() {
    let mut c = new_contract();
    testing_env!(ctx(OP).build());
    c.bind_lst_pool("meta-pool.near".into(), "meta-pool.near".parse().unwrap());
    testing_env!(ts_ctx("staking.terraagent.testnet", T0).build());
    c.on_lst_price("meta-pool.near".into(), Ok(near_sdk::json_types::U128(crate::lst::PRICE_ONE)));
    assert_eq!(c.get_lst_price_updated_at_ms("meta-pool.near".into()), Some(T0));

    // Over 1 hour later without refresh_lst_price -> STAKE_PRICE_STALE.
    let stale_ts = T0 + crate::lst::MAX_LST_PRICE_AGE_MS + 1;
    testing_env!(ts_ctx("alice.testnet", stale_ts).attached_deposit(NearToken::from_near(12)).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.deposit_and_stake_lst("meta-pool.near".into(), "meta-pool.near".parse().unwrap(), None, None);
    })).is_err());

    // Live Promise::and price (1.20 NEAR/share) overrides cached 1.00 NEAR/share so vault never over-mints shares!
    let live_price = crate::lst::PRICE_ONE * 12 / 10;
    let live_bytes = near_sdk::serde_json::to_vec(&near_sdk::json_types::U128(live_price)).unwrap();
    testing_env!(
        ts_ctx("staking.terraagent.testnet", T0 + 1_000).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Successful(vec![]), near_sdk::PromiseResult::Successful(live_bytes)]
    );
    assert!(c.on_lst_deposit(
        "alice.testnet".parse().unwrap(), "alice.testnet".into(), "meta-pool.near".into(), "meta-pool.near".into(),
        (12 * ONE_NEAR).to_string(), crate::lst::PRICE_ONE.to_string(), T0 + 1_000,
    ));
    let pos = c.get_account_positions("alice.testnet".into(), None, Some(T0 + 1_000));
    assert_eq!(pos[0].staked, (10 * ONE_NEAR).to_string(), "12 NEAR at live 1.20 price books 10 shares, not 12");
}
