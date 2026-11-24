//! W28: LST single-step withdraw, share-price (Option A) solvency, `deposit_and_stake_lst` referral
//! forwarding and the pool <-> LST binding.
use crate::lst_math::{realize, weighted_entry, PRICE_ONE};
use super::tests::{ctx, new_contract, ONE_NEAR};
use super::*;
use near_sdk::json_types::U128;
use near_sdk::test_utils::get_created_receipts as raw_receipts;
use near_sdk::{testing_env, NearToken, PromiseError, PromiseResult};

const OP: &str = "minter.terraagent.testnet";
const SELF_ID: &str = "staking.terraagent.testnet";
const LST: &str = "meta-pool.near";
const T0: u64 = 1_700_000_000_000;
const WEEK: u64 = 604_800_000;

/// Debug dump of the scheduled receipts with every byte array (method names, JSON args) decoded to text.
fn receipts_text() -> String {
    let dump = format!("{:?}", raw_receipts());
    let (mut out, mut rest) = (String::new(), dump.as_str());
    while let Some(i) = rest.find('[') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        let end = tail.find(']').unwrap_or(0);
        let bytes: Option<Vec<u8>> = tail[..end].split(',').map(|n| n.trim().parse::<u8>().ok()).collect();
        match bytes {
            Some(b) if !b.is_empty() => out.push_str(&String::from_utf8_lossy(&b)),
            _ => out.push('['),
        }
        rest = if end > 0 && tail[..end].split(',').all(|n| n.trim().parse::<u8>().is_ok()) { &tail[end + 1..] } else { tail };
    }
    out.push_str(rest);
    out
}

fn at(who: &str, ms: u64) -> near_sdk::test_utils::VMContextBuilder {
    let mut b = ctx(who);
    b.block_timestamp(ms * 1_000_000);
    b
}

fn set_price_at(c: &mut StakingVaultContract, price: u128, ms: u64) {
    testing_env!(at(SELF_ID, ms).build());
    assert!(c.on_lst_price(LST.into(), Ok(U128(price))));
}

fn set_price(c: &mut StakingVaultContract, price: u128) {
    set_price_at(c, price, T0);
}

/// Pool bound to `LST` with a known price, ready for price-mode deposits.
fn priced_pool(price: u128) -> StakingVaultContract {
    let mut c = new_contract();
    testing_env!(ctx(OP).build());
    c.bind_lst_pool(LST.into(), LST.parse().unwrap());
    set_price(&mut c, price);
    c
}

