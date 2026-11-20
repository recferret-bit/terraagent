//! One place that advances a position to `now_ms`: simulated APY (mock / testnet) or share-price
//! realisation (Option A), plus unbonding maturity. `settle_pure` is read-only; `apply_settled` books
//! the protocol cut and the entry-price checkpoint.
use crate::accrual::{project_record, read_protocol_yield_bp};
use crate::lst::{self, realize};
use crate::positions::{read_meta, write_meta, PositionMeta};
use crate::storage::pos_key;
use crate::{StakingRecord, StakingVaultContract};

pub(crate) struct Settled {
    pub record: StakingRecord,
    /// Protocol cut in yocto-NEAR (simulated-APY path), credited to `protocol.<owner>`.
    pub native_cut: u128,
    /// Protocol cut in LST shares (price mode), credited to the pool's protocol share balance.
    pub lst_cut: u128,
    pub meta: Option<PositionMeta>,
    pub price_mode: bool,
}

impl StakingVaultContract {
    pub(crate) fn settle_pure(&self, account_id: &str, pool_id: &str, apy_bp: u32, now_ms: u64) -> Settled {
        let existing = self.positions.get(&pos_key(account_id, pool_id)).cloned().unwrap_or_default();
        let mut meta = read_meta(account_id, pool_id);
        let yield_bp = read_protocol_yield_bp();
        let price = lst::read_price(pool_id);
        let in_price_mode = price > 0 && meta.as_ref().is_some_and(|m| m.entry_lst_price_yocto > 0);
        if !in_price_mode {
            let (record, native_cut) = project_record(&existing, apy_bp, now_ms, yield_bp);
            return Settled { record, native_cut, lst_cut: 0, meta, price_mode: false };
        }
        // Maturity only (apy 0); yield comes from the share price.
        let (mut record, _) = project_record(&existing, 0, now_ms, yield_bp);
        let m = meta.as_mut().expect("price mode implies meta");
        let r = realize(record.staked, m.entry_lst_price_yocto, price, yield_bp);
        record.staked = r.staked;
        record.rewards = record.rewards.saturating_add(r.staker);
        m.entry_lst_price_yocto = r.entry;
        Settled { record, native_cut: 0, lst_cut: r.protocol, meta, price_mode: true }
    }

    pub(crate) fn apply_settled(&mut self, account_id: &str, pool_id: &str, settled: &Settled) {
        self.credit_protocol_yield(settled.native_cut);
        if settled.lst_cut > 0 {
            self.credit_protocol_for_pool(pool_id, settled.lst_cut);
        }
        if let Some(meta) = &settled.meta {
            if settled.price_mode {
                write_meta(account_id, pool_id, meta);
            }
        }
    }
}
