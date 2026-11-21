//! Liquid-staking (stNEAR / LiNEAR / rNEAR) support and mainnet "Option A" share-price accounting.
//!
//! * A pool is *bound* to one LST contract (`lstc:<pool>`), first writer wins, so a position deposited
//!   through a cheap token can never be withdrawn as a more valuable one.
//! * `lstprice:<pool>` caches the LST price (yocto-NEAR per 1e24 share units) fetched by
//!   `refresh_lst_price` straight from the LST contract. A position whose pool has a price **and** an
//!   entry price (`PositionMeta.entry_lst_price_yocto`) is in *price mode*: yield is the realised share
//!   appreciation, `shares * (price - entry) / price` shares, split 80/20 (staker `rewards` / protocol
//!   `plst:<pool>`). Those shares are carved out of the same share pool, so total liabilities (staked +
//!   unbonding + withdrawable + rewards + protocol) always equal the shares actually held: solvent by
//!   construction, also when the price falls (no yield is booked, the entry price is a high-water mark).
//! * Pools without a price (mock / testnet) keep the simulated-APY behaviour; their LST rewards are never
//!   paid out in tokens (they are unbacked), only `withdrawable` principal is.
use crate::StakingVaultContractExt;
pub use crate::lst_math::{realize, PRICE_ONE};
pub(crate) use crate::lst_math::is_whitelisted_lst;
use crate::mathx::mul_div_floor;
use crate::positions::record_deposit;
use crate::storage::{
    parse_yocto, pos_key, read_u128_key, read_u64_key, validate_pool_and_apy, validate_target_account,
    write_u128_key, write_u64_key,
};
use crate::{emit_staking, StakingVaultContract, MAX_NON_OPERATOR_APY_BP};
use near_sdk::json_types::U128;
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, Promise, PromiseError,
};
use serde_json::json;

const PRICE_CALL_GAS: Gas = Gas::from_tgas(10);
const DEPOSIT_STAKE_GAS: Gas = Gas::from_tgas(50);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
const MIN_WITHDRAW_LST_TGAS: u64 = 40;
const MIN_DEPOSIT_STAKE_LST_TGAS: u64 = 85;
/// Maximum age of a cached LST price accepted by `deposit_and_stake_lst` when block timestamps are active (1 hour).
pub const MAX_LST_PRICE_AGE_MS: u64 = 3_600_000;

fn bind_key(pool_id: &str) -> Vec<u8> {
    format!("lstc:{}", pool_id).into_bytes()
}
fn price_key(pool_id: &str) -> Vec<u8> {
    format!("lstprice:{}", pool_id).into_bytes()
}
fn price_ts_key(pool_id: &str) -> Vec<u8> {
    format!("lstpricets:{}", pool_id).into_bytes()
}
fn protocol_key(pool_id: &str) -> Vec<u8> {
    format!("plst:{}", pool_id).into_bytes()
}

fn read_price_ts(pool_id: &str) -> u64 {
    read_u64_key(&price_ts_key(pool_id))
}
fn write_price_ts(pool_id: &str, ts_ms: u64) {
    write_u64_key(&price_ts_key(pool_id), ts_ms);
}
fn fetch_lst_price_promise(lst_contract: AccountId) -> Promise {
    let lower = lst_contract.as_str().to_ascii_lowercase();
    let call = ext_lst_token::ext(lst_contract).with_static_gas(PRICE_CALL_GAS);
    if lower.contains("meta") || lower.contains("stnear") {
        call.get_st_near_price()
    } else {
        call.ft_price()
    }
}

