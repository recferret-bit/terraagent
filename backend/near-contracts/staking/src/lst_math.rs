//! Pure share-price ("Option A") accounting math and LST contract whitelist.
use crate::fees::bp_of;
use crate::mathx::mul_div_ceil;

/// One whole LST share in share units; a price of `PRICE_ONE` means 1 share == 1 NEAR.
pub const PRICE_ONE: u128 = 1_000_000_000_000_000_000_000_000;

pub(crate) fn is_whitelisted_lst(contract_id: &str, owner_id: &str) -> bool {
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

/// Weighted entry price after adding `added` shares at `price` to `prior` shares at `entry`.
/// `0` (simulated APY) is sticky for legacy positions; rounding goes against the staker.
pub(crate) fn weighted_entry(entry: u128, prior: u128, added: u128, price: u128) -> u128 {
    if price == 0 {
        return entry;
    }
    if prior == 0 {
        return price;
    }
    if entry == 0 {
        return 0;
    }
    if entry == price {
        return entry;
    }
    let total = prior.saturating_add(added);
    let a = mul_div_ceil(prior, entry, total).unwrap_or(entry);
    let b = mul_div_ceil(added, price, total).unwrap_or(price);
    a.saturating_add(b)
}

#[derive(Debug, PartialEq, Eq)]
pub struct Realized {
    pub staked: u128,
    pub staker: u128,
    pub protocol: u128,
    pub entry: u128,
}

/// Books the share appreciation since `entry` as yield. `staked == principal + staker + protocol`.
pub fn realize(staked: u128, entry: u128, price: u128, protocol_bp: u32) -> Realized {
    let idle = Realized { staked, staker: 0, protocol: 0, entry };
    if staked == 0 || entry == 0 || price <= entry {
        return idle;
    }
    let principal = mul_div_ceil(staked, entry, price).unwrap_or(staked).min(staked);
    let yielded = staked - principal;
    let protocol = bp_of(yielded, protocol_bp);
    Realized { staked: principal, staker: yielded - protocol, protocol, entry: price }
}