fn deposit(c: &mut StakingVaultContract, who: &str, shares: u128, ms: u64) {
    let cur_price: u128 = c.get_lst_price(LST.into()).parse().unwrap_or(0);
    if cur_price > 0 {
        set_price_at(c, cur_price, ms);
    }
    testing_env!(at(LST, ms).build());
    c.ft_on_transfer(who.parse().unwrap(), shares.to_string(), format!(r#"{{"pool_id":"{LST}","apy_bp":0}}"#));
}

fn unstake(c: &mut StakingVaultContract, who: &str, op: &str, shares: u128, ms: u64) -> StakingPositionView {
    testing_env!(at(OP, ms).build());
    c.unstake(op.into(), who.into(), LST.into(), 0, shares.to_string(), ms)
}

/// Sum of every liability in shares for the given wallets (positions + protocol cut).
fn liabilities(c: &StakingVaultContract, who: &[&str], ms: u64) -> u128 {
    who.iter()
        .map(|w| {
            let p = c.get_position((*w).into(), LST.into(), 0, ms);
            [p.staked, p.unbonding, p.withdrawable, p.rewards].iter().map(|v| v.parse::<u128>().unwrap()).sum::<u128>()
        })
        .sum::<u128>()
        + c.get_protocol_lst_balance(LST.into()).parse::<u128>().unwrap()
}

#[test]
fn realize_conserves_shares_and_splits_80_20() {
    let r = realize(100 * ONE_NEAR, PRICE_ONE, PRICE_ONE * 11 / 10, 2_000);
    assert_eq!(r.staked + r.staker + r.protocol, 100 * ONE_NEAR);
    assert_eq!(r.entry, PRICE_ONE * 11 / 10);
    assert!(r.staker > 3 * r.protocol && r.staker < 5 * r.protocol);
    // Principal keeps its entry-price value (rounded in the protocol's favour, never below).
    assert!(crate::mathx::mul_div_floor(r.staked, r.entry, PRICE_ONE).unwrap() >= 100 * ONE_NEAR - 1);
}

#[test]
fn realize_books_nothing_when_price_flat_or_lower_and_keeps_high_water_entry() {
    for price in [PRICE_ONE, PRICE_ONE / 2, 1] {
        let r = realize(5 * ONE_NEAR, PRICE_ONE, price, 2_000);
        assert_eq!((r.staked, r.staker, r.protocol, r.entry), (5 * ONE_NEAR, 0, 0, PRICE_ONE));
    }
    assert_eq!(realize(0, PRICE_ONE, PRICE_ONE * 2, 2_000).staked, 0);
    assert_eq!(realize(ONE_NEAR, 0, PRICE_ONE * 2, 2_000).staker, 0, "simulated-APY positions never realise");
}

#[test]
fn weighted_entry_blends_deposits_and_keeps_sim_positions_sim() {
    assert_eq!(weighted_entry(0, 0, 10, PRICE_ONE), PRICE_ONE);
    assert_eq!(weighted_entry(PRICE_ONE, 10, 10, 3 * PRICE_ONE), 2 * PRICE_ONE);
    assert_eq!(weighted_entry(0, 10, 10, PRICE_ONE), 0, "legacy simulated position stays simulated");
    assert_eq!(weighted_entry(PRICE_ONE, 10, 10, 0), PRICE_ONE, "unknown price leaves the entry alone");
}

#[test]
fn share_price_rise_pays_80_20_and_total_liabilities_equal_assets() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 100 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 12 / 10); // +20 % share appreciation
    let t = T0 + 2 * WEEK;
    unstake(&mut c, "alice.testnet", "u1", 1, t);
    let held = 100 * ONE_NEAR;
    assert_eq!(liabilities(&c, &["alice.testnet"], t), held, "liabilities never exceed (or fall below) the shares held");
    let p = c.get_position("alice.testnet".into(), LST.into(), 0, t);
    let staker: u128 = p.rewards.parse().unwrap();
    let protocol: u128 = c.get_protocol_lst_balance(LST.into()).parse().unwrap();
    assert!(staker > 0 && protocol > 0);
    assert!((staker * 2_000).abs_diff(protocol * 8_000) < 10_000, "80/20 split");
    // Value of everything paid out at the current price never exceeds what the deposit is worth now.
    let value = |shares: u128| crate::mathx::mul_div_floor(shares, PRICE_ONE * 12 / 10, PRICE_ONE).unwrap();
    assert!(value(held) >= value(staker + protocol) + 100 * ONE_NEAR - 1, "payouts never exceed asset value");
}

#[test]
fn price_drop_books_no_yield_and_solvency_holds() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 50 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 7 / 10); // network yield collapses / slash
    let t = T0 + 2 * WEEK;
    let u = unstake(&mut c, "alice.testnet", "u1", 10 * ONE_NEAR, t);
    assert_eq!(u.rewards, "0");
    assert_eq!(c.get_protocol_lst_balance(LST.into()), "0");
    assert_eq!(liabilities(&c, &["alice.testnet"], t), 50 * ONE_NEAR);
}