pub(crate) fn bound_lst(pool_id: &str) -> Option<String> {
    env::storage_read(&bind_key(pool_id)).and_then(|b| String::from_utf8(b).ok())
}
pub(crate) fn is_lst_pool(pool_id: &str) -> bool {
    bound_lst(pool_id).is_some()
}
pub(crate) fn bind_pool(pool_id: &str, lst_contract: &str) {
    require!(
        !crate::storage::is_native_pool(pool_id),
        "STAKE_INVALID_POOL: pool is bound to native NEAR staking"
    );
    match bound_lst(pool_id) {
        Some(existing) => require!(
            existing == lst_contract,
            "STAKE_INVALID_POOL: pool is bound to another LST contract"
        ),
        None => {
            env::storage_write(&bind_key(pool_id), lst_contract.as_bytes());
        }
    }
}
pub(crate) fn read_price(pool_id: &str) -> u128 {
    read_u128_key(&price_key(pool_id))
}
pub(crate) fn read_protocol_shares(pool_id: &str) -> u128 {
    read_u128_key(&protocol_key(pool_id))
}
pub(crate) fn write_protocol_shares(pool_id: &str, v: u128) {
    write_u128_key(&protocol_key(pool_id), v);
}

#[allow(dead_code)]
#[ext_contract(ext_lst_token)]
trait ExtLstToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_price(&self) -> U128;
    fn get_st_near_price(&self) -> U128;
}

#[allow(dead_code)]
#[ext_contract(ext_lst_self)]
trait ExtLstSelf {
    fn on_lst_price(&mut self, pool_id: String) -> bool;
    #[allow(clippy::too_many_arguments)]
    fn on_lst_deposit(&mut self, depositor: AccountId, target: String, pool_id: String, lst_contract: String, attached: String, price: String, now_ms: u64) -> bool;
    fn on_withdraw_lst(&mut self, account_id: String, pool_id: String, recipient_id: String, from_withdrawable: String, from_rewards: String) -> bool;
    fn on_withdraw_protocol_lst(&mut self, pool_id: String, recipient_id: String, amount: String) -> bool;
}

#[near]
impl StakingVaultContract {
    pub fn get_lst_price(&self, pool_id: String) -> String {
        read_price(&pool_id).to_string()
    }

    pub fn get_lst_price_updated_at_ms(&self, pool_id: String) -> Option<u64> {
        let ts = read_price_ts(&pool_id);
        if ts > 0 { Some(ts) } else { None }
    }

    pub fn get_lst_binding(&self, pool_id: String) -> Option<String> {
        bound_lst(&pool_id)
    }

    pub fn get_protocol_lst_balance(&self, pool_id: String) -> String {
        read_protocol_shares(&pool_id).to_string()
    }

    /// Operator migration helper: binds a pre-upgrade LST pool to its token contract.
    pub fn bind_lst_pool(&mut self, pool_id: String, lst_contract: AccountId) {
        self.require_operator();
        validate_pool_and_apy(&pool_id, 0);
        require!(
            is_whitelisted_lst(lst_contract.as_str(), self.owner_id.as_str()),
            "STAKE_INVALID_POOL: LST token contract is not whitelisted"
        );
        bind_pool(&pool_id, lst_contract.as_str());
    }

    /// Fetches the live share price from the bound LST contract (anyone may trigger it; the value is
    /// only ever taken from the LST contract's own promise result).
    pub fn refresh_lst_price(&mut self, pool_id: String, lst_contract: AccountId) -> Promise {
        require!(
            bound_lst(&pool_id).as_deref() == Some(lst_contract.as_str()),
            "STAKE_INVALID_POOL: pool is not bound to this LST contract"
        );
        fetch_lst_price_promise(lst_contract).then(
            ext_lst_self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_lst_price(pool_id),
        )
    }

    #[private]
    pub fn on_lst_price(&mut self, pool_id: String, #[callback_result] price: Result<U128, PromiseError>) -> bool {
        match price {
            Ok(p) if p.0 > 0 => {
                write_u128_key(&price_key(&pool_id), p.0);
                write_price_ts(&pool_id, env::block_timestamp_ms());
                emit_staking("lst_price", json!({ "pool_id": pool_id, "price": p.0.to_string() }));
                true
            }
            _ => false,
        }
    }

