use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};
use serde_json::json;

const GAME_DAY_MS: u64 = 86_400_000;
const UNBONDING_DURATION_MS: u64 = 2 * GAME_DAY_MS;
const YEAR_MS: u128 = 365 * (GAME_DAY_MS as u128);
const DEFAULT_PROTOCOL_YIELD_SHARE_BP: u32 = 2_000; // Default 20% of validator yield -> protocol.<owner_id>, 80% -> staker (7.2% net APY)
const MAX_APY_BP: u32 = 5_000; // 50.00% sanity ceiling on gross validator APY
const MAX_NON_OPERATOR_APY_BP: u32 = 1_000; // 10.00% ceiling on direct non-operator payable/LST stakes
const STORAGE_RESERVE_MILLINEAR: u128 = 50; // 0.05 NEAR liquid buffer above storage lock
const MIN_PAYABLE_DEPOSIT_YOCTO: u128 = 5_000_000_000_000_000_000_000; // 0.005 NEAR covers storage lock (> ~350 bytes)
const MIN_CLAIM_PREPAID_TGAS: u64 = 25;
const CLAIM_CALLBACK_GAS: Gas = Gas::from_tgas(10);
const CFG_PROTOCOL_KEY: &[u8] = b"cfg:protocol";
const CFG_YIELD_BP_KEY: &[u8] = b"cfg:yield_bp";
const YIELD_RESERVE_KEY: &[u8] = b"ynative:pool";

fn read_u128_key(key: &[u8]) -> u128 {
    match env::storage_read(key) {
        Some(bytes) if bytes.len() == 16 => {
            let mut arr = [0u8; 16];
            arr.copy_from_slice(&bytes);
            u128::from_le_bytes(arr)
        }
        _ => 0,
    }
}

fn write_u128_key(key: &[u8], val: u128) {
    if val == 0 {
        env::storage_remove(key);
    } else {
        env::storage_write(key, &val.to_le_bytes());
    }
}

fn pos_ndep_key(account_id: &str, pool_id: &str) -> Vec<u8> {
    format!("pndep:{}|{}", account_id, pool_id).into_bytes()
}

fn read_pos_ndep(account_id: &str, pool_id: &str) -> u128 {
    read_u128_key(&pos_ndep_key(account_id, pool_id))
}

fn write_pos_ndep(account_id: &str, pool_id: &str, val: u128) {
    write_u128_key(&pos_ndep_key(account_id, pool_id), val);
}

fn read_yield_reserve() -> u128 {
    read_u128_key(YIELD_RESERVE_KEY)
}

fn write_yield_reserve(val: u128) {
    write_u128_key(YIELD_RESERVE_KEY, val);
}

fn is_whitelisted_lst(contract_id: &str, owner_id: &str) -> bool {
    let lower = contract_id.to_ascii_lowercase();
    let owner_lower = owner_id.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "meta-pool.near"
            | "meta-v2.pool.testnet"
            | "linear-protocol.near"
            | "linear-protocol.testnet"
            | "rnear.near"
            | "rnear.testnet"
    ) || lower == format!("stnear.{}", owner_lower)
        || lower == format!("linear.{}", owner_lower)
        || lower == format!("rnear.{}", owner_lower)
}

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait ExtSelf {
    fn on_claim_native_near(&mut self, caller: String, recipient_id: String, amount: String) -> bool;
}

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

fn pos_key(account_id: &str, pool_id: &str) -> String {
    format!("{}::{}", account_id, pool_id)
}

fn native_dep_key(account_id: &str) -> Vec<u8> {
    format!("ndep:{}", account_id).into_bytes()
}

fn read_native_dep(account_id: &str) -> u128 {
    match env::storage_read(&native_dep_key(account_id)) {
        Some(bytes) if bytes.len() == 16 => {
            let mut arr = [0u8; 16];
            arr.copy_from_slice(&bytes);
            u128::from_le_bytes(arr)
        }
        _ => 0,
    }
}

fn write_native_dep(account_id: &str, val: u128) {
    let key = native_dep_key(account_id);
    if val == 0 {
        env::storage_remove(&key);
    } else {
        env::storage_write(&key, &val.to_le_bytes());
    }
}

fn parse_yocto(raw: &str) -> u128 {
    raw.parse::<u128>()
        .expect("STAKE_INSUFFICIENT_BALANCE: invalid yoctoNEAR amount")
}