#[test]
fn entry_price_is_a_high_water_mark_across_rise_drop_rise() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 100 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 2);
    unstake(&mut c, "alice.testnet", "u1", 1, T0 + 2 * WEEK);
    let after_rise = c.get_protocol_lst_balance(LST.into());
    set_price(&mut c, PRICE_ONE * 3 / 2);
    unstake(&mut c, "alice.testnet", "u2", 1, T0 + 3 * WEEK);
    assert_eq!(c.get_protocol_lst_balance(LST.into()), after_rise, "recovering to the old peak pays nothing twice");
    set_price(&mut c, PRICE_ONE * 3);
    unstake(&mut c, "alice.testnet", "u3", 1, T0 + 4 * WEEK);
    assert!(c.get_protocol_lst_balance(LST.into()).parse::<u128>().unwrap() > after_rise.parse::<u128>().unwrap());
    assert_eq!(liabilities(&c, &["alice.testnet"], T0 + 4 * WEEK), 100 * ONE_NEAR);
}

#[test]
fn two_depositors_at_different_prices_stay_solvent() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 60 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 11 / 10);
    deposit(&mut c, "bob.testnet", 40 * ONE_NEAR, T0 + GAME_DAY_MS);
    set_price(&mut c, PRICE_ONE * 13 / 10);
    let t = T0 + 2 * WEEK;
    unstake(&mut c, "alice.testnet", "ua", 1, t);
    unstake(&mut c, "bob.testnet", "ub", 1, t);
    assert_eq!(liabilities(&c, &["alice.testnet", "bob.testnet"], t), 100 * ONE_NEAR);
    let alice: u128 = c.get_position("alice.testnet".into(), LST.into(), 0, t).rewards.parse().unwrap();
    let bob: u128 = c.get_position("bob.testnet".into(), LST.into(), 0, t).rewards.parse().unwrap();
    assert!(alice * 40 > bob * 60, "the earlier, larger deposit earned more share appreciation");
}

#[test]
fn price_mode_compound_rolls_realised_shares_into_principal() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 100 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 12 / 10);
    testing_env!(at(OP, T0 + 2 * WEEK).build());
    let r = c.compound_yield(LST.into(), Some("alice.testnet".into()), None, Some(T0 + 2 * WEEK), None);
    assert!(r.compounded.parse::<u128>().unwrap() > 0);
    assert_eq!(r.position.rewards, "0");
    assert_eq!(liabilities(&c, &["alice.testnet"], T0 + 2 * WEEK), 100 * ONE_NEAR);
}

#[test]
fn simulated_apy_lst_pool_keeps_working_without_a_price() {
    let mut c = new_contract();
    testing_env!(at(LST, T0).build());
    c.ft_on_transfer("bob.testnet".parse().unwrap(), (3 * ONE_NEAR).to_string(), format!(r#"{{"pool_id":"{LST}"}}"#));
    let p = c.get_position("bob.testnet".into(), LST.into(), 900, T0 + 30 * GAME_DAY_MS);
    assert!(p.rewards.parse::<u128>().unwrap() > 0, "mock/testnet simulated APY still accrues");
    assert_eq!(c.get_lst_price(LST.into()), "0");
}

#[test]
fn on_lst_price_ignores_failed_or_zero_prices() {
    let mut c = priced_pool(PRICE_ONE);
    testing_env!(at(SELF_ID, T0).build());
    assert!(!c.on_lst_price(LST.into(), Err(PromiseError::Failed)));
    assert!(!c.on_lst_price(LST.into(), Ok(U128(0))));
    assert_eq!(c.get_lst_price(LST.into()), PRICE_ONE.to_string());
}

#[test]
#[should_panic(expected = "pool is bound to another LST")]
fn pool_binding_blocks_cross_token_deposits() {
    let mut c = priced_pool(PRICE_ONE);
    testing_env!(at("linear-protocol.near", T0).build());
    c.ft_on_transfer("eve.testnet".parse().unwrap(), ONE_NEAR.to_string(), format!(r#"{{"pool_id":"{LST}","apy_bp":0}}"#));
}

fn matured_lst_position() -> (StakingVaultContract, u64) {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 10 * ONE_NEAR, T0);
    let t = T0 + WEEK;
    unstake(&mut c, "alice.testnet", "u", 10 * ONE_NEAR, t);
    (c, t + UNBONDING_DURATION_MS)
}

#[test]
fn withdraw_lst_sends_ft_transfer_in_one_step_and_rolls_back_on_failure() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(at("alice.testnet", ready).attached_deposit(NearToken::from_yoctonear(1)).build());
    let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), (4 * ONE_NEAR).to_string(), None, Some("wallet.near".into()), None);
    let receipts = receipts_text();
    assert!(receipts.contains("ft_transfer") && receipts.contains("wallet.near"), "{receipts}");
    assert_eq!(c.get_position("alice.testnet".into(), LST.into(), 0, ready).withdrawable, (6 * ONE_NEAR).to_string());

    testing_env!(at(SELF_ID, ready).build());
    assert!(!c.on_withdraw_lst("alice.testnet".into(), LST.into(), "wallet.near".into(), (4 * ONE_NEAR).to_string(), "0".into(), None, Err(PromiseError::Failed)));
    assert_eq!(c.get_position("alice.testnet".into(), LST.into(), 0, ready).withdrawable, (10 * ONE_NEAR).to_string());
    assert!(c.on_withdraw_lst("alice.testnet".into(), LST.into(), "wallet.near".into(), ONE_NEAR.to_string(), "0".into(), None, Ok(())));
    assert_eq!(c.get_position("alice.testnet".into(), LST.into(), 0, ready).withdrawable, (10 * ONE_NEAR).to_string());
}

