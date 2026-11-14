use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn ctx(predecessor: &str) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id("staking.terraagent.testnet".parse().unwrap())
        .predecessor_account_id(predecessor.parse().unwrap())
        .account_balance(NearToken::from_near(20));
    builder
}

fn new_contract() -> StakingVaultContract {
    testing_env!(ctx("terraagent.testnet").build());
    StakingVaultContract::new(
        "terraagent.testnet".parse().unwrap(),
        "minter.terraagent.testnet".parse().unwrap(),
    )
}

#[test]
fn stake_unstake_unbonding_rewards_and_withdraw_flow() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());

    let ten_near = (10 * ONE_NEAR).to_string();
    let four_near = (4 * ONE_NEAR).to_string();
    let six_near = (6 * ONE_NEAR).to_string();

    contract.credit_near("op-fund".into(), "col1.testnet".into(), ten_near.clone());
    let t0 = 1_700_000_000_000u64;
    let s1 = contract.stake(
        "op-stake-1".into(),
        "col1.testnet".into(),
        None,
        "astro-stakers.pool.mock".into(),
        900,
        ten_near.clone(),
        t0,
    );
    assert_eq!(s1.staked, ten_near);

    // Replay returns cached position without double debit.
    let s2 = contract.stake(
        "op-stake-1".into(),
        "col1.testnet".into(),
        None,
        "astro-stakers.pool.mock".into(),
        900,
        ten_near.clone(),
        t0,
    );
    assert_eq!(s2.staked, ten_near);

    // Unstake after 10 game days -> accrues 80% user rewards + 20% protocol cut.
    let t10 = t0 + 10 * GAME_DAY_MS;
    let u1 = contract.unstake(
        "op-unstake-1".into(),
        "col1.testnet".into(),
        "astro-stakers.pool.mock".into(),
        900,
        four_near.clone(),
        t10,
    );
    assert_eq!(u1.staked, six_near);
    assert_eq!(u1.unbonding, four_near);
    assert!(u1.rewards.parse::<u128>().unwrap() > 0);

    // Advance 2 game days -> unbonding matures into withdrawable.
    let t12 = t10 + UNBONDING_DURATION_MS;
    let pos = contract.get_position(
        "col1.testnet".into(),
        "astro-stakers.pool.mock".into(),
        900,
        t12,
    );
    assert_eq!(pos.unbonding, "0");
    assert_eq!(pos.withdrawable, four_near);

    let w = contract.withdraw(
        "op-withdraw-1".into(),
        "col1.testnet".into(),
        None,
        "astro-stakers.pool.mock".into(),
        900,
        t12,
    );
    assert!(w.withdrawn.parse::<u128>().unwrap() > four_near.parse::<u128>().unwrap());
    assert!(contract.get_near_balance("col1.testnet".into()).parse::<u128>().unwrap() > 0);
    assert!(contract.get_protocol_yield_balance().parse::<u128>().unwrap() > 0);
}

#[test]
fn exact_80_20_yield_conservation_over_full_year() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());

    let ten_near = 10 * ONE_NEAR;
    contract.credit_near("op-fund".into(), "col1.testnet".into(), ten_near.to_string());
    let t0 = 1_700_000_000_000u64;
    contract.stake(
        "op-s".into(),
        "col1.testnet".into(),
        None,
        "astro.pool".into(),
        900,
        ten_near.to_string(),
        t0,
    );

    let t_year = t0 + 365 * GAME_DAY_MS;
    let u = contract.unstake(
        "op-u".into(),
        "col1.testnet".into(),
        "astro.pool".into(),
        900,
        ten_near.to_string(),
        t_year,
    );

    // 10 NEAR @ 9.00% gross = 0.90 NEAR -> 0.72 NEAR staker (80%) + 0.18 NEAR protocol (20%).
    let user_reward: u128 = u.rewards.parse().unwrap();
    let proto_reward: u128 = contract.get_protocol_yield_balance().parse().unwrap();
    assert_eq!(user_reward, 720_000_000_000_000_000_000_000);
    assert_eq!(proto_reward, 180_000_000_000_000_000_000_000);
    assert_eq!(user_reward + proto_reward, 900_000_000_000_000_000_000_000);
}

