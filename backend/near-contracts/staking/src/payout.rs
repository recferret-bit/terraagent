//! Native NEAR payouts: single-step `withdraw` (direct `Promise::transfer` + rollback callback),
//! the refund-only `claim_native_near` for unstaked deposits, and `compound_yield`.
use crate::StakingVaultContractExt;
use crate::positions::NATIVE_ASSET;
use crate::storage::*;
use crate::{emit_staking, lst, StakingPositionView, StakingVaultContract, WithdrawResultView};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, Promise, PromiseError,
    PromiseOrValue,
};
use serde_json::json;

const MIN_CLAIM_PREPAID_TGAS: u64 = 25;
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const STORAGE_RESERVE_MILLINEAR: u128 = 50; // 0.05 NEAR liquid buffer above storage lock
/// Simulated gross APY (`STAKING_RULES.simGrossApyBp`) when a compound call does not pass one.
const DEFAULT_SIM_APY_BP: u32 = 900;

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait ExtSelf {
    fn on_claim_native_near(&mut self, caller: String, recipient_id: String, amount: String) -> bool;
    #[allow(clippy::too_many_arguments)]
    fn on_withdraw(&mut self, op_id: String, account_id: String, pool_id: String, recipient_id: String, withdrawable: String, rewards: String, released_ndep: String, backed_yield: String) -> WithdrawResultView;
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompoundResultView {
    pub position: StakingPositionView,
    /// Yield rolled into principal (the staker's 80 %).
    pub compounded: String,
    /// Protocol 20 % credited by this call (0 when it was already booked by an earlier settle).
    pub protocol_cut: String,
}

/// NEAR the contract may send out without eating into the storage lock + reserve.
fn liquid_balance() -> u128 {
    let storage_locked = (env::storage_usage() as u128).saturating_mul(env::storage_byte_cost().as_yoctonear());
    let reserve = NearToken::from_millinear(STORAGE_RESERVE_MILLINEAR).as_yoctonear();
    env::account_balance().as_yoctonear().saturating_sub(storage_locked.saturating_add(reserve))
}

#[near]
impl StakingVaultContract {
    /// Withdraws matured unbonded NEAR + accrued rewards **directly to the recipient wallet in one step**
    /// (`Promise::transfer`); `on_withdraw` restores the position when the transfer fails. Idempotent by
    /// `op_id`: a replay of a *completed* withdraw returns the cached result, an in-flight or rolled-back one
    /// can simply be retried. LST pools pay out through `withdraw_lst`.
    pub fn withdraw(
        &mut self,
        op_id: String,
        account_id: String,
        recipient_id: Option<String>,
        pool_id: String,
        apy_bp: u32,
        now_ms: u64,
    ) -> PromiseOrValue<WithdrawResultView> {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        self.require_operator();
        if let Some(cached) = self.processed_ops.get(&op_id) {
            return PromiseOrValue::Value(serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt"));
        }
        validate_pool_and_apy(&pool_id, apy_bp);
        require!(!lst::is_lst_pool(&pool_id), "STAKE_INVALID_POOL: LST pools pay out through withdraw_lst");
        let settled = self.settle_pure(&account_id, &pool_id, apy_bp, now_ms);
        let mut next = settled.record.clone();
        require!(next.withdrawable > 0, "STAKE_INSUFFICIENT_BALANCE: no withdrawable NEAR available");
        let payout = next.withdrawable.saturating_add(next.rewards);
        let recipient_str = recipient_id.unwrap_or_else(|| account_id.clone());
        let recipient: AccountId = recipient_str
            .parse()
            .unwrap_or_else(|_| env::panic_str("STAKE_INVALID_RECIPIENT: invalid recipient account"));
        require!(liquid_balance() >= payout, "STAKE_INSUFFICIENT_BALANCE: contract liquid balance below storage reserve");
        self.apply_settled(&account_id, &pool_id, &settled);

        let pos_ndep = read_pos_ndep(&account_id, &pool_id);
        let released_ndep = pos_ndep.min(next.withdrawable);
        let yield_reserve = read_yield_reserve();
        let backed_yield = next.rewards.min(yield_reserve);
        write_pos_ndep(&account_id, &pool_id, pos_ndep - released_ndep);
        write_yield_reserve(yield_reserve - backed_yield);
        let (withdrawable, rewards) = (next.withdrawable, next.rewards);
        next.withdrawable = 0;
        next.rewards = 0;
        self.positions.insert(pos_key(&account_id, &pool_id), next);

        PromiseOrValue::Promise(
            Promise::new(recipient)
                .transfer(NearToken::from_yoctonear(payout))
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_withdraw(op_id, account_id, pool_id, recipient_str, withdrawable.to_string(), rewards.to_string(), released_ndep.to_string(), backed_yield.to_string()),
                ),
        )
    }

    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_withdraw(
        &mut self,
        op_id: String,
        account_id: String,
        pool_id: String,
        recipient_id: String,
        withdrawable: String,
        rewards: String,
        released_ndep: String,
        backed_yield: String,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> WithdrawResultView {
        let (w, r) = (parse_yocto(&withdrawable), parse_yocto(&rewards));
        let mut res = WithdrawResultView {
            account_id: account_id.clone(),
            recipient_id: recipient_id.clone(),
            pool_id: pool_id.clone(),
            withdrawn: (w + r).to_string(),
        };
        if call_result.is_ok() {
            self.processed_ops.insert(op_id, serde_json::to_string(&res).unwrap());
            emit_staking("withdraw", json!({ "account_id": account_id, "recipient": recipient_id, "pool_id": pool_id, "withdrawn": res.withdrawn }));
            return res;
        }
        let key = pos_key(&account_id, &pool_id);
        let mut rec = self.positions.get(&key).cloned().unwrap_or_default();
        rec.withdrawable = rec.withdrawable.saturating_add(w);
        rec.rewards = rec.rewards.saturating_add(r);
        self.positions.insert(key, rec);
        write_pos_ndep(&account_id, &pool_id, read_pos_ndep(&account_id, &pool_id).saturating_add(parse_yocto(&released_ndep)));
        write_yield_reserve(read_yield_reserve().saturating_add(parse_yocto(&backed_yield)));
        emit_staking("withdraw_rollback", json!({ "account_id": account_id, "recipient": recipient_id, "pool_id": pool_id, "amount": res.withdrawn }));
        res.withdrawn = "0".to_string();
        res
    }

    /// Refunds an *unstaked* `deposit_near` balance to a wallet (CEI + async rollback callback).
    /// Staking payouts do not use this path any more: `withdraw` pays out directly.
    pub fn claim_native_near(&mut self, amount: String, recipient_id: Option<AccountId>) -> Promise {
        require!(
            env::prepaid_gas() >= Gas::from_tgas(MIN_CLAIM_PREPAID_TGAS),
            "NEAR_INSUFFICIENT_GAS: attach >= 25 TGas for claim_native_near"
        );
        let caller = env::predecessor_account_id();
        let caller_str = caller.to_string();
        let claim_val = parse_yocto(&amount);
        require!(claim_val > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");
        let vault_bal = self.balances.get(&caller_str).copied().unwrap_or(0);
        let native_bal = read_native_dep(&caller_str);
        require!(
            vault_bal >= claim_val && native_bal >= claim_val,
            "STAKE_INSUFFICIENT_BALANCE: insufficient native NEAR deposit balance"
        );
        require!(
            liquid_balance() >= claim_val,
            "STAKE_INSUFFICIENT_BALANCE: contract liquid balance below storage reserve"
        );
        self.balances.insert(caller_str.clone(), vault_bal - claim_val);
        write_native_dep(&caller_str, native_bal - claim_val);
        let dest = recipient_id.unwrap_or(caller);
        let dest_str = dest.to_string();
        Promise::new(dest)
            .transfer(NearToken::from_yoctonear(claim_val))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_claim_native_near(caller_str, dest_str, claim_val.to_string()),
            )
    }

    #[private]
    pub fn on_claim_native_near(
        &mut self,
        caller: String,
        recipient_id: String,
        amount: String,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> bool {
        let amt = parse_yocto(&amount);
        if call_result.is_ok() {
            emit_staking("claim_native_near", json!({ "account_id": caller, "recipient_id": recipient_id, "amount": amount }));
            true
        } else {
            let cur_bal = self.balances.get(&caller).copied().unwrap_or(0);
            self.balances.insert(caller.clone(), cur_bal.saturating_add(amt));
            write_native_dep(&caller, read_native_dep(&caller).saturating_add(amt));
            emit_staking("claim_native_near_rollback", json!({ "account_id": caller, "recipient_id": recipient_id, "amount": amount }));
            false
        }
    }

    /// 1-click compound: rolls the accrued staker yield (80 %) into `staked` principal. The protocol 20 %
    /// is credited to `protocol.<owner_id>`, no fee is charged and `last_staked_at_ms` (the 7-day maturity
    /// clock) is left untouched. A wallet compounds its own positions with chain time; the operator may act
    /// for any account with an explicit `now_ms`.
    pub fn compound_yield(
        &mut self,
        pool_id: String,
        account_id: Option<String>,
        apy_bp: Option<u32>,
        now_ms: Option<u64>,
    ) -> CompoundResultView {
        let caller = env::predecessor_account_id();
        let operator = self.is_operator(&caller);
        let target = account_id.unwrap_or_else(|| caller.to_string());
        require!(operator || caller.as_str() == target, "NEAR_NOT_OWNER: caller not authorized");
        let apy = apy_bp.unwrap_or(DEFAULT_SIM_APY_BP);
        require!(operator || apy <= crate::MAX_NON_OPERATOR_APY_BP, "STAKE_INVALID_APY: direct non-operator apy_bp exceeds 1000 bp");
        validate_pool_and_apy(&pool_id, apy);
        let chain_now = env::block_timestamp_ms();
        let now = if operator { now_ms.unwrap_or(chain_now) } else { chain_now };
        let settled = self.settle_pure(&target, &pool_id, apy, now);
        require!(
            settled.price_mode || !lst::is_lst_pool(&pool_id),
            "STAKE_INVALID_POOL: LST yield compounds only under share-price accounting"
        );
        let mut next = settled.record.clone();
        let rolled = next.rewards;
        require!(rolled > 0, "STAKE_NO_YIELD: no accrued yield to compound");
        self.apply_settled(&target, &pool_id, &settled);
        if !settled.price_mode {
            // Backed native yield becomes principal backing.
            let backed = rolled.min(read_yield_reserve());
            write_yield_reserve(read_yield_reserve() - backed);
            write_pos_ndep(&target, &pool_id, read_pos_ndep(&target, &pool_id).saturating_add(backed));
        }
        next.staked = next.staked.checked_add(rolled).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        next.rewards = 0;
        self.positions.insert(pos_key(&target, &pool_id), next.clone());
        let protocol_cut = settled.native_cut.saturating_add(settled.lst_cut);
        emit_staking("compound_yield", json!({ "account_id": target, "pool_id": pool_id, "compounded": rolled.to_string(), "protocol_cut": protocol_cut.to_string() }));
        CompoundResultView {
            position: crate::accrual::to_view(&target, &pool_id, &next),
            compounded: rolled.to_string(),
            protocol_cut: protocol_cut.to_string(),
        }
    }

    pub fn get_yield_reserve(&self) -> String {
        read_yield_reserve().to_string()
    }

    pub fn get_position_native_backing(&self, account_id: String, pool_id: String) -> String {
        read_pos_ndep(&account_id, &pool_id).to_string()
    }

    /// Funds the native NEAR yield reserve so accrued validator/LST rewards remain 100% claimable on-chain.
    #[payable]
    pub fn fund_yield_reserve(&mut self) -> String {
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached > 0, "STAKE_INSUFFICIENT_BALANCE: attached yield reserve must be > 0");
        let next = read_yield_reserve().saturating_add(attached);
        write_yield_reserve(next);
        emit_staking(
            "fund_yield_reserve",
            json!({ "funder": env::predecessor_account_id(), "amount": attached.to_string(), "reserve": next.to_string() }),
        );
        next.to_string()
    }

    pub fn get_position_asset(&self, account_id: String, pool_id: String) -> String {
        crate::positions::read_meta(&account_id, &pool_id)
            .map(|m| m.asset)
            .filter(|a| !a.is_empty())
            .unwrap_or_else(|| NATIVE_ASSET.to_string())
    }
}
