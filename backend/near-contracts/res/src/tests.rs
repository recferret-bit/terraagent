use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn set_caller(predecessor: &str) {
    let ctx = VMContextBuilder::new()
        .predecessor_account_id(acct(predecessor))
        .build();
    testing_env!(ctx);
}

#[test]
fn mint_transfer_burn_and_idempotency() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));

    set_caller("minter.testnet");
    assert!(c.mt_mint(
        "op_1".into(),
        acct("col1.testnet"),
        "metals.t1".into(),
        "5000000000000000000".into()
    ));
    assert!(!c.mt_mint(
        "op_1".into(),
        acct("col1.testnet"),
        "metals.t1".into(),
        "5000000000000000000".into()
    ));
    assert_eq!(
        c.mt_balance_of(acct("col1.testnet"), "metals.t1".into()),
        "5000000000000000000"
    );
    assert_eq!(c.mt_total_supply("metals.t1".into()), "5000000000000000000");

    assert!(c.operator_transfer(
        "op_2".into(),
        acct("col1.testnet"),
        acct("col2.testnet"),
        "metals.t1".into(),
        "2000000000000000000".into()
    ));
    // Replay operator_transfer is safe no-op
    assert!(!c.operator_transfer(
        "op_2".into(),
        acct("col1.testnet"),
        acct("col2.testnet"),
        "metals.t1".into(),
        "2000000000000000000".into()
    ));
    assert_eq!(
        c.mt_balance_of(acct("col1.testnet"), "metals.t1".into()),
        "3000000000000000000"
    );
    assert_eq!(
        c.mt_balance_of(acct("col2.testnet"), "metals.t1".into()),
        "2000000000000000000"
    );

    assert!(c.mt_burn(
        "op_3".into(),
        acct("col2.testnet"),
        "metals.t1".into(),
        "1000000000000000000".into()
    ));
    assert!(!c.mt_burn(
        "op_3".into(),
        acct("col2.testnet"),
        "metals.t1".into(),
        "1000000000000000000".into()
    ));
    assert_eq!(
        c.mt_balance_of(acct("col2.testnet"), "metals.t1".into()),
        "1000000000000000000"
    );
    assert_eq!(c.mt_total_supply("metals.t1".into()), "4000000000000000000");
}

#[test]
fn mt_metadata_covers_all_ten_valid_tokens_and_batch_balance_works() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));

    let meta = c.mt_metadata();
    assert_eq!(meta.len(), 10);
    for (idx, tid) in VALID_TOKENS.iter().enumerate() {
        let entry = meta.iter().find(|m| m.token_id == *tid).expect("token missing from mt_metadata");
        assert_eq!(entry.decimals, 18);
        set_caller("minter.testnet");
        assert!(c.mt_mint(
            format!("op_all_{}", idx),
            acct("col1.testnet"),
            (*tid).to_string(),
            ((idx + 1) * 100).to_string(),
        ));
    }

    let batch = c.mt_batch_balance_of(
        acct("col1.testnet"),
        VALID_TOKENS.iter().map(|s| (*s).to_string()).collect(),
    );
    assert_eq!(batch.len(), 10);
    assert_eq!(batch[0], "100");
    assert_eq!(batch[9], "1000");
}

#[test]
fn direct_holder_mt_transfer_and_self_transfer_conservation() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    set_caller("minter.testnet");
    c.mt_mint("op_m".into(), acct("col1.testnet"), "bio.water".into(), "1000".into());

    // Direct holder transfer
    set_caller("col1.testnet");
    c.mt_transfer(acct("col2.testnet"), "bio.water".into(), "400".into(), Some("trade".into()));
    assert_eq!(c.mt_balance_of(acct("col1.testnet"), "bio.water".into()), "600");
    assert_eq!(c.mt_balance_of(acct("col2.testnet"), "bio.water".into()), "400");

    // Self-transfer must conserve balance without creating or destroying tokens
    c.mt_transfer(acct("col1.testnet"), "bio.water".into(), "600".into(), Some("self".into()));
    assert_eq!(c.mt_balance_of(acct("col1.testnet"), "bio.water".into()), "600");
    assert_eq!(c.mt_total_supply("bio.water".into()), "1000");

    // Holder self-burn
    assert!(c.mt_burn("op_hb".into(), acct("col1.testnet"), "bio.water".into(), "200".into()));
    assert_eq!(c.mt_balance_of(acct("col1.testnet"), "bio.water".into()), "400");
    assert_eq!(c.mt_total_supply("bio.water".into()), "800");
}

#[test]
fn owner_rotates_minter_and_views_work() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    assert_eq!(c.get_owner(), acct("owner.testnet"));
    assert_eq!(c.get_minter(), acct("minter.testnet"));
    assert!(c.storage_deposit(None));

    c.set_minter(acct("minter2.testnet"));
    assert_eq!(c.get_minter(), acct("minter2.testnet"));
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn rejects_non_minter_mint() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    set_caller("attacker.testnet");
    c.mt_mint("op_bad".into(), acct("attacker.testnet"), "metals.t1".into(), "100".into());
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn rejects_unauthorized_operator_transfer() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    set_caller("minter.testnet");
    c.mt_mint("op_m".into(), acct("col1.testnet"), "metals.t1".into(), "100".into());
    set_caller("attacker.testnet");
    c.operator_transfer("op_steal".into(), acct("col1.testnet"), acct("attacker.testnet"), "metals.t1".into(), "50".into());
}

#[test]
#[should_panic(expected = "NEAR_INSUFFICIENT_FUNDS")]
fn rejects_overburn() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    set_caller("minter.testnet");
    c.mt_burn("op_over".into(), acct("col1.testnet"), "bio.water".into(), "1".into());
}

#[test]
#[should_panic(expected = "unknown NEP-245 cargo token_id")]
fn rejects_unknown_token_id() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    set_caller("minter.testnet");
    c.mt_mint("op_u".into(), acct("col1.testnet"), "unobtainium.t9".into(), "100".into());
}

#[test]
#[should_panic(expected = "cargo amount must be > 0")]
fn rejects_zero_amount() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    set_caller("minter.testnet");
    c.mt_mint("op_z".into(), acct("col1.testnet"), "metals.t1".into(), "0".into());
}

#[test]
#[should_panic(expected = "ERR_BALANCE_OVERFLOW")]
fn rejects_u128_balance_overflow() {
    set_caller("owner.testnet");
    let mut c = CargoContract::new(acct("owner.testnet"), acct("minter.testnet"));
    set_caller("minter.testnet");
    c.mt_mint("op_max".into(), acct("col1.testnet"), "metals.t1".into(), u128::MAX.to_string());
    c.mt_mint("op_over".into(), acct("col1.testnet"), "metals.t1".into(), "1".into());
}