    /// Mainnet native entry: forwards the attached NEAR into `deposit_and_stake` on the LST contract
    /// (with the builder `referral_id`), fetches the live share price in parallel (`Promise::and`),
    /// enforces a 1h staleness ceiling on the cached price, and refunds on failure or zero shares.
    #[payable]
    pub fn deposit_and_stake_lst(
        &mut self,
        pool_id: String,
        lst_contract: AccountId,
        referral_id: Option<AccountId>,
        account_id: Option<String>,
    ) -> Promise {
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            env::prepaid_gas() >= Gas::from_tgas(MIN_DEPOSIT_STAKE_LST_TGAS),
            "NEAR_INSUFFICIENT_GAS: attach >= 85 TGas for deposit_and_stake_lst"
        );
        require!(attached >= crate::MIN_PAYABLE_DEPOSIT_YOCTO, "STAKE_INSUFFICIENT_BALANCE: attached NEAR deposit must be >= 0.005 NEAR to cover storage");
        validate_pool_and_apy(&pool_id, 0);
        require!(
            is_whitelisted_lst(lst_contract.as_str(), self.owner_id.as_str()),
            "STAKE_INVALID_POOL: LST token contract is not whitelisted"
        );
        require!(
            !crate::storage::is_native_pool(&pool_id),
            "STAKE_INVALID_POOL: pool is bound to native NEAR staking"
        );
        if let Some(existing) = bound_lst(&pool_id) {
            require!(existing == lst_contract.as_str(), "STAKE_INVALID_POOL: pool is bound to another LST contract");
        } else {
            require!(
                pool_id == lst_contract.as_str(),
                "STAKE_INVALID_POOL: pool is not bound to this LST contract"
            );
        }
        let price = read_price(&pool_id);
        require!(price > 0, "STAKE_PRICE_UNKNOWN: call refresh_lst_price first");
        require!(
            mul_div_floor(attached, PRICE_ONE, price).unwrap_or(0) > 0,
            "STAKE_INSUFFICIENT_BALANCE: attached NEAR deposit too small to mint LST shares"
        );
        let chain_now = env::block_timestamp_ms();
        let price_ts = read_price_ts(&pool_id);
        if chain_now > 0 && price_ts > 0 {
            require!(
                chain_now.saturating_sub(price_ts) <= MAX_LST_PRICE_AGE_MS,
                "STAKE_PRICE_STALE: cached LST price is older than 1 hour; call refresh_lst_price first"
            );
        }
        let depositor = env::predecessor_account_id();
        let target = account_id.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| depositor.to_string());
        require!(
            self.is_operator(&depositor) || depositor.as_str() == target,
            "NEAR_NOT_OWNER: cannot deposit_and_stake_lst into another account"
        );
        validate_target_account(&target);
        let args = match &referral_id {
            Some(r) => json!({ "referral_id": r }),
            None => json!({}),
        };
        let deposit_call = Promise::new(lst_contract.clone()).function_call(
            "deposit_and_stake".to_string(),
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(attached),
            DEPOSIT_STAKE_GAS,
        );
        deposit_call.and(fetch_lst_price_promise(lst_contract.clone())).then(
            ext_lst_self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_lst_deposit(depositor, target, pool_id, lst_contract.to_string(), attached.to_string(), price.to_string(), chain_now),
        )
    }

    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_lst_deposit(
        &mut self,
        depositor: AccountId,
        target: String,
        pool_id: String,
        lst_contract: String,
        attached: String,
        price: String,
        now_ms: u64,
    ) -> bool {
        let amount = parse_yocto(&attached);
        if env::promise_result_checked(0, 1024).is_err() {
            Promise::new(depositor.clone()).transfer(NearToken::from_yoctonear(amount)).detach();
            emit_staking("lst_deposit_refund", json!({ "depositor": depositor, "pool_id": pool_id, "amount": attached }));
            return false;
        }
        let cached = parse_yocto(&price);
        let live = if env::promise_results_count() > 1 {
            env::promise_result_checked(1, 256)
                .ok()
                .and_then(|b| near_sdk::serde_json::from_slice::<U128>(&b).ok())
                .map(|u| u.0)
                .filter(|&v| v > 0)
        } else {
            None
        };
        if let Some(p) = live {
            write_u128_key(&price_key(&pool_id), p);
            write_price_ts(&pool_id, env::block_timestamp_ms().max(now_ms));
        }
        let effective_price = live.map_or(cached, |p| p.max(cached));
        let shares = mul_div_floor(amount, PRICE_ONE, effective_price).unwrap_or(0);
        if shares == 0 {
            // `deposit_and_stake` (promise 0) already succeeded on `lst_contract`, so the attached NEAR left this
            // contract; never refund out of the vault's own native balance when `shares == 0`.
            emit_staking("lst_deposit_zero_shares", json!({ "depositor": depositor, "pool_id": pool_id, "amount": attached }));
            return false;
        }
        bind_pool(&pool_id, &lst_contract);
        self.credit_lst_shares(&target, &pool_id, &lst_contract, shares, effective_price, now_ms, 0);
        emit_staking("lst_deposit_and_stake", json!({ "account_id": target, "lst": lst_contract, "pool_id": pool_id, "near": attached, "shares": shares.to_string() }));
        true
    }

    /// Single-step LST payout: `ft_transfer` (1 yocto) straight to the wallet, rolled back by
    /// `on_withdraw_lst` when it fails. `amount` is in share units, taken from the matured principal first,
    /// then (price mode only) from realised yield. Accepts 0 or 1 yoctoNEAR wallet confirmation deposit.
    #[payable]
    pub fn withdraw_lst(
        &mut self,
        pool_id: String,
        lst_contract: AccountId,
        amount: String,
        account_id: Option<String>,
        recipient_id: Option<String>,
    ) -> Promise {
        require!(
            env::attached_deposit().as_yoctonear() <= 1,
            "STAKE_INVALID_DEPOSIT: attach at most 1 yoctoNEAR to withdraw_lst"
        );
        require!(
            env::prepaid_gas() >= Gas::from_tgas(MIN_WITHDRAW_LST_TGAS),
            "NEAR_INSUFFICIENT_GAS: attach >= 40 TGas for withdraw_lst"
        );
        let caller = env::predecessor_account_id();
        let target = account_id.unwrap_or_else(|| caller.to_string());
        require!(
            caller.as_str() == target || self.is_operator(&caller),
            "NEAR_NOT_OWNER: caller not authorized"
        );
        validate_pool_and_apy(&pool_id, 0);
        require!(
            bound_lst(&pool_id).as_deref() == Some(lst_contract.as_str()),
            "STAKE_INVALID_POOL: pool is not bound to this LST contract"
        );
        let qty = parse_yocto(&amount);
        require!(qty > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");
        let recipient: AccountId = recipient_id
            .unwrap_or_else(|| target.clone())
            .parse()
            .unwrap_or_else(|_| env::panic_str("STAKE_INVALID_RECIPIENT: invalid recipient account"));
        require!(
            self.is_operator(&caller) || recipient == caller || env::attached_deposit().as_yoctonear() == 1,
            "STAKE_ONE_YOCTO_REQUIRED: attach 1 yoctoNEAR when withdrawing to a third-party recipient"
        );
        let now = env::block_timestamp_ms();
        let settled = self.settle_pure(&target, &pool_id, 0, now);
        let mut next = settled.record.clone();
        let pay_yield = settled.price_mode;
        let avail = next.withdrawable.saturating_add(if pay_yield { next.rewards } else { 0 });
        require!(
            qty <= avail && next.withdrawable.saturating_add(next.rewards) > 0,
            "STAKE_INSUFFICIENT_BALANCE: no withdrawable LST available"
        );
        self.apply_settled(&target, &pool_id, &settled);
        let from_withdrawable = qty.min(next.withdrawable);
        let from_rewards = qty - from_withdrawable;
        next.withdrawable -= from_withdrawable;
        next.rewards -= from_rewards;
        self.positions.insert(pos_key(&target, &pool_id), next);
        ext_lst_token::ext(lst_contract)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(FT_TRANSFER_GAS)
            .ft_transfer(recipient.clone(), U128(qty), None)
            .then(
                ext_lst_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_withdraw_lst(target, pool_id, recipient.to_string(), from_withdrawable.to_string(), from_rewards.to_string()),
            )
    }

    #[private]
    pub fn on_withdraw_lst(
        &mut self,
        account_id: String,
        pool_id: String,
        recipient_id: String,
        from_withdrawable: String,
        from_rewards: String,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool {
        let (w, r) = (parse_yocto(&from_withdrawable), parse_yocto(&from_rewards));
        if call_result.is_ok() {
            let total = (w + r).to_string();
            emit_staking("withdraw_lst", json!({ "account_id": account_id, "recipient": recipient_id, "pool_id": pool_id, "amount": total }));
            return true;
        }
        let key = pos_key(&account_id, &pool_id);
        let mut rec = self.positions.get(&key).cloned().unwrap_or_default();
        rec.withdrawable = rec.withdrawable.saturating_add(w);
        rec.rewards = rec.rewards.saturating_add(r);
        self.positions.insert(key, rec);
        emit_staking("withdraw_lst_rollback", json!({ "account_id": account_id, "recipient": recipient_id, "pool_id": pool_id }));
        false
    }

    /// Sweeps accrued protocol LST shares of `pool_id` to `recipient_id` (operator only, rollback on failure).
    pub fn withdraw_protocol_lst(
        &mut self,
        pool_id: String,
        lst_contract: AccountId,
        amount: Option<String>,
        recipient_id: Option<AccountId>,
    ) -> Promise {
        self.require_operator();
        require!(
            bound_lst(&pool_id).as_deref() == Some(lst_contract.as_str()),
            "STAKE_INVALID_POOL: pool is not bound to this LST contract"
        );
        let avail = read_protocol_shares(&pool_id);
        let qty = amount.as_deref().map(parse_yocto).unwrap_or(avail);
        require!(qty > 0 && qty <= avail, "STAKE_INSUFFICIENT_BALANCE: insufficient protocol LST balance");
        let recipient = recipient_id.unwrap_or_else(|| self.owner_id.clone());
        write_protocol_shares(&pool_id, avail - qty);
        ext_lst_token::ext(lst_contract)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(FT_TRANSFER_GAS)
            .ft_transfer(recipient.clone(), U128(qty), None)
            .then(
                ext_lst_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_withdraw_protocol_lst(pool_id, recipient.to_string(), qty.to_string()),
            )
    }

    #[private]
    pub fn on_withdraw_protocol_lst(
        &mut self,
        pool_id: String,
        recipient_id: String,
        amount: String,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool {
        if call_result.is_ok() {
            emit_staking("withdraw_protocol_lst", json!({ "pool_id": pool_id, "recipient": recipient_id, "amount": amount }));
            return true;
        }
        write_protocol_shares(&pool_id, read_protocol_shares(&pool_id).saturating_add(parse_yocto(&amount)));
        false
    }

    /// Accepts whitelisted NEP-141 Liquid Staking Tokens (`stNEAR`, `LiNEAR`, `rNEAR`) via `ft_transfer_call`.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: String, msg: String) -> String {
        let token_contract = env::predecessor_account_id();
        require!(
            is_whitelisted_lst(token_contract.as_str(), self.owner_id.as_str()),
            "STAKE_INVALID_POOL: LST token contract is not whitelisted"
        );
        let qty = parse_yocto(&amount);
        require!(qty > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");
        require!(
            qty >= crate::MIN_PAYABLE_DEPOSIT_YOCTO,
            "STAKE_INSUFFICIENT_BALANCE: LST stake must be >= 0.005 shares to cover storage"
        );
        let parsed = serde_json::from_str::<serde_json::Value>(&msg).unwrap_or_else(|_| json!({}));
        let pool_id = parsed
            .get("pool_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(token_contract.as_str())
            .to_string();
        let target = parsed
            .get("account_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(sender_id.as_str())
            .to_string();
        require!(
            self.is_operator(&sender_id) || sender_id.as_str() == target,
            "NEAR_NOT_OWNER: cannot stake LST into another account"
        );
        let apy_bp = parsed.get("apy_bp").and_then(|v| v.as_u64()).unwrap_or(900) as u32;
        validate_pool_and_apy(&pool_id, apy_bp);
        validate_target_account(&target);
        require!(
            apy_bp <= MAX_NON_OPERATOR_APY_BP,
            "STAKE_INVALID_APY: LST stake apy_bp exceeds 1000 bp"
        );
        require!(
            !crate::storage::is_native_pool(&pool_id),
            "STAKE_INVALID_POOL: pool is bound to native NEAR staking"
        );
        require!(
            pool_id == token_contract.as_str()
                || bound_lst(&pool_id).is_some()
                || self.is_operator(&sender_id),
            "STAKE_INVALID_POOL: non-operator LST deposits must target the LST contract pool or an operator-bound pool"
        );
        bind_pool(&pool_id, token_contract.as_str());
        let prior = self.positions.get(&pos_key(&target, &pool_id)).map(|r| (r.staked, r.last_accrued_at_ms)).unwrap_or_default();
        let chain_now = env::block_timestamp_ms();
        let effective_now = if chain_now > 0 {
            chain_now
        } else if prior.0 > 0 {
            prior.1
        } else {
            parsed.get("now_ms").and_then(|v| v.as_u64()).unwrap_or(0)
        };
        let price = read_price(&pool_id);
        let price_ts = read_price_ts(&pool_id);
        if price > 0 && chain_now > 0 && price_ts > 0 {
            require!(
                chain_now.saturating_sub(price_ts) <= MAX_LST_PRICE_AGE_MS,
                "STAKE_PRICE_STALE: cached LST price is older than 1 hour; call refresh_lst_price first"
            );
        }
        self.credit_lst_shares(&target, &pool_id, token_contract.as_str(), qty, price, effective_now, apy_bp);
        emit_staking("lst_stake", json!({ "account_id": target, "lst": token_contract, "pool_id": pool_id, "amount": amount }));
        "0".to_string()
    }

    /// Books `shares` of an LST into a wallet position (settling yield first) and stamps the deposit clock.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn credit_lst_shares(
        &mut self,
        target: &str,
        pool_id: &str,
        lst_contract: &str,
        shares: u128,
        price: u128,
        now_ms: u64,
        apy_bp: u32,
    ) {
        let settled = self.settle_pure(target, pool_id, apy_bp, now_ms);
        self.apply_settled(target, pool_id, &settled);
        let mut next = settled.record;
        let prior = next.staked;
        next.staked = prior.checked_add(shares).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.positions.insert(pos_key(target, pool_id), next);
        record_deposit(target, pool_id, lst_contract, now_ms, prior, shares, price);
    }

    pub(crate) fn credit_protocol_for_pool(&mut self, pool_id: &str, amount: u128) {
        if amount == 0 {
            return;
        }
        if is_lst_pool(pool_id) {
            write_protocol_shares(pool_id, read_protocol_shares(pool_id).saturating_add(amount));
        } else {
            self.credit_protocol_yield(amount);
        }
    }
}