#[test]
fn withdraw_lst_pays_realised_yield_after_principal_in_price_mode() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 10 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 2);
    unstake(&mut c, "alice.testnet", "u", 5 * ONE_NEAR, T0 + WEEK);
    let ready = T0 + WEEK + UNBONDING_DURATION_MS;
    let p = c.get_position("alice.testnet".into(), LST.into(), 0, ready);
    let (w, r): (u128, u128) = (p.withdrawable.parse().unwrap(), p.rewards.parse().unwrap());
    assert!(r > 0);
    testing_env!(at("alice.testnet", ready).build());
    let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), (w + r).to_string(), None, None, None);
    let p = c.get_position("alice.testnet".into(), LST.into(), 0, ready);
    assert_eq!((p.withdrawable.as_str(), p.rewards.as_str()), ("0", "0"));
}

#[test]
#[should_panic(expected = "no withdrawable LST")]
fn withdraw_lst_rejects_more_than_is_unbonded() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(at("alice.testnet", ready).build());
    let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), (10 * ONE_NEAR + 1).to_string(), None, None, None);
}

#[test]
#[should_panic(expected = "no withdrawable LST")]
fn withdraw_lst_with_nothing_unbonded_panics() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", ONE_NEAR, T0);
    testing_env!(at("alice.testnet", T0 + 1).build());
    let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), "1".into(), None, None, None);
}

#[test]
#[should_panic(expected = "amount must be > 0")]
fn withdraw_lst_rejects_zero_amount() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(at("alice.testnet", ready).build());
    let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), "0".into(), None, None, None);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn withdraw_lst_cannot_pull_another_wallets_position() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(at("mallory.testnet", ready).build());
    let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), ONE_NEAR.to_string(), Some("alice.testnet".into()), Some("mallory.testnet".into()), None);
}

#[test]
#[should_panic(expected = "not bound to this LST")]
fn withdraw_lst_rejects_a_different_token_than_the_one_deposited() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(at("alice.testnet", ready).build());
    let _ = c.withdraw_lst(LST.into(), "linear-protocol.near".parse().unwrap(), ONE_NEAR.to_string(), None, None, None);
}

#[test]
#[should_panic(expected = "LST pools pay out through withdraw_lst")]
fn native_withdraw_refuses_lst_pools() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(ctx(OP).build());
    let _ = c.withdraw("w".into(), "alice.testnet".into(), None, LST.into(), 0, ready);
}

#[test]
fn operator_may_pay_out_a_wallet_lst_position() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(at(OP, ready).build());
    let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), ONE_NEAR.to_string(), Some("alice.testnet".into()), None, None);
    assert_eq!(c.get_position("alice.testnet".into(), LST.into(), 0, ready).withdrawable, (9 * ONE_NEAR).to_string());
}