#[test]
fn monotonic_clock_blocks_out_of_order_double_accrual() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());

    let twenty_near = 20 * ONE_NEAR;
    contract.credit_near("op-fund".into(), "col1.testnet".into(), twenty_near.to_string());
    let t0 = 1_700_000_000_000u64;
    contract.stake(
        "op-s1".into(),
        "col1.testnet".into(),
        None,
        "astro.pool".into(),
        900,
        (10 * ONE_NEAR).to_string(),
        t0,
    );

    // Accrue 10 days of rewards at t0 + 10d.
    let t10 = t0 + 10 * GAME_DAY_MS;
    let after_t10 = contract.stake(
        "op-s2".into(),
        "col1.testnet".into(),
        None,
        "astro.pool".into(),
        900,
        ONE_NEAR.to_string(),
        t10,
    );
    let rewards_at_t10: u128 = after_t10.rewards.parse().unwrap();
    let proto_at_t10: u128 = contract.get_protocol_yield_balance().parse().unwrap();

    // Out-of-order call with stale timestamp t0 + 5d must NOT rewind `last_accrued_at_ms`.
    let t5 = t0 + 5 * GAME_DAY_MS;
    contract.stake(
        "op-s3".into(),
        "col1.testnet".into(),
        None,
        "astro.pool".into(),
        900,
        ONE_NEAR.to_string(),
        t5,
    );

    // Querying or acting again at t10 must yield zero extra rewards over `rewards_at_t10`.
    let again_at_t10 = contract.stake(
        "op-s4".into(),
        "col1.testnet".into(),
        None,
        "astro.pool".into(),
        900,
        ONE_NEAR.to_string(),
        t10,
    );
    assert_eq!(again_at_t10.rewards.parse::<u128>().unwrap(), rewards_at_t10);
    assert_eq!(contract.get_protocol_yield_balance().parse::<u128>().unwrap(), proto_at_t10);
}

#[test]
fn owner_rotates_operator_and_protocol_account() {
    let mut contract = new_contract();
    assert_eq!(contract.get_protocol_account(), "protocol.terraagent.testnet");

    testing_env!(ctx("terraagent.testnet").build());
    contract.set_operator("new-op.terraagent.testnet".parse().unwrap());
    contract.set_protocol_account("treasury-v2.terraagent.testnet".parse().unwrap());
    assert_eq!(contract.get_operator().as_str(), "new-op.terraagent.testnet");
    assert_eq!(contract.get_protocol_account(), "treasury-v2.terraagent.testnet");

    testing_env!(ctx("new-op.terraagent.testnet").build());
    contract.credit_near("op-f".into(), "col1.testnet".into(), (10 * ONE_NEAR).to_string());
    let t0 = 1_700_000_000_000u64;
    contract.stake("op-s".into(), "col1.testnet".into(), None, "p1".into(), 900, (10 * ONE_NEAR).to_string(), t0);
    contract.unstake("op-u".into(), "col1.testnet".into(), "p1".into(), 900, ONE_NEAR.to_string(), t0 + 30 * GAME_DAY_MS);

    let custom_bal: u128 = contract
        .get_near_balance("treasury-v2.terraagent.testnet".into())
        .parse()
        .unwrap();
    assert!(custom_bal > 0);
    assert_eq!(contract.get_protocol_yield_balance(), custom_bal.to_string());
}

#[test]
fn deposit_near_and_claim_native_near_blocks_virtual_credit_drain() {
    let mut contract = new_contract();

    // Operator credits 10 virtual NEAR; user deposits 2 real NEAR.
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-virt".into(), "pilot.testnet".into(), (10 * ONE_NEAR).to_string());

    let mut dep_ctx = ctx("pilot.testnet");
    dep_ctx.attached_deposit(NearToken::from_near(2));
    testing_env!(dep_ctx.build());
    let total = contract.deposit_near(None);
    assert_eq!(total, (12 * ONE_NEAR).to_string());
    assert_eq!(contract.get_native_deposit_balance("pilot.testnet".into()), (2 * ONE_NEAR).to_string());

    // User claims their 2 real NEAR -> succeeds and reduces vault balance from 12 to 10 NEAR.
    testing_env!(ctx("pilot.testnet").build());
    let _promise = contract.claim_native_near((2 * ONE_NEAR).to_string(), None);
    assert_eq!(contract.get_near_balance("pilot.testnet".into()), (10 * ONE_NEAR).to_string());
    assert_eq!(contract.get_native_deposit_balance("pilot.testnet".into()), "0");

    // Attempting to claim 1 yoctoNEAR from virtual balance panics cleanly!
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = contract.claim_native_near("1".into(), None);
    }));
    assert!(panicked.is_err());

    // Simulate cross-shard transfer failure -> callback restores both balances and native deposit ledger!
    testing_env!(ctx("staking.terraagent.testnet").build());
    let ok_fail = contract.on_claim_native_near(
        "pilot.testnet".into(),
        "pilot.testnet".into(),
        (2 * ONE_NEAR).to_string(),
        Err(PromiseError::Failed),
    );
    assert!(!ok_fail);
    assert_eq!(contract.get_near_balance("pilot.testnet".into()), (12 * ONE_NEAR).to_string());
    assert_eq!(contract.get_native_deposit_balance("pilot.testnet".into()), (2 * ONE_NEAR).to_string());

    // Re-claim and confirm callback success commits the withdrawal permanently.
    testing_env!(ctx("pilot.testnet").build());
    let _ = contract.claim_native_near((2 * ONE_NEAR).to_string(), None);
    testing_env!(ctx("staking.terraagent.testnet").build());
    let ok_done = contract.on_claim_native_near(
        "pilot.testnet".into(),
        "pilot.testnet".into(),
        (2 * ONE_NEAR).to_string(),
        Ok(()),
    );
    assert!(ok_done);
    assert_eq!(contract.get_near_balance("pilot.testnet".into()), (10 * ONE_NEAR).to_string());
    assert_eq!(contract.get_native_deposit_balance("pilot.testnet".into()), "0");
}