fn validate_pool_and_apy(pool_id: &str, apy_bp: u32) {
    require!(!pool_id.trim().is_empty(), "STAKE_INVALID_POOL: pool_id required");
    require!(
        !pool_id.contains('|') && !pool_id.contains("::"),
        "STAKE_INVALID_POOL: pool_id cannot contain key delimiters"
    );
    require!(apy_bp <= MAX_APY_BP, "STAKE_INVALID_APY: apy_bp exceeds 5000 bp");
}

fn validate_target_account(account_id: &str) {
    require!(
        !account_id.trim().is_empty() && !account_id.contains('|') && !account_id.contains("::"),
        "STAKE_INSUFFICIENT_BALANCE: invalid account_id"
    );
}

/// Overflow-free reward accrual matching `@terra/sim` / `yocto.ts`:
/// `floor(staked * apy_bp * elapsed_ms / (10_000 * 365 * 86_400_000))`.
fn compute_accrued_reward_delta(staked: u128, apy_bp: u32, elapsed_ms: u64) -> u128 {
    if staked == 0 || apy_bp == 0 || elapsed_ms == 0 {
        return 0;
    }
    let den: u128 = 10_000u128 * YEAR_MS;
    let factor: u128 = (apy_bp as u128) * (elapsed_ms as u128);
    (staked / den) * factor + ((staked % den) * factor) / den
}

