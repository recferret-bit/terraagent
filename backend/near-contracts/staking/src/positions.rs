//! Wallet-scoped position metadata (deposit clocks, asset, entry share price) and the
//! `get_account_positions` view.
//!
//! State migration: `StakingRecord` is Borsh state in `LookupMap` and must not grow fields, so all W28
//! data lives under disjoint raw keys (`pmeta:` per position, `pidx:` per wallet). Positions created before
//! this upgrade simply have no `pmeta:` entry: they read as "no deposit clock" (0 bp early-exit fee,
//! grandfathered) and are not listed by `get_account_positions` until the operator calls
//! `register_position` (or the wallet deposits again).
use crate::StakingVaultContractExt;
use crate::accrual::{project_record, read_protocol_yield_bp};
use crate::storage::pos_key;
use crate::{lst, StakingRecord, StakingVaultContract};
use near_sdk::borsh;
use near_sdk::{env, near, require};

pub const NATIVE_ASSET: &str = "NEAR";

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PositionMeta {
    /// Set when a position goes from empty to staked; cleared once everything is unstaked.
    pub staked_since_ms: u64,
    /// Latest deposit time (`stake`, `stake_payable`, LST deposits). `compound_yield` never touches it.
    pub last_staked_at_ms: u64,
    /// `NEAR` or the LST contract id.
    pub asset: String,
    /// Option A: yocto-NEAR value of one whole share (1e24 units) at entry (weighted); `0` = simulated APY.
    pub entry_lst_price_yocto: u128,
}

fn meta_key(account_id: &str, pool_id: &str) -> Vec<u8> {
    format!("pmeta:{}|{}", account_id, pool_id).into_bytes()
}

fn index_key(account_id: &str) -> Vec<u8> {
    format!("pidx:{}", account_id).into_bytes()
}

pub(crate) fn read_meta(account_id: &str, pool_id: &str) -> Option<PositionMeta> {
    let bytes = env::storage_read(&meta_key(account_id, pool_id))?;
    borsh::from_slice(&bytes).ok()
}

pub(crate) fn write_meta(account_id: &str, pool_id: &str, meta: &PositionMeta) {
    env::storage_write(
        &meta_key(account_id, pool_id),
        &borsh::to_vec(meta).expect("meta serialises"),
    );
}

fn read_index(account_id: &str) -> Vec<String> {
    env::storage_read(&index_key(account_id))
        .and_then(|b| borsh::from_slice::<Vec<String>>(&b).ok())
        .unwrap_or_default()
}

fn index_pool(account_id: &str, pool_id: &str) {
    let mut pools = read_index(account_id);
    if !pools.iter().any(|p| p == pool_id) {
        pools.push(pool_id.to_string());
        env::storage_write(
            &index_key(account_id),
            &borsh::to_vec(&pools).expect("index serialises"),
        );
    }
}

/// Records a deposit: bumps `last_staked_at_ms`, starts `staked_since_ms` for an empty position,
/// indexes the pool under the wallet and applies the weighted entry share price.
pub(crate) fn record_deposit(
    account_id: &str,
    pool_id: &str,
    asset: &str,
    now_ms: u64,
    prior_staked: u128,
    added: u128,
    price: u128,
) {
    let mut meta = read_meta(account_id, pool_id).unwrap_or_default();
    if prior_staked == 0 || meta.staked_since_ms == 0 {
        meta.staked_since_ms = now_ms;
    }
    meta.last_staked_at_ms = now_ms;
    meta.asset = asset.to_string();
    meta.entry_lst_price_yocto =
        lst::weighted_entry(meta.entry_lst_price_yocto, prior_staked, added, price);
    write_meta(account_id, pool_id, &meta);
    index_pool(account_id, pool_id);
}

/// Called after an unstake; an emptied position forgets its maturity clocks.
pub(crate) fn record_unstake(account_id: &str, pool_id: &str, remaining_staked: u128) {
    if remaining_staked > 0 {
        return;
    }
    if let Some(mut meta) = read_meta(account_id, pool_id) {
        meta.staked_since_ms = 0;
        meta.last_staked_at_ms = 0;
        write_meta(account_id, pool_id, &meta);
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountPositionView {
    pub account_id: String,
    pub pool_id: String,
    pub asset: String,
    pub staked: String,
    pub unbonding: String,
    pub unbonding_ready_at_ms: Option<u64>,
    pub withdrawable: String,
    pub rewards: String,
    pub staked_since_ms: Option<u64>,
    pub last_staked_at_ms: Option<u64>,
    pub entry_lst_price_yocto: Option<String>,
}

#[near]
impl StakingVaultContract {
    /// Every pool position of a wallet, independent of Colony Deeds. Stored figures are projected to
    /// `now_ms` (default chain time) with `apy_bp` (default `0` = no simulated accrual) when asked.
    pub fn get_account_positions(
        &self,
        account_id: String,
        apy_bp: Option<u32>,
        now_ms: Option<u64>,
    ) -> Vec<AccountPositionView> {
        let now = now_ms.unwrap_or_else(env::block_timestamp_ms);
        let yield_bp = read_protocol_yield_bp();
        read_index(&account_id)
            .into_iter()
            .filter_map(|pool_id| {
                let rec = self.positions.get(&pos_key(&account_id, &pool_id))?.clone();
                let meta = read_meta(&account_id, &pool_id).unwrap_or_default();
                let shown = match apy_bp {
                    Some(apy) if !lst::is_price_mode(&pool_id, &meta) => {
                        project_record(&rec, apy, now, yield_bp).0
                    }
                    _ => rec,
                };
                Some(view_of(&account_id, &pool_id, &shown, &meta))
            })
            .collect()
    }

    /// Operator migration helper: lists a pre-upgrade position under its wallet (and optionally records
    /// the asset and a deposit clock so the early-exit window can apply).
    pub fn register_position(
        &mut self,
        account_id: String,
        pool_id: String,
        asset: Option<String>,
        last_staked_at_ms: Option<u64>,
    ) {
        self.require_operator();
        require!(
            self.positions.contains_key(&pos_key(&account_id, &pool_id)),
            "STAKE_INSUFFICIENT_BALANCE: no such position"
        );
        let mut meta = read_meta(&account_id, &pool_id).unwrap_or_default();
        if let Some(a) = asset {
            meta.asset = a;
        }
        if let Some(ts) = last_staked_at_ms {
            meta.last_staked_at_ms = ts;
            if meta.staked_since_ms == 0 {
                meta.staked_since_ms = ts;
            }
        }
        write_meta(&account_id, &pool_id, &meta);
        index_pool(&account_id, &pool_id);
    }
}

fn view_of(account_id: &str, pool_id: &str, rec: &StakingRecord, meta: &PositionMeta) -> AccountPositionView {
    let opt = |v: u64| if v > 0 { Some(v) } else { None };
    AccountPositionView {
        account_id: account_id.to_string(),
        pool_id: pool_id.to_string(),
        asset: if meta.asset.is_empty() { NATIVE_ASSET.to_string() } else { meta.asset.clone() },
        staked: rec.staked.to_string(),
        unbonding: rec.unbonding.to_string(),
        unbonding_ready_at_ms: rec.unbonding_ready_at_ms,
        withdrawable: rec.withdrawable.to_string(),
        rewards: rec.rewards.to_string(),
        staked_since_ms: opt(meta.staked_since_ms),
        last_staked_at_ms: opt(meta.last_staked_at_ms),
        entry_lst_price_yocto: if meta.entry_lst_price_yocto > 0 {
            Some(meta.entry_lst_price_yocto.to_string())
        } else {
            None
        },
    }
}
