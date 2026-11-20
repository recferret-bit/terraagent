//! Raw-key storage helpers. Everything here lives under keys disjoint from the Borsh contract state
//! (`b`, `p`, `o` prefixes), so state upgrades from earlier deployments stay 100 % compatible.
use near_sdk::{env, require};

pub(crate) fn read_u128_key(key: &[u8]) -> u128 {
    match env::storage_read(key) {
        Some(bytes) if bytes.len() == 16 => {
            let mut arr = [0u8; 16];
            arr.copy_from_slice(&bytes);
            u128::from_le_bytes(arr)
        }
        _ => 0,
    }
}

pub(crate) fn write_u128_key(key: &[u8], val: u128) {
    if val == 0 {
        env::storage_remove(key);
    } else {
        env::storage_write(key, &val.to_le_bytes());
    }
}

pub(crate) fn pos_key(account_id: &str, pool_id: &str) -> String {
    format!("{}::{}", account_id, pool_id)
}

fn pos_ndep_key(account_id: &str, pool_id: &str) -> Vec<u8> {
    format!("pndep:{}|{}", account_id, pool_id).into_bytes()
}

pub(crate) fn read_pos_ndep(account_id: &str, pool_id: &str) -> u128 {
    read_u128_key(&pos_ndep_key(account_id, pool_id))
}

pub(crate) fn write_pos_ndep(account_id: &str, pool_id: &str, val: u128) {
    write_u128_key(&pos_ndep_key(account_id, pool_id), val);
}

const YIELD_RESERVE_KEY: &[u8] = b"ynative:pool";

pub(crate) fn read_yield_reserve() -> u128 {
    read_u128_key(YIELD_RESERVE_KEY)
}

pub(crate) fn write_yield_reserve(val: u128) {
    write_u128_key(YIELD_RESERVE_KEY, val);
}

fn native_dep_key(account_id: &str) -> Vec<u8> {
    format!("ndep:{}", account_id).into_bytes()
}

pub(crate) fn read_native_dep(account_id: &str) -> u128 {
    read_u128_key(&native_dep_key(account_id))
}

pub(crate) fn write_native_dep(account_id: &str, val: u128) {
    write_u128_key(&native_dep_key(account_id), val);
}

pub(crate) fn parse_yocto(raw: &str) -> u128 {
    raw.parse::<u128>()
        .expect("STAKE_INSUFFICIENT_BALANCE: invalid yoctoNEAR amount")
}

pub(crate) fn validate_pool_and_apy(pool_id: &str, apy_bp: u32) {
    require!(!pool_id.trim().is_empty(), "STAKE_INVALID_POOL: pool_id required");
    require!(
        !pool_id.contains('|') && !pool_id.contains("::"),
        "STAKE_INVALID_POOL: pool_id cannot contain key delimiters"
    );
    require!(apy_bp <= crate::MAX_APY_BP, "STAKE_INVALID_APY: apy_bp exceeds 5000 bp");
}

pub(crate) fn validate_target_account(account_id: &str) {
    require!(
        !account_id.trim().is_empty() && !account_id.contains('|') && !account_id.contains("::"),
        "STAKE_INSUFFICIENT_BALANCE: invalid account_id"
    );
}