fn read_protocol_yield_bp() -> u32 {
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
fn compute_split_reward_delta(
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

fn project_record(
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

fn to_view(account_id: &str, pool_id: &str, rec: &StakingRecord) -> StakingPositionView {
    StakingPositionView {
        account_id: account_id.to_string(),
        pool_id: pool_id.to_string(),
        staked: rec.staked.to_string(),
        unbonding: rec.unbonding.to_string(),
        unbonding_ready_at_ms: rec.unbonding_ready_at_ms,
        withdrawable: rec.withdrawable.to_string(),
        rewards: rec.rewards.to_string(),
    }
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

    fn resolve_protocol_account_id(&self) -> String {
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

    fn require_operator(&self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.operator_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: caller not authorized"
        );
    }

    /// Credits virtual NEAR balance inside the staking vault (`fund` helper / top-ups). Idempotent by `op_id`.
    pub fn credit_near(&mut self, op_id: String, account_id: String, amount: String) -> String {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        require!(!account_id.trim().is_empty(), "STAKE_INSUFFICIENT_BALANCE: account_id required");
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev.clone();
        }
        let add_val = parse_yocto(&amount);
        let cur = self.balances.get(&account_id).copied().unwrap_or(0);
        let next = cur.checked_add(add_val).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.balances.insert(account_id.clone(), next);
        let res = next.to_string();
        self.processed_ops.insert(op_id, res.clone());
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

    /// Withdraws unlocked native NEAR backed by real `deposit_near` principal (CEI + async rollback callback).
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

        let storage_locked = (env::storage_usage() as u128)
            .saturating_mul(env::storage_byte_cost().as_yoctonear());
        let reserve = NearToken::from_millinear(STORAGE_RESERVE_MILLINEAR).as_yoctonear();
        let liquid = env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage_locked.saturating_add(reserve));
        require!(
            liquid >= claim_val,
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
                    .with_static_gas(CLAIM_CALLBACK_GAS)
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

    /// Sweeps accrued protocol yield (`amount` or full balance) to `recipient_id` (or `owner_id`). Idempotent by `op_id`.
    pub fn withdraw_protocol_yield(
        &mut self,
        op_id: String,
        amount: Option<String>,
        recipient_id: Option<AccountId>,
    ) -> WithdrawResultView {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        self.require_operator();
        if let Some(cached) = self.processed_ops.get(&op_id) {
            return serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt");
        }
        let protocol_id = self.resolve_protocol_account_id();
        let avail = self.balances.get(&protocol_id).copied().unwrap_or(0);
        let withdraw_val = match amount {
            Some(ref raw) => parse_yocto(raw),
            None => avail,
        };
        require!(
            withdraw_val > 0 && avail >= withdraw_val,
            "STAKE_INSUFFICIENT_BALANCE: insufficient protocol yield balance"
        );
        let recipient = recipient_id
            .map(|a| a.to_string())
            .unwrap_or_else(|| self.owner_id.to_string());
        if recipient != protocol_id {
            self.balances.insert(protocol_id.clone(), avail - withdraw_val);
            let cur_rec = self.balances.get(&recipient).copied().unwrap_or(0);
            let next_rec = cur_rec
                .checked_add(withdraw_val)
                .expect("STAKE_INSUFFICIENT_BALANCE: overflow");
            self.balances.insert(recipient.clone(), next_rec);
        }
        let res = WithdrawResultView {
            account_id: protocol_id.clone(),
            recipient_id: recipient.clone(),
            pool_id: "protocol_yield".to_string(),
            withdrawn: withdraw_val.to_string(),
        };
        self.processed_ops.insert(op_id, serde_json::to_string(&res).unwrap());
        emit_staking(
            "withdraw_protocol_yield",
            json!({
                "protocol_id": protocol_id,
                "recipient": recipient,
                "withdrawn": res.withdrawn,
            }),
        );
        res
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
        if let Some(cached) = self.processed_ops.get(&op_id) {
            return serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt");
        }
        validate_pool_and_apy(&pool_id, apy_bp);
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

        let key = pos_key(&account_id, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let (mut next, protocol_cut) =
            project_record(&existing, apy_bp, now_ms, read_protocol_yield_bp());
        self.credit_protocol_yield(protocol_cut);
        next.staked = next.staked.checked_add(stake_val).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.positions.insert(key, next.clone());

        let view = to_view(&account_id, &pool_id, &next);
        self.processed_ops.insert(op_id, serde_json::to_string(&view).unwrap());
        emit_staking(
            "stake",
            json!({ "account_id": account_id, "payer": payer, "pool_id": pool_id, "amount": amount }),
        );
        view
    }

    /// Begins unbonding `amount` yoctoNEAR from `pool_id` (4 epochs / 2 game-days). Idempotent by `op_id`.
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
        self.require_operator();
        if let Some(cached) = self.processed_ops.get(&op_id) {
            return serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt");
        }
        validate_pool_and_apy(&pool_id, apy_bp);
        let unstake_val = parse_yocto(&amount);
        require!(unstake_val > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");

        let key = pos_key(&account_id, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let (mut next, protocol_cut) =
            project_record(&existing, apy_bp, now_ms, read_protocol_yield_bp());
        require!(
            next.staked >= unstake_val,
            "STAKE_INSUFFICIENT_BALANCE: insufficient staked NEAR"
        );
        self.credit_protocol_yield(protocol_cut);
        next.staked -= unstake_val;
        next.unbonding = next.unbonding.saturating_add(unstake_val);
        next.unbonding_ready_at_ms = Some(now_ms.saturating_add(UNBONDING_DURATION_MS));
        self.positions.insert(key, next.clone());

        let view = to_view(&account_id, &pool_id, &next);
        self.processed_ops.insert(op_id, serde_json::to_string(&view).unwrap());
        emit_staking(
            "unstake",
            json!({ "account_id": account_id, "pool_id": pool_id, "amount": amount, "ready_at_ms": next.unbonding_ready_at_ms }),
        );
        view
    }

    /// Withdraws matured unbonded NEAR + accrued rewards. Idempotent by `op_id`.
    pub fn withdraw(
        &mut self,
        op_id: String,
        account_id: String,
        recipient_id: Option<String>,
        pool_id: String,
        apy_bp: u32,
        now_ms: u64,
    ) -> WithdrawResultView {
        require!(!op_id.is_empty(), "STAKE_INSUFFICIENT_BALANCE: op_id required");
        self.require_operator();
        if let Some(cached) = self.processed_ops.get(&op_id) {
            return serde_json::from_str(cached).expect("STAKE_INSUFFICIENT_BALANCE: cached corrupt");
        }
        validate_pool_and_apy(&pool_id, apy_bp);

        let key = pos_key(&account_id, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let (mut next, protocol_cut) =
            project_record(&existing, apy_bp, now_ms, read_protocol_yield_bp());
        require!(
            next.withdrawable > 0,
            "STAKE_INSUFFICIENT_BALANCE: no withdrawable NEAR available"
        );
        self.credit_protocol_yield(protocol_cut);
        let payout = next.withdrawable.saturating_add(next.rewards);
        let recipient = recipient_id.unwrap_or_else(|| account_id.clone());
        let cur_rec = self.balances.get(&recipient).copied().unwrap_or(0);
        self.balances.insert(recipient.clone(), cur_rec.saturating_add(payout));

        let pos_ndep = read_pos_ndep(&account_id, &pool_id);
        let released_ndep = pos_ndep.min(next.withdrawable);
        let remaining_ndep = pos_ndep - released_ndep;
        let yield_reserve = read_yield_reserve();
        let backed_yield = next.rewards.min(yield_reserve);
        if backed_yield > 0 {
            write_yield_reserve(yield_reserve - backed_yield);
        }
        let restore_ndep = released_ndep.saturating_add(backed_yield);
        if released_ndep > 0 {
            write_pos_ndep(&account_id, &pool_id, remaining_ndep);
        }
        if restore_ndep > 0 {
            write_native_dep(&recipient, read_native_dep(&recipient).saturating_add(restore_ndep));
        }

        next.withdrawable = 0;
        next.rewards = 0;
        self.positions.insert(key, next);

        let res = WithdrawResultView {
            account_id: account_id.clone(),
            recipient_id: recipient.clone(),
            pool_id: pool_id.clone(),
            withdrawn: payout.to_string(),
        };
        self.processed_ops.insert(op_id, serde_json::to_string(&res).unwrap());
        emit_staking(
            "withdraw",
            json!({ "account_id": account_id, "recipient": recipient, "pool_id": pool_id, "withdrawn": res.withdrawn }),
        );
        res
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
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let projected = if self.positions.contains_key(&key) {
            project_record(&existing, apy_bp, now_ms, read_protocol_yield_bp()).0
        } else {
            existing
        };
        to_view(&account_id, &pool_id, &projected)
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator_id.clone()
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
        if let Some(cached) = self.processed_ops.get(&op_id) {
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
        let target = account_id.filter(|s| !s.trim().is_empty()).unwrap_or(caller);
        validate_target_account(&target);
        write_pos_ndep(&target, &pool_id, read_pos_ndep(&target, &pool_id).saturating_add(stake_val));

        let key = pos_key(&target, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let chain_now = env::block_timestamp_ms();
        let effective_now = if is_operator {
            now_ms
        } else if chain_now > 0 {
            chain_now
        } else if existing.staked > 0 {
            existing.last_accrued_at_ms
        } else {
            now_ms
        };
        let (mut next, protocol_cut) =
            project_record(&existing, apy_bp, effective_now, read_protocol_yield_bp());
        self.credit_protocol_yield(protocol_cut);
        next.staked = next.staked.checked_add(stake_val).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.positions.insert(key, next.clone());

        let view = to_view(&target, &pool_id, &next);
        self.processed_ops.insert(op_id, serde_json::to_string(&view).unwrap());
        emit_staking("stake_payable", json!({ "account_id": target, "pool_id": pool_id, "amount": stake_val.to_string() }));
        view
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
        let apy_bp = parsed.get("apy_bp").and_then(|v| v.as_u64()).unwrap_or(900) as u32;
        validate_pool_and_apy(&pool_id, apy_bp);
        validate_target_account(&target);
        require!(
            apy_bp <= MAX_NON_OPERATOR_APY_BP,
            "STAKE_INVALID_APY: LST stake apy_bp exceeds 1000 bp"
        );
        let key = pos_key(&target, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let chain_now = env::block_timestamp_ms();
        let effective_now = if chain_now > 0 {
            chain_now
        } else if existing.staked > 0 {
            existing.last_accrued_at_ms
        } else {
            parsed.get("now_ms").and_then(|v| v.as_u64()).unwrap_or(0)
        };
        let (mut next, protocol_cut) =
            project_record(&existing, apy_bp, effective_now, read_protocol_yield_bp());
        self.credit_protocol_yield(protocol_cut);
        next.staked = next.staked.checked_add(qty).expect("STAKE_INSUFFICIENT_BALANCE: overflow");
        self.positions.insert(key, next);
        emit_staking("lst_stake", json!({ "account_id": target, "lst": token_contract, "pool_id": pool_id, "amount": amount }));
        "0".to_string()
    }
}

#[cfg(test)]
mod tests;