#[test]
fn protocol_lst_cut_is_withdrawable_with_rollback() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 100 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 2);
    unstake(&mut c, "alice.testnet", "u", 1, T0 + WEEK);
    let cut: u128 = c.get_protocol_lst_balance(LST.into()).parse().unwrap();
    assert!(cut > 0);
    testing_env!(ctx(OP).build());
    let _ = c.withdraw_protocol_lst(LST.into(), LST.parse().unwrap(), None, Some("treasury.near".parse().unwrap()));
    assert_eq!(c.get_protocol_lst_balance(LST.into()), "0");
    testing_env!(at(SELF_ID, T0).build());
    assert!(!c.on_withdraw_protocol_lst(LST.into(), "treasury.near".into(), cut.to_string(), Err(PromiseError::Failed)));
    assert_eq!(c.get_protocol_lst_balance(LST.into()), cut.to_string());
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn protocol_lst_withdraw_is_operator_only() {
    let mut c = priced_pool(PRICE_ONE);
    testing_env!(ctx("mallory.testnet").build());
    let _ = c.withdraw_protocol_lst(LST.into(), LST.parse().unwrap(), None, None);
}

#[test]
fn deposit_and_stake_forwards_the_referral_and_books_shares_on_success() {
    let mut c = priced_pool(PRICE_ONE * 5 / 4);
    testing_env!(at("alice.testnet", T0).attached_deposit(NearToken::from_near(5)).build());
    let _ = c.deposit_and_stake_lst(LST.into(), LST.parse().unwrap(), Some("terra.near".parse().unwrap()), None);
    let receipts = receipts_text();
    assert!(receipts.contains("deposit_and_stake") && receipts.contains("referral_id") && receipts.contains("terra.near"), "{receipts}");

    testing_env!(
        at(SELF_ID, T0).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    assert!(c.on_lst_deposit(
        "alice.testnet".parse().unwrap(), "alice.testnet".into(), LST.into(), LST.into(),
        (5 * ONE_NEAR).to_string(), (PRICE_ONE * 5 / 4).to_string(), T0,
    ));
    let p = c.get_account_positions("alice.testnet".into(), None, Some(T0));
    assert_eq!(p[0].staked, (4 * ONE_NEAR).to_string(), "5 NEAR at 1.25 NEAR/share");
    assert_eq!((p[0].asset.as_str(), p[0].entry_lst_price_yocto.as_deref()), (LST, Some((PRICE_ONE * 5 / 4).to_string().as_str())));
    assert_eq!(c.get_lst_binding(LST.into()).as_deref(), Some(LST));
}

#[test]
fn failed_deposit_and_stake_refunds_and_books_nothing() {
    let mut c = priced_pool(PRICE_ONE);
    testing_env!(
        at(SELF_ID, T0).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!c.on_lst_deposit(
        "alice.testnet".parse().unwrap(), "alice.testnet".into(), LST.into(), LST.into(),
        (5 * ONE_NEAR).to_string(), PRICE_ONE.to_string(), T0,
    ));
    assert!(receipts_text().contains("alice.testnet"), "refund transfer scheduled");
    assert!(c.get_account_positions("alice.testnet".into(), None, None).is_empty());
}

#[test]
#[should_panic(expected = "STAKE_PRICE_UNKNOWN")]
fn deposit_and_stake_needs_a_known_price() {
    let mut c = new_contract();
    testing_env!(ctx(OP).build());
    c.bind_lst_pool(LST.into(), LST.parse().unwrap());
    testing_env!(at("alice.testnet", T0).attached_deposit(NearToken::from_near(1)).build());
    let _ = c.deposit_and_stake_lst(LST.into(), LST.parse().unwrap(), None, None);
}

#[test]
#[should_panic(expected = "not whitelisted")]
fn deposit_and_stake_rejects_non_whitelisted_contracts() {
    let mut c = priced_pool(PRICE_ONE);
    testing_env!(at("alice.testnet", T0).attached_deposit(NearToken::from_near(1)).build());
    let _ = c.deposit_and_stake_lst(LST.into(), "evil.near".parse().unwrap(), None, None);
}

#[test]
#[should_panic(expected = "pool is not bound")]
fn refresh_price_requires_a_bound_pool() {
    let mut c = new_contract();
    testing_env!(ctx("anyone.testnet").build());
    let _ = c.refresh_lst_price("fresh-pool".into(), LST.parse().unwrap());
}

#[test]
fn refresh_price_schedules_the_lst_price_call_for_a_bound_pool() {
    let mut c = priced_pool(PRICE_ONE);
    testing_env!(ctx("anyone.testnet").build());
    let _ = c.refresh_lst_price(LST.into(), LST.parse().unwrap());
    assert!(receipts_text().contains("get_st_near_price"));
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn only_the_operator_can_bind_pools() {
    let mut c = new_contract();
    testing_env!(ctx("mallory.testnet").build());
    c.bind_lst_pool(LST.into(), LST.parse().unwrap());
}

/// Tiny deterministic generator so the randomized solvency paths replay exactly (no extra dev-dependency).
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
}

/// W28-15: after ANY sequence of deposits, share-price moves (crashes and rallies), compounds and exits, the sum of
/// every liability (staked + unbonding + withdrawable + rewards + protocol cut) equals the shares the vault
/// actually holds, so it can never owe more than it has. One seeded random path of 40 steps over 3 wallets per
/// test (the mocked storage is per test thread, so each seed gets a fresh vault).
fn solvency_path(seed: u64) {
    let wallets = ["alice.testnet", "bob.testnet", "carol.testnet"];
    {
        let mut rng = Lcg(seed.wrapping_mul(0x9E37_79B9) + 1);
        let mut c = priced_pool(PRICE_ONE);
        let (mut held, mut ms) = (0u128, T0);
        for _step in 0..40 {
            ms += rng.below(3 * GAME_DAY_MS) + 1;
            let who = wallets[rng.below(3) as usize];
            match rng.below(5) {
                0 | 1 => {
                    let shares = (rng.below(500) as u128 + 1) * ONE_NEAR / 10;
                    deposit(&mut c, who, shares, ms);
                    held += shares;
                }
                2 => {
                    // Price path: crash to 0.2x, flat, or rally up to 4x (prices stay positive).
                    let bp = 2_000 + rng.below(38_000) as u128;
                    set_price(&mut c, PRICE_ONE * bp / 10_000);
                }
                3 => {
                    // Compounding needs an existing price-mode position with realised yield (a wallet that never deposited, or has no yield yet, is rejected).
                    let accrued = c.get_position(who.into(), LST.into(), 0, ms).rewards.parse::<u128>().unwrap() > 0;
                    if accrued {
                        testing_env!(at(OP, ms).build());
                        c.compound_yield(LST.into(), Some(who.into()), None, Some(ms), None);
                    }
                }
                _ => {
                    let p = c.get_position(who.into(), LST.into(), 0, ms);
                    let staked: u128 = p.staked.parse().unwrap();
                    if staked > 1 {
                        let part = 1 + rng.below(staked.min(u64::MAX as u128) as u64) as u128 % staked;
                        unstake(&mut c, who, &format!("u{seed}-{_step}"), part, ms);
                    }
                }
            }
            // Views price pending appreciation but only a mutating call books the protocol cut: settle every wallet
            // with a 1-yocto unstake (fee rounds to 0) so the books are final before they are summed.
            for w in wallets {
                if c.get_position(w.into(), LST.into(), 0, ms).staked.parse::<u128>().unwrap() > 1 {
                    unstake(&mut c, w, &format!("s{seed}-{_step}-{w}"), 1, ms);
                }
            }
            let owed = liabilities(&c, &wallets, ms);
            assert!(owed <= held, "seed {seed}: liabilities {owed} exceed assets {held}");
            assert_eq!(owed, held, "seed {seed}: shares must be conserved (nothing created or lost)");
        }
    }
}

macro_rules! solvency_seeds {
    ($($name:ident => $seed:expr),* $(,)?) => { $(#[test] fn $name() { solvency_path($seed); })* };
}
solvency_seeds!(
    solvency_path_seed_0 => 0, solvency_path_seed_1 => 1, solvency_path_seed_2 => 2, solvency_path_seed_3 => 3,
    solvency_path_seed_4 => 4, solvency_path_seed_5 => 5, solvency_path_seed_6 => 6, solvency_path_seed_7 => 7,
    solvency_path_seed_8 => 8, solvency_path_seed_9 => 9, solvency_path_seed_10 => 10, solvency_path_seed_11 => 11,
);

#[test]
fn flat_price_weighted_entry_does_not_creep_by_one_yocto() {
    assert_eq!(weighted_entry(PRICE_ONE, 10, 7, PRICE_ONE), PRICE_ONE);
    assert_eq!(weighted_entry(PRICE_ONE + 7, 13, 19, PRICE_ONE + 7), PRICE_ONE + 7);
}

#[test]
fn sim_to_price_mode_transition_cannot_unlock_unbacked_rewards() {
    let mut c = new_contract();
    // 1. User deposits in simulated APY mode (price == 0) and accrues unbacked simulated rewards.
    testing_env!(at(LST, T0).build());
    c.ft_on_transfer("mallory.testnet".parse().unwrap(), (10 * ONE_NEAR).to_string(), format!(r#"{{"pool_id":"{LST}"}}"#));
    let t1 = T0 + 30 * GAME_DAY_MS;
    testing_env!(at(OP, t1).build());
    c.unstake("u-all".into(), "mallory.testnet".into(), LST.into(), 900, (10 * ONE_NEAR).to_string(), t1);
    let sim_rewards: u128 = c.get_position("mallory.testnet".into(), LST.into(), 900, t1).rewards.parse().unwrap();
    assert!(sim_rewards > 0);

    // 2. Price later becomes available, and mallory tops up 0.01 shares to try flipping into price mode.
    set_price_at(&mut c, PRICE_ONE, t1 + 1_000);
    testing_env!(at(LST, t1 + 1_000).build());
    c.ft_on_transfer("mallory.testnet".parse().unwrap(), (ONE_NEAR / 100).to_string(), format!(r#"{{"pool_id":"{LST}","apy_bp":0}}"#));

    // Entry price MUST remain None (0), keeping unbacked simulated rewards locked out of withdraw_lst & compound_yield!
    let pos = c.get_account_positions("mallory.testnet".into(), None, Some(t1 + 1_000));
    assert_eq!(pos[0].entry_lst_price_yocto, None);
    let ready = t1 + UNBONDING_DURATION_MS;
    testing_env!(at("mallory.testnet", ready).prepaid_gas(near_sdk::Gas::from_tgas(45)).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.withdraw_lst(LST.into(), LST.parse().unwrap(), sim_rewards.to_string(), None, None, None);
    })).is_err());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.compound_yield(LST.into(), None, None, None, None);
    })).is_err());
}

