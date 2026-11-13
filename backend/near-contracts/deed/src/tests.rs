use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn set_caller(predecessor: &str, ts_ms: u64) {
    let ctx = VMContextBuilder::new()
        .predecessor_account_id(acct(predecessor))
        .block_timestamp(ts_ms * 1_000_000)
        .build();
    testing_env!(ctx);
}

#[test]
fn mint_update_settle_and_idempotency() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));

    set_caller("op.testnet", 2_000);
    let minted = c.mint_deed(
        "op_m1".into(),
        "deed".into(),
        "deed:col_0".into(),
        acct("pilot.testnet"),
        r#"{"stage":1,"settled":false,"version":1}"#.into(),
        false,
    );
    assert_eq!(minted.version, 1);
    assert!(!minted.settled);

    // Idempotent retry returns same deed at version 1
    let retry = c.mint_deed(
        "op_m1".into(),
        "deed".into(),
        "deed:col_0".into(),
        acct("pilot.testnet"),
        r#"{"stage":1}"#.into(),
        false,
    );
    assert_eq!(retry.version, 1);

    set_caller("op.testnet", 5_000);
    let settled = c.update_metadata(
        "op_u1".into(),
        "deed:col_0".into(),
        r#"{"stage":4,"settled":true,"status":"settled","version":2}"#.into(),
        true,
        None,
    );
    assert_eq!(settled.version, 2);
    assert!(settled.settled);
    assert_eq!(settled.history.len(), 2);

    // Replay update_metadata returns version 2 without appending duplicate history
    let replay_upd = c.update_metadata(
        "op_u1".into(),
        "deed:col_0".into(),
        r#"{"stage":4}"#.into(),
        true,
        None,
    );
    assert_eq!(replay_upd.version, 2);
    assert_eq!(replay_upd.history.len(), 2);

    // Subsequent milestone update without explicit_unsettle preserves settled: true
    let post = c.update_metadata(
        "op_u2".into(),
        "deed:col_0".into(),
        r#"{"stage":4,"badges":2}"#.into(),
        false,
        None,
    );
    assert_eq!(post.version, 3);
    assert!(post.settled);

    assert_eq!(c.owner_of("deed:col_0".into()), Some(acct("pilot.testnet")));
    let nft = c.nft_token("deed:col_0".into()).unwrap();
    assert_eq!(
        nft.metadata.description.as_deref(),
        Some("Settled Living Planet Colony Deed (Stage 4)")
    );
}

#[test]
fn multiple_deeds_and_badges_per_owner_and_metadata_views() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));
    assert_eq!(c.get_owner(), acct("owner.testnet"));
    assert_eq!(c.get_operator(), acct("op.testnet"));
    assert_eq!(c.nft_metadata().symbol, "DEED");

    c.set_operator(acct("op2.testnet"));
    assert_eq!(c.get_operator(), acct("op2.testnet"));

    set_caller("op2.testnet", 2_000);
    c.mint_deed("op_1".into(), "deed".into(), "deed:col_0".into(), acct("pilot.testnet"), "{}".into(), false);
    c.mint_deed("op_2".into(), "badge".into(), "badge:first_drop".into(), acct("pilot.testnet"), "{}".into(), false);

    let tokens = c.nft_tokens_for_owner(acct("pilot.testnet"));
    assert_eq!(tokens.len(), 2);
    assert!(c.nft_tokens_for_owner(acct("nobody.testnet")).is_empty());
    assert!(c.get_deed("missing".into()).is_none());
}

#[test]
#[should_panic(expected = "settled Colony Deed cannot be unsettled")]
fn blocks_unsettling_a_settled_deed() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet", 2_000);
    c.mint_deed(
        "op_m1".into(),
        "deed".into(),
        "deed:col_1".into(),
        acct("pilot.testnet"),
        "{}".into(),
        true,
    );
    c.update_metadata("op_u2".into(), "deed:col_1".into(), "{}".into(), false, Some(true));
}

#[test]
#[should_panic(expected = "NEAR_NFT_SOULBOUND")]
fn blocks_transfer_of_soulbound_deed() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));
    c.nft_transfer(acct("other.testnet"), "deed:col_0".into());
}

#[test]
#[should_panic(expected = "NEAR_NFT_ALREADY_MINTED")]
fn rejects_duplicate_token_id_with_different_op() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet", 2_000);
    c.mint_deed("op_1".into(), "deed".into(), "deed:dup".into(), acct("pilot.testnet"), "{}".into(), false);
    c.mint_deed("op_2".into(), "deed".into(), "deed:dup".into(), acct("pilot.testnet"), "{}".into(), false);
}

#[test]
#[should_panic(expected = "NEAR_NFT_NOT_FOUND")]
fn rejects_update_on_missing_deed() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet", 2_000);
    c.update_metadata("op_u".into(), "deed:missing".into(), "{}".into(), false, None);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn rejects_unauthorized_mint() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("attacker.testnet", 2_000);
    c.mint_deed("op_bad".into(), "deed".into(), "deed:1".into(), acct("attacker.testnet"), "{}".into(), false);
}

#[test]
#[should_panic(expected = "NEAR_NFT_INVALID: token_id required")]
fn rejects_empty_token_id() {
    set_caller("owner.testnet", 1_000);
    let mut c = DeedContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet", 2_000);
    c.mint_deed("op_1".into(), "deed".into(), "".into(), acct("pilot.testnet"), "{}".into(), false);
}