#[test]
#[should_panic(expected = "NEAR_INSUFFICIENT_GAS")]
fn claim_native_near_rejects_low_prepaid_gas() {
    let mut contract = new_contract();
    let mut dep_ctx = ctx("pilot.testnet");
    dep_ctx.attached_deposit(NearToken::from_near(1));
    testing_env!(dep_ctx.build());
    contract.deposit_near(None);

    let mut low_gas = ctx("pilot.testnet");
    low_gas.prepaid_gas(Gas::from_tgas(20));
    testing_env!(low_gas.build());
    let _ = contract.claim_native_near(ONE_NEAR.to_string(), None);
}

#[test]
#[should_panic(expected = "below storage reserve")]
fn claim_native_near_enforces_storage_reserve() {
    let mut contract = new_contract();
    let mut dep_ctx = ctx("pilot.testnet");
    dep_ctx.attached_deposit(NearToken::from_near(2));
    testing_env!(dep_ctx.build());
    contract.deposit_near(None);

    // Simulate contract balance nearly exhausted down to 0.01 NEAR.
    let mut low_ctx = ctx("pilot.testnet");
    low_ctx.account_balance(NearToken::from_millinear(10));
    testing_env!(low_ctx.build());
    let _ = contract.claim_native_near(ONE_NEAR.to_string(), None);
}

#[test]
fn payer_delegated_stake_and_custom_withdraw_recipient() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-f".into(), "wallet.testnet".into(), (10 * ONE_NEAR).to_string());
    let t0 = 1_700_000_000_000u64;
    let s = contract.stake(
        "op-s".into(),
        "col_0".into(),
        Some("wallet.testnet".into()),
        "p1".into(),
        900,
        (10 * ONE_NEAR).to_string(),
        t0,
    );
    assert_eq!(s.account_id, "col_0");
    assert_eq!(contract.get_near_balance("wallet.testnet".into()), "0");

    let u1 = contract.unstake("op-u".into(), "col_0".into(), "p1".into(), 900, (10 * ONE_NEAR).to_string(), t0 + GAME_DAY_MS);
    // Idempotent replay of unstake:
    let u2 = contract.unstake("op-u".into(), "col_0".into(), "p1".into(), 900, (10 * ONE_NEAR).to_string(), t0 + GAME_DAY_MS);
    assert_eq!(u1, u2);

    let t_ready = t0 + GAME_DAY_MS + UNBONDING_DURATION_MS;
    let w1 = contract.withdraw(
        "op-w".into(),
        "col_0".into(),
        Some("wallet.testnet".into()),
        "p1".into(),
        900,
        t_ready,
    );
    // Idempotent replay of withdraw:
    let w2 = contract.withdraw(
        "op-w".into(),
        "col_0".into(),
        Some("wallet.testnet".into()),
        "p1".into(),
        900,
        t_ready,
    );
    assert_eq!(w1, w2);
    assert_eq!(w1.recipient_id, "wallet.testnet");
    assert!(contract.get_near_balance("wallet.testnet".into()).parse::<u128>().unwrap() > 10 * ONE_NEAR);
}

