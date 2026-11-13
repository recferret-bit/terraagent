use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;

const GAME_DAY_MS: u64 = 86_400_000;
const UNBONDING_DURATION_MS: u64 = 2 * GAME_DAY_MS;
const YEAR_MS: u128 = 365 * (GAME_DAY_MS as u128);

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

fn parse_yocto(raw: &str) -> u128 {
    raw.parse::<u128>()
        .expect("STAKE_INSUFFICIENT_BALANCE: invalid yoctoNEAR amount")
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

fn project_record(record: &StakingRecord, apy_bp: u32, now_ms: u64) -> StakingRecord {
    let mut next = record.clone();
    if next.last_accrued_at_ms > 0 && now_ms > next.last_accrued_at_ms {
        let elapsed = now_ms - next.last_accrued_at_ms;
        next.rewards = next
            .rewards
            .saturating_add(compute_accrued_reward_delta(next.staked, apy_bp, elapsed));
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
    next.last_accrued_at_ms = now_ms;
    next
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
        self.operator_id = operator_id;
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

    /// Stakes `amount` yoctoNEAR from `payer_id` (or `account_id`) into `pool_id`. Idempotent by `op_id`.
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
        let stake_val = parse_yocto(&amount);
        require!(stake_val > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");

        let payer = payer_id.unwrap_or_else(|| account_id.clone());
        let payer_bal = self.balances.get(&payer).copied().unwrap_or(0);
        require!(
            payer_bal >= stake_val,
            "STAKE_INSUFFICIENT_BALANCE: insufficient NEAR balance"
        );
        self.balances.insert(payer.clone(), payer_bal - stake_val);

        let key = pos_key(&account_id, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let mut next = project_record(&existing, apy_bp, now_ms);
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
        let unstake_val = parse_yocto(&amount);
        require!(unstake_val > 0, "STAKE_INSUFFICIENT_BALANCE: amount must be > 0");

        let key = pos_key(&account_id, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let mut next = project_record(&existing, apy_bp, now_ms);
        require!(
            next.staked >= unstake_val,
            "STAKE_INSUFFICIENT_BALANCE: insufficient staked NEAR"
        );
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

        let key = pos_key(&account_id, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let mut next = project_record(&existing, apy_bp, now_ms);
        require!(
            next.withdrawable > 0,
            "STAKE_INSUFFICIENT_BALANCE: no withdrawable NEAR available"
        );
        let payout = next.withdrawable.saturating_add(next.rewards);
        let recipient = recipient_id.unwrap_or_else(|| account_id.clone());
        let cur_rec = self.balances.get(&recipient).copied().unwrap_or(0);
        self.balances.insert(recipient.clone(), cur_rec.saturating_add(payout));

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
        let key = pos_key(&account_id, &pool_id);
        let existing = self.positions.get(&key).cloned().unwrap_or_default();
        let projected = if self.positions.contains_key(&key) {
            project_record(&existing, apy_bp, now_ms)
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(predecessor: &str) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(predecessor.parse().unwrap());
        builder
    }

    #[test]
    fn stake_unstake_unbonding_rewards_and_withdraw_flow() {
        testing_env!(ctx("minter.terraagent.testnet").build());
        let mut contract = StakingVaultContract::new(
            "terraagent.testnet".parse().unwrap(),
            "minter.terraagent.testnet".parse().unwrap(),
        );
        let ten_near = "10000000000000000000000000".to_string();
        let four_near = "4000000000000000000000000".to_string();
        let six_near = "6000000000000000000000000".to_string();

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

        // Unstake after 10 game days -> accrues rewards.
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
    }

    #[test]
    #[should_panic(expected = "STAKE_INSUFFICIENT_BALANCE")]
    fn withdraw_before_unbonding_panics() {
        testing_env!(ctx("minter.terraagent.testnet").build());
        let mut contract = StakingVaultContract::new(
            "terraagent.testnet".parse().unwrap(),
            "minter.terraagent.testnet".parse().unwrap(),
        );
        let ten_near = "10000000000000000000000000".to_string();
        contract.credit_near("op-fund".into(), "col1.testnet".into(), ten_near.clone());
        let t0 = 1_700_000_000_000u64;
        contract.stake("op-s".into(), "col1.testnet".into(), None, "p1".into(), 900, ten_near.clone(), t0);
        contract.unstake("op-u".into(), "col1.testnet".into(), "p1".into(), 900, ten_near, t0);
        contract.withdraw("op-w".into(), "col1.testnet".into(), None, "p1".into(), 900, t0 + 1000);
    }
}