#[test]
fn refresh_price_uses_ft_price_for_linear_and_rnear() {
    let mut c = new_contract();
    testing_env!(ctx(OP).build());
    c.bind_lst_pool("linear-protocol.near".into(), "linear-protocol.near".parse().unwrap());
    testing_env!(ctx("anyone.testnet").build());
    let _ = c.refresh_lst_price("linear-protocol.near".into(), "linear-protocol.near".parse().unwrap());
    assert!(receipts_text().contains("ft_price"));
}

#[test]
#[should_panic(expected = "NEAR_INSUFFICIENT_GAS")]
fn withdraw_protocol_lst_requires_40_tgas() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 100 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 12 / 10);
    unstake(&mut c, "alice.testnet", "u1", 1, T0 + 2 * WEEK);
    testing_env!(at(OP, T0 + 2 * WEEK).prepaid_gas(near_sdk::Gas::from_tgas(30)).build());
    let _ = c.withdraw_protocol_lst(LST.into(), LST.parse().unwrap(), None, None);
}

#[test]
fn withdraw_protocol_lst_supports_partial_and_ok_callback() {
    let mut c = priced_pool(PRICE_ONE);
    deposit(&mut c, "alice.testnet", 100 * ONE_NEAR, T0);
    set_price(&mut c, PRICE_ONE * 12 / 10);
    unstake(&mut c, "alice.testnet", "u1", 1, T0 + 2 * WEEK);
    let avail: u128 = c.get_protocol_lst_balance(LST.into()).parse().unwrap();
    assert!(avail > 2);

    testing_env!(at(OP, T0 + 2 * WEEK).prepaid_gas(near_sdk::Gas::from_tgas(80)).build());
    let part = avail / 2;
    let _ = c.withdraw_protocol_lst(LST.into(), LST.parse().unwrap(), Some(part.to_string()), None);
    assert_eq!(c.get_protocol_lst_balance(LST.into()), (avail - part).to_string());
    testing_env!(at(SELF_ID, T0 + 2 * WEEK).build());
    assert!(c.on_withdraw_protocol_lst(LST.into(), "terraagent.testnet".into(), part.to_string(), Ok(())));
    assert_eq!(c.get_protocol_lst_balance(LST.into()), (avail - part).to_string());
}