#[test]
#[should_panic(expected = "STAKE_INSUFFICIENT_BALANCE")]
fn withdraw_before_unbonding_panics() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let ten_near = (10 * ONE_NEAR).to_string();
    contract.credit_near("op-fund".into(), "col1.testnet".into(), ten_near.clone());
    let t0 = 1_700_000_000_000u64;
    contract.stake("op-s".into(), "col1.testnet".into(), None, "p1".into(), 900, ten_near.clone(), t0);
    contract.unstake("op-u".into(), "col1.testnet".into(), "p1".into(), 900, ten_near, t0);
    contract.withdraw("op-w".into(), "col1.testnet".into(), None, "p1".into(), 900, t0 + 1000);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn non_owner_cannot_set_protocol_account() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.set_protocol_account("evil.testnet".parse().unwrap());
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn non_operator_cannot_stake() {
    let mut contract = new_contract();
    testing_env!(ctx("attacker.testnet").build());
    contract.stake("op-bad".into(), "col1.testnet".into(), None, "p1".into(), 900, "100".into(), 1000);
}

#[test]
#[should_panic(expected = "STAKE_INVALID_APY")]
fn rejects_excessive_apy_bp() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-f".into(), "col1.testnet".into(), (10 * ONE_NEAR).to_string());
    contract.stake("op-s".into(), "col1.testnet".into(), None, "p1".into(), 5_001, ONE_NEAR.to_string(), 1000);
}

#[test]
#[should_panic(expected = "STAKE_INVALID_POOL")]
fn rejects_empty_pool_id() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-f".into(), "col1.testnet".into(), (10 * ONE_NEAR).to_string());
    contract.stake("op-s".into(), "col1.testnet".into(), None, "   ".into(), 900, ONE_NEAR.to_string(), 1000);
}

#[test]
#[should_panic(expected = "STAKE_INSUFFICIENT_BALANCE")]
fn rejects_zero_stake_amount() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-f".into(), "col1.testnet".into(), (10 * ONE_NEAR).to_string());
    contract.stake("op-s".into(), "col1.testnet".into(), None, "p1".into(), 900, "0".into(), 1000);
}

#[test]
fn configurable_protocol_yield_bp_splits_custom_and_boundary_0_and_10000_bp() {
    let mut contract = new_contract();
    assert_eq!(contract.get_protocol_yield_bp(), 2_000);

    // Owner updates protocol yield cut to 10% (1000 bp) -> 8.10% staker / 0.90% protocol on 9.00% gross.
    testing_env!(ctx("terraagent.testnet").build());
    contract.set_protocol_yield_bp(1_000);
    assert_eq!(contract.get_protocol_yield_bp(), 1_000);

    testing_env!(ctx("minter.terraagent.testnet").build());
    let ten_near = 10 * ONE_NEAR;
    contract.credit_near("op-fund-a".into(), "col_a.testnet".into(), ten_near.to_string());
    let t0 = 1_700_000_000_000u64;
    contract.stake("op-sa".into(), "col_a.testnet".into(), None, "p1".into(), 900, ten_near.to_string(), t0);
    let ua = contract.unstake("op-ua".into(), "col_a.testnet".into(), "p1".into(), 900, ten_near.to_string(), t0 + 365 * GAME_DAY_MS);
    assert_eq!(ua.rewards.parse::<u128>().unwrap(), 810_000_000_000_000_000_000_000);
    assert_eq!(contract.get_protocol_yield_balance().parse::<u128>().unwrap(), 90_000_000_000_000_000_000_000);

    // Boundary 0 bp -> 100% staker, 0% protocol.
    testing_env!(ctx("terraagent.testnet").build());
    contract.set_protocol_yield_bp(0);
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-fund-b".into(), "col_b.testnet".into(), ten_near.to_string());
    contract.stake("op-sb".into(), "col_b.testnet".into(), None, "p1".into(), 900, ten_near.to_string(), t0);
    let ub = contract.unstake("op-ub".into(), "col_b.testnet".into(), "p1".into(), 900, ten_near.to_string(), t0 + 365 * GAME_DAY_MS);
    assert_eq!(ub.rewards.parse::<u128>().unwrap(), 900_000_000_000_000_000_000_000);
    assert_eq!(contract.get_protocol_yield_balance().parse::<u128>().unwrap(), 90_000_000_000_000_000_000_000);

    // Boundary 10_000 bp -> 0% staker, 100% protocol.
    testing_env!(ctx("terraagent.testnet").build());
    contract.set_protocol_yield_bp(10_000);
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-fund-c".into(), "col_c.testnet".into(), ten_near.to_string());
    contract.stake("op-sc".into(), "col_c.testnet".into(), None, "p1".into(), 900, ten_near.to_string(), t0);
    let uc = contract.unstake("op-uc".into(), "col_c.testnet".into(), "p1".into(), 900, ten_near.to_string(), t0 + 365 * GAME_DAY_MS);
    assert_eq!(uc.rewards.parse::<u128>().unwrap(), 0);
    assert_eq!(contract.get_protocol_yield_balance().parse::<u128>().unwrap(), 990_000_000_000_000_000_000_000);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn non_owner_cannot_set_protocol_yield_bp() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.set_protocol_yield_bp(1_500);
}

