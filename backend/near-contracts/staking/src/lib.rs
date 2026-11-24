mod accrual;
mod fees;
mod lst;
mod lst_math;
mod mathx;
mod payout;
mod positions;
mod settle;
mod storage;

use accrual::{read_protocol_yield_bp, to_view};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;
use storage::*;

pub use fees::{EARLY_EXIT_FEE_BP, EARLY_EXIT_WINDOW_MS};

const GAME_DAY_MS: u64 = 86_400_000;
const UNBONDING_DURATION_MS: u64 = 2 * GAME_DAY_MS;
const YEAR_MS: u128 = 365 * (GAME_DAY_MS as u128);
const DEFAULT_PROTOCOL_YIELD_SHARE_BP: u32 = 2_000; // Default 20% of validator yield -> protocol.<owner_id>, 80% -> staker (7.2% net APY)
const MAX_APY_BP: u32 = 5_000; // 50.00% sanity ceiling on gross validator APY
const MAX_NON_OPERATOR_APY_BP: u32 = 1_000; // 10.00% ceiling on direct non-operator payable/LST stakes
const MIN_PAYABLE_DEPOSIT_YOCTO: u128 = 5_000_000_000_000_000_000_000; // 0.005 NEAR covers storage lock (> ~350 bytes)
const CFG_PROTOCOL_KEY: &[u8] = b"cfg:protocol";
const CFG_YIELD_BP_KEY: &[u8] = b"cfg:yield_bp";

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StakingRecord {
    pub staked: u128,
    pub unbonding: u128,
    pub unbonding_ready_at_ms: Option<u64>,
    pub withdrawable: u128,
    pub rewards: u128,
    pub last_accrued_at_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StakingPositionView {
    pub account_id: String,
    pub pool_id: String,
    pub staked: String,
    pub unbonding: String,
    pub unbonding_ready_at_ms: Option<u64>,
    pub withdrawable: String,
    pub rewards: String,
    /// Set by `unstake`: the `< 7 day` exit fee (yocto of principal routed to the protocol), `"0"` when none.
    #[serde(default)]
    pub early_exit_fee: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WithdrawResultView {
    pub account_id: String,
    pub recipient_id: String,
    pub pool_id: String,
    pub withdrawn: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct StakingVaultContract {
    owner_id: AccountId,
    operator_id: AccountId,
    balances: LookupMap<String, u128>,
    positions: LookupMap<String, StakingRecord>,
    processed_ops: LookupMap<String, String>,
}

pub(crate) fn op_key(scope: &str, op_id: &str) -> String {
    format!("{scope}:{op_id}")
}

fn emit_staking(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "terra-staking",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

#[near]
impl StakingVaultContract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        Self {
            owner_id,
            operator_id,
            balances: LookupMap::new(b"b"),
            positions: LookupMap::new(b"p"),
            processed_ops: LookupMap::new(b"o"),
        }
    }

    pub fn set_operator(&mut self, operator_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "NEAR_NOT_OWNER: only owner can update operator"
        );
        self.operator_id = operator_id.clone();
        emit_staking("operator_updated", json!({ "operator_id": operator_id }));
    }

    /// Configures an explicit protocol treasury receiver (`protocol.<root>` by default).
    /// Stored under disjoint key `cfg:protocol` so Borsh contract state upgrades remain 100% compatible.
    pub fn set_protocol_account(&mut self, protocol_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "NEAR_NOT_OWNER: only owner can update protocol account"
        );
        env::storage_write(CFG_PROTOCOL_KEY, protocol_id.as_bytes());
        emit_staking("protocol_account_updated", json!({ "protocol_id": protocol_id }));
    }

    /// Configures the protocol share of accrued validator staking yield (`0..=10_000` bp; default `2_000` = `20%`).
    /// Stored under disjoint key `cfg:yield_bp` so Borsh contract state upgrades remain 100% compatible.
    pub fn set_protocol_yield_bp(&mut self, yield_bp: u32) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "NEAR_NOT_OWNER: only owner can update protocol yield bp"
        );
        require!(
            yield_bp <= 10_000,
            "STAKE_INVALID_YIELD_BP: yield_bp exceeds 10000 bp"
        );
        env::storage_write(CFG_YIELD_BP_KEY, &yield_bp.to_le_bytes());
        emit_staking("protocol_yield_bp_updated", json!({ "yield_bp": yield_bp }));
    }

    pub fn get_protocol_yield_bp(&self) -> u32 {
        read_protocol_yield_bp()
    }

    pub(crate) fn resolve_protocol_account_id(&self) -> String {
        if let Some(bytes) = env::storage_read(CFG_PROTOCOL_KEY) {
            if let Ok(custom) = String::from_utf8(bytes) {
                let trimmed = custom.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
        format!("protocol.{}", self.owner_id)
    }

    fn is_operator(&self, caller: &AccountId) -> bool {
        *caller == self.operator_id || *caller == self.owner_id
    }

    fn require_operator(&self) {
        require!(
            self.is_operator(&env::predecessor_account_id()),
            "NEAR_NOT_OWNER: caller not authorized"
        );
    }

    /// Credits virtual NEAR balance inside the staking vault (`fund` helper / top-ups). Idempotent by `op_id`.
    pub fn credit_near(&mut self, op_id: String, account_id: String, amount: String) -> String {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        require!(!account_id.trim().is_empty(), "STAKE_INSUFFICIENT_BALANCE: account_id required");
        self.require_operator();
        let okey = op_key("credit", &op_id);
        if let Some(prev) = self.processed_ops.get(&okey) {
            return prev.clone();
        }
        let add_val = parse_yocto(&amount);
        let cur = self.balances.get(&account_id).copied().unwrap_or(0);
        let next = cur.checked_add(add_val).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.balances.insert(account_id.clone(), next);
        let res = next.to_string();
        self.processed_ops.insert(okey, res.clone());
        emit_staking("credit_near", json!({ "account_id": account_id, "amount": amount, "balance": res }));
        res
    }

    pub fn get_near_balance(&self, account_id: String) -> String {
        self.balances.get(&account_id).copied().unwrap_or(0).to_string()
    }

    pub fn get_native_deposit_balance(&self, account_id: String) -> String {
        read_native_dep(&account_id).to_string()
    }

    /// Accepts real payable NEAR deposits directly from a user wallet (or on behalf of `account_id`).
    #[payable]
    pub fn deposit_near(&mut self, account_id: Option<AccountId>) -> String {
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached > 0,
            "STAKE_INSUFFICIENT_BALANCE: attached NEAR deposit must be > 0"
        );
        require!(
            attached >= MIN_PAYABLE_DEPOSIT_YOCTO,
            "STAKE_INSUFFICIENT_BALANCE: attached NEAR deposit must be >= 0.005 NEAR to cover storage"
        );
        let target = account_id
            .unwrap_or_else(env::predecessor_account_id)
            .to_string();
        let cur = self.balances.get(&target).copied().unwrap_or(0);
        let next = cur
            .checked_add(attached)
            .expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        let cur_native = read_native_dep(&target);
        let next_native = cur_native
            .checked_add(attached)
            .expect("STAKE_INSUFFICIENT_BALANCE: native deposit overflow");
        self.balances.insert(target.clone(), next);
        write_native_dep(&target, next_native);
        let res = next.to_string();
        emit_staking(
            "deposit_near",
            json!({
                "account_id": target,
                "depositor": env::predecessor_account_id(),
                "amount": attached.to_string(),
                "balance": res,
            }),
        );
        res
    }

    fn credit_protocol_yield(&mut self, cut: u128) {
        if cut == 0 {
            return;
        }
        let protocol_id = self.resolve_protocol_account_id();
        let cur = self.balances.get(&protocol_id).copied().unwrap_or(0);
        self.balances.insert(protocol_id, cur.saturating_add(cut));
    }

    pub fn get_protocol_account(&self) -> String {
        self.resolve_protocol_account_id()
    }

    pub fn get_protocol_yield_balance(&self) -> String {
        let protocol_id = self.resolve_protocol_account_id();
        self.balances.get(&protocol_id).copied().unwrap_or(0).to_string()
    }

    /// Stakes `amount` yoctoNEAR from `payer_id` (or `account_id`) into `pool_id`. Idempotent by `op_id`.
    #[allow(clippy::too_many_arguments)]
    pub fn stake(
        &mut self,
        op_id: String,
        account_id: String,
        payer_id: Option<String>,
        pool_id: String,
        apy_bp: u32,
        amount: String,
        now_ms: u64,
    ) -> StakingPositionView {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        self.require_operator();
        let okey = op_key("stake", &op_id);
        if let Some(cached) = self.processed_ops.get(&okey) {
            return serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt");
        }
        validate_pool_and_apy(&pool_id, apy_bp);
        require!(
            !lst::is_lst_pool(&pool_id) && !lst::is_whitelisted_lst(&pool_id, self.owner_id.as_str()),
            "STAKE_INVALID_POOL: LST pools stake through ft_transfer_call"
        );
        validate_target_account(&account_id);
        let stake_val = parse_yocto(&amount);
        require!(stake_val > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");

        let payer = payer_id.unwrap_or_else(|| account_id.clone());
        let payer_bal = self.balances.get(&payer).copied().unwrap_or(0);
        require!(
            payer_bal >= stake_val,
            "STAKE_INSUFFICIENT_BALANCE: insufficient NEAR balance"
        );
        self.balances.insert(payer.clone(), payer_bal - stake_val);

        let payer_ndep = read_native_dep(&payer);
        let moved_ndep = payer_ndep.min(stake_val);
        if moved_ndep > 0 {
            write_native_dep(&payer, payer_ndep - moved_ndep);
            let cur_pos_ndep = read_pos_ndep(&account_id, &pool_id);
            write_pos_ndep(
                &account_id,
                &pool_id,
                cur_pos_ndep.saturating_add(moved_ndep),
            );
        }

        mark_native_pool(&pool_id);
        let settled = self.settle_pure(&account_id, &pool_id, apy_bp, now_ms);
        self.apply_settled(&account_id, &pool_id, &settled);
        let mut next = settled.record;
        let prior = next.staked;
        next.staked = prior.checked_add(stake_val).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.positions.insert(pos_key(&account_id, &pool_id), next.clone());
        positions::record_deposit(&account_id, &pool_id, positions::NATIVE_ASSET, now_ms, prior, 0, stake_val, 0);

        let view = to_view(&account_id, &pool_id, &next);
        self.processed_ops.insert(okey, serde_json::to_string(&view).unwrap());
        emit_staking(
            "stake",
            json!({ "account_id": account_id, "payer": payer, "pool_id": pool_id, "amount": amount }),
        );
        view
    }

    /// Begins unbonding `amount` yoctoNEAR from `pool_id` (4 epochs / 2 game-days). Idempotent by `op_id`.
    /// Self-custody owners (`caller == account_id`) may unstake directly using chain block time.
    pub fn unstake(
        &mut self,
        op_id: String,
        account_id: String,
        pool_id: String,
        apy_bp: u32,
        amount: String,
        now_ms: u64,
    ) -> StakingPositionView {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        let caller = env::predecessor_account_id();
        let is_operator = self.is_operator(&caller);
        require!(
            is_operator || caller.as_str() == account_id,
            "NEAR_NOT_OWNER: caller not authorized"
        );
        require!(
            is_operator || apy_bp <= MAX_NON_OPERATOR_APY_BP,
            "STAKE_INVALID_APY: direct non-operator apy_bp exceeds 1000 bp"
        );
        let okey = op_key("unstake", &op_id);
        if let Some(cached) = self.processed_ops.get(&okey) {
            return serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt");
        }
        validate_pool_and_apy(&pool_id, apy_bp);
        let unstake_val = parse_yocto(&amount);
        require!(unstake_val > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");
        let chain_now = env::block_timestamp_ms();
        let effective_now = if is_operator {
            now_ms
        } else if chain_now > 0 {
            chain_now
        } else {
            now_ms
        };

        let settled = self.settle_pure(&account_id, &pool_id, apy_bp, effective_now);
        let mut next = settled.record.clone();
        require!(
            next.staked >= unstake_val,
            "STAKE_INSUFFICIENT_BALANCE: insufficient staked NEAR"
        );
        self.apply_settled(&account_id, &pool_id, &settled);
        // `< 7 days` since the latest deposit: 25 bp of the unstaked principal goes to the protocol.
        let last_staked = positions::read_meta(&account_id, &pool_id).map(|m| m.last_staked_at_ms);
        let fee = fees::early_exit_fee(unstake_val, last_staked, effective_now);
        self.credit_protocol_for_pool(&pool_id, fee);
        next.staked -= unstake_val;
        next.unbonding = next.unbonding.saturating_add(unstake_val - fee);
        next.unbonding_ready_at_ms = Some(effective_now.saturating_add(UNBONDING_DURATION_MS));
        if fee > 0 && !lst::is_lst_pool(&pool_id) {
            let pos_ndep = read_pos_ndep(&account_id, &pool_id);
            let user_principal = next
                .staked
                .saturating_add(next.unbonding)
                .saturating_add(next.withdrawable);
            let backed_fee = pos_ndep.saturating_sub(user_principal).min(fee);
            if backed_fee > 0 {
                write_pos_ndep(&account_id, &pool_id, pos_ndep - backed_fee);
                let protocol_id = self.resolve_protocol_account_id();
                write_native_dep(&protocol_id, read_native_dep(&protocol_id).saturating_add(backed_fee));
            }
        }
        self.positions.insert(pos_key(&account_id, &pool_id), next.clone());
        positions::record_unstake(&account_id, &pool_id, next.staked);

        let mut view = to_view(&account_id, &pool_id, &next);
        view.early_exit_fee = Some(fee.to_string());
        self.processed_ops.insert(okey, serde_json::to_string(&view).unwrap());
        emit_staking(
            "unstake",
            json!({ "account_id": account_id, "pool_id": pool_id, "amount": amount, "early_exit_fee": fee.to_string(), "ready_at_ms": next.unbonding_ready_at_ms }),
        );
        view
    }

    pub fn get_position(
        &self,
        account_id: String,
        pool_id: String,
        apy_bp: u32,
        now_ms: u64,
    ) -> StakingPositionView {
        validate_pool_and_apy(&pool_id, apy_bp);
        let key = pos_key(&account_id, &pool_id);
        let projected = if self.positions.contains_key(&key) {
            self.settle_pure(&account_id, &pool_id, apy_bp, now_ms).record
        } else {
            StakingRecord::default()
        };
        to_view(&account_id, &pool_id, &projected)
    }
    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator_id.clone()
    }

    /// Single-transaction direct wallet deposit + stake (zero operator custody required).
    #[payable]
    pub fn stake_payable(
        &mut self,
        op_id: String,
        pool_id: String,
        apy_bp: u32,
        now_ms: u64,
        account_id: Option<String>,
    ) -> StakingPositionView {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        let stake_val = env::attached_deposit().as_yoctonear();
        let okey = op_key("stake_payable", &op_id);
        if let Some(cached) = self.processed_ops.get(&okey) {
            require!(
                stake_val == 0,
                "STAKE_DUPLICATE_OP: duplicate op_id with attached NEAR deposit"
            );
            return serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt");
        }
        validate_pool_and_apy(&pool_id, apy_bp);
        require!(stake_val > 0, "STAKE_INSUFFICIENT_BALANCE: attached NEAR deposit must be > 0");
        require!(
            stake_val >= MIN_PAYABLE_DEPOSIT_YOCTO,
            "STAKE_INSUFFICIENT_BALANCE: attached NEAR deposit must be >= 0.005 NEAR to cover storage"
        );
        let caller_acct = env::predecessor_account_id();
        let is_operator = caller_acct == self.operator_id || caller_acct == self.owner_id;
        require!(
            is_operator || apy_bp <= MAX_NON_OPERATOR_APY_BP,
            "STAKE_INVALID_APY: direct non-operator apy_bp exceeds 1000 bp"
        );
        let caller = caller_acct.to_string();
        let target = account_id.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| caller.clone());
        require!(
            is_operator || caller == target,
            "NEAR_NOT_OWNER: cannot stake_payable into another account"
        );
        validate_target_account(&target);
        require!(
            !lst::is_lst_pool(&pool_id) && !lst::is_whitelisted_lst(&pool_id, self.owner_id.as_str()),
            "STAKE_INVALID_POOL: LST pools stake through ft_transfer_call"
        );
        mark_native_pool(&pool_id);
        write_pos_ndep(&target, &pool_id, read_pos_ndep(&target, &pool_id).saturating_add(stake_val));
        let existing_staked = self.positions.get(&pos_key(&target, &pool_id)).map(|r| (r.staked, r.last_accrued_at_ms)).unwrap_or_default();
        let chain_now = env::block_timestamp_ms();
        let effective_now = if is_operator {
            now_ms
        } else if chain_now > 0 {
            chain_now
        } else if existing_staked.0 > 0 {
            existing_staked.1
        } else {
            now_ms
        };
        let settled = self.settle_pure(&target, &pool_id, apy_bp, effective_now);
        self.apply_settled(&target, &pool_id, &settled);
        let mut next = settled.record;
        let prior = next.staked;
        next.staked = prior.checked_add(stake_val).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.positions.insert(pos_key(&target, &pool_id), next.clone());
        positions::record_deposit(&target, &pool_id, positions::NATIVE_ASSET, effective_now, prior, 0, stake_val, 0);

        let view = to_view(&target, &pool_id, &next);
        self.processed_ops.insert(okey, serde_json::to_string(&view).unwrap());
        emit_staking("stake_payable", json!({ "account_id": target, "pool_id": pool_id, "amount": stake_val.to_string() }));
        view
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_fees;
#[cfg(test)]
mod tests_lst;