#[test]
fn register_position_binds_lst_pool() {
    let mut c = new_contract();
    c.positions.insert(
        pos_key("old-lst.testnet", "meta-pool.near"),
        StakingRecord { staked: 5 * ONE_NEAR, last_accrued_at_ms: T0, ..Default::default() },
    );
    testing_env!(ctx(OP).build());
    c.register_position("old-lst.testnet".into(), "meta-pool.near".into(), Some("meta-pool.near".into()), Some(T0));
    let listed = c.get_account_positions("old-lst.testnet".into(), None, None);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].asset, "meta-pool.near");
    assert_eq!(c.get_lst_binding("meta-pool.near".into()).as_deref(), Some("meta-pool.near"));
}

#[test]
fn withdraw_lst_with_op_id_is_idempotent_after_success_and_retryable_after_rollback() {
    let (mut c, ready) = matured_lst_position();
    testing_env!(at("alice.testnet", ready).build());
    assert!(matches!(
        c.withdraw_lst(LST.into(), LST.parse().unwrap(), (4 * ONE_NEAR).to_string(), None, None, Some("wlst-1".into())),
        near_sdk::PromiseOrValue::Promise(_)
    ));
    testing_env!(at(SELF_ID, ready).build());
    assert!(!c.on_withdraw_lst("alice.testnet".into(), LST.into(), "alice.testnet".into(), (4 * ONE_NEAR).to_string(), "0".into(), Some("wlst-1".into()), Err(PromiseError::Failed)));
    assert_eq!(c.get_position("alice.testnet".into(), LST.into(), 0, ready).withdrawable, (10 * ONE_NEAR).to_string());

    testing_env!(at("alice.testnet", ready).build());
    assert!(matches!(
        c.withdraw_lst(LST.into(), LST.parse().unwrap(), (4 * ONE_NEAR).to_string(), None, None, Some("wlst-1".into())),
        near_sdk::PromiseOrValue::Promise(_)
    ));
    testing_env!(at(SELF_ID, ready).build());
    assert!(c.on_withdraw_lst("alice.testnet".into(), LST.into(), "alice.testnet".into(), (4 * ONE_NEAR).to_string(), "0".into(), Some("wlst-1".into()), Ok(())));

    testing_env!(at("alice.testnet", ready).build());
    assert!(matches!(
        c.withdraw_lst(LST.into(), LST.parse().unwrap(), (4 * ONE_NEAR).to_string(), None, None, Some("wlst-1".into())),
        near_sdk::PromiseOrValue::Value(true)
    ));
    assert_eq!(c.get_position("alice.testnet".into(), LST.into(), 0, ready).withdrawable, (6 * ONE_NEAR).to_string());
}