#[test]
#[should_panic(expected = "STAKE_INVALID_YIELD_BP")]
fn rejects_protocol_yield_bp_above_10000() {
    let mut contract = new_contract();
    testing_env!(ctx("terraagent.testnet").build());
    contract.set_protocol_yield_bp(10_001);
}

#[test]
fn withdraw_protocol_yield_partial_full_and_idempotent_replay() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());

    let ten_near = 10 * ONE_NEAR;
    contract.credit_near("op-fund".into(), "col1.testnet".into(), ten_near.to_string());
    let t0 = 1_700_000_000_000u64;
    contract.stake("op-s".into(), "col1.testnet".into(), None, "astro.pool".into(), 900, ten_near.to_string(), t0);
    contract.unstake("op-u".into(), "col1.testnet".into(), "astro.pool".into(), 900, ten_near.to_string(), t0 + 365 * GAME_DAY_MS);

    let accrued: u128 = contract.get_protocol_yield_balance().parse().unwrap();
    assert_eq!(accrued, 180_000_000_000_000_000_000_000);

    let partial = 80_000_000_000_000_000_000_000u128;
    let w1 = contract.withdraw_protocol_yield(
        "op-wy-1".into(),
        Some(partial.to_string()),
        Some("relayer.terraagent.testnet".parse().unwrap()),
    );
    let w1_replay = contract.withdraw_protocol_yield(
        "op-wy-1".into(),
        Some(partial.to_string()),
        Some("relayer.terraagent.testnet".parse().unwrap()),
    );
    assert_eq!(w1, w1_replay);
    assert_eq!(w1.withdrawn, partial.to_string());
    assert_eq!(contract.get_near_balance("relayer.terraagent.testnet".into()), partial.to_string());
    assert_eq!(
        contract.get_protocol_yield_balance(),
        (accrued - partial).to_string()
    );

    // Sweep remaining balance (amount: None) to owner_id by default.
    let w2 = contract.withdraw_protocol_yield("op-wy-2".into(), None, None);
    assert_eq!(w2.recipient_id, "terraagent.testnet");
    assert_eq!(w2.withdrawn, (accrued - partial).to_string());
    assert_eq!(contract.get_protocol_yield_balance(), "0");
    assert_eq!(
        contract.get_near_balance("terraagent.testnet".into()),
        (accrued - partial).to_string()
    );
}

#[test]
#[should_panic(expected = "insufficient protocol yield balance")]
fn withdraw_protocol_yield_rejects_excess_amount() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.withdraw_protocol_yield("op-wy-empty".into(), None, None);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn withdraw_protocol_yield_rejects_unauthorized_caller() {
    let mut contract = new_contract();
    testing_env!(ctx("attacker.testnet").build());
    contract.withdraw_protocol_yield("op-wy-bad".into(), Some("1".into()), None);
}

#[test]
#[should_panic(expected = "attached NEAR deposit must be > 0")]
fn deposit_near_rejects_zero_attached_deposit() {
    let mut contract = new_contract();
    testing_env!(ctx("pilot.testnet").build());
    contract.deposit_near(None);
}

#[test]
fn deposit_near_on_behalf_of_target_credits_target_native_ledger() {
    let mut contract = new_contract();
    let mut dep_ctx = ctx("sponsor.testnet");
    dep_ctx.attached_deposit(NearToken::from_near(3));
    testing_env!(dep_ctx.build());
    let bal = contract.deposit_near(Some("col_0.pilots.terraagent.testnet".parse().unwrap()));
    assert_eq!(bal, (3 * ONE_NEAR).to_string());
    assert_eq!(
        contract.get_native_deposit_balance("col_0.pilots.terraagent.testnet".into()),
        (3 * ONE_NEAR).to_string()
    );
    assert_eq!(contract.get_native_deposit_balance("sponsor.testnet".into()), "0");
}

#[test]
#[should_panic(expected = "insufficient staked NEAR")]
fn unstake_exceeding_staked_balance_panics() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    contract.credit_near("op-f".into(), "col1.testnet".into(), (5 * ONE_NEAR).to_string());
    contract.stake("op-s".into(), "col1.testnet".into(), None, "p1".into(), 900, (5 * ONE_NEAR).to_string(), 1000);
    contract.unstake("op-u".into(), "col1.testnet".into(), "p1".into(), 900, (6 * ONE_NEAR).to_string(), 2000);
}
