use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
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
fn partial_refund_then_claim_and_idempotency() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));

    set_caller("op.testnet");
    let opened = c.open_escrow(
        "op_open_1".into(),
        "escrow_1".into(),
        acct("col1.testnet"),
        "escrow:00112233445566778899aabbccddeeff".into(),
        "metals.t1".into(),
        "1000".into(),
        0,
    );
    assert_eq!(opened.status, "open");
    assert_eq!(opened.amount, "1000");

    // Partial refund of 400 leaves 600 open (W22-28)
    let part = c.refund_escrow(
        "op_ref_part".into(),
        "escrow_1".into(),
        acct("col1.testnet"),
        Some("400".into()),
    );
    assert_eq!(part.status, "open");
    assert_eq!(part.amount, "600");

    // Claim settles the remaining 600
    let claimed = c.claim_escrow("op_claim_1".into(), "escrow_1".into(), acct("merc.testnet"));
    assert_eq!(claimed.status, "claimed");
    assert_eq!(claimed.amount, "600");

    // Duplicate op_id is idempotent
    let dup = c.claim_escrow("op_claim_1".into(), "escrow_1".into(), acct("merc.testnet"));
    assert_eq!(dup.status, "claimed");
}

#[test]
fn full_refund_closes_row_preserving_amount() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow(
        "op_open_2".into(),
        "escrow_2".into(),
        acct("col1.testnet"),
        "escrow:00112233445566778899aabbccddeeff".into(),
        "metals.t1".into(),
        "500".into(),
        0,
    );
    let closed = c.refund_escrow("op_ref_all".into(), "escrow_2".into(), acct("col1.testnet"), None);
    assert_eq!(closed.status, "refunded");
    assert_eq!(closed.amount, "500");
}

#[test]
fn slash_escrow_splits_90_10_and_replays_idempotently() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow(
        "op_war_open".into(),
        "escrow_war_1".into(),
        acct("attacker.testnet"),
        "escrow:00112233445566778899aabbccddeeff".into(),
        "metals.t1".into(),
        "1000".into(),
        0,
    );
    let slashed = c.slash_escrow(
        "op_war_slash".into(),
        "escrow_war_1".into(),
        acct("defender.testnet"),
        acct("protocol.terraagent.testnet"),
        1_000,
    );
    assert_eq!(slashed.status, "slashed");
    assert_eq!(slashed.amount, "1000");

    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("\"victim_amount\":\"900\"") && l.contains("\"protocol_amount\":\"100\"")));

    let replay = c.slash_escrow(
        "op_war_slash".into(),
        "escrow_war_1".into(),
        acct("defender.testnet"),
        acct("protocol.terraagent.testnet"),
        1_000,
    );
    assert_eq!(replay.status, "slashed");
}

#[test]
fn slash_escrow_conserves_odd_yocto_and_u128_max_boundary() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");

    // 1 base unit at 10% protocol fee -> protocol gets floor(0.1) = 0, victim gets 1.
    c.open_escrow("op_o_1".into(), "esc_1".into(), acct("a.testnet"), "escrow:1".into(), "near".into(), "1".into(), 0);
    c.slash_escrow("op_s_1".into(), "esc_1".into(), acct("b.testnet"), acct("protocol.testnet"), 1_000);
    let logs_1 = get_logs();
    assert!(logs_1.iter().any(|l| l.contains("\"victim_amount\":\"1\"") && l.contains("\"protocol_amount\":\"0\"")));

    // u128::MAX at 10% protocol fee -> must NOT overflow `rec.amount * protocol_fee_bp`!
    c.open_escrow(
        "op_o_max".into(),
        "esc_max".into(),
        acct("a.testnet"),
        "escrow:max".into(),
        "near".into(),
        u128::MAX.to_string(),
        0,
    );
    let slashed = c.slash_escrow("op_s_max".into(), "esc_max".into(), acct("b.testnet"), acct("protocol.testnet"), 1_000);
    assert_eq!(slashed.status, "slashed");
    let expected_proto = (u128::MAX / 10_000) * 1_000 + ((u128::MAX % 10_000) * 1_000) / 10_000;
    let expected_victim = u128::MAX - expected_proto;
    let logs_max = get_logs();
    assert!(logs_max.iter().any(|l| l.contains(&format!("\"victim_amount\":\"{}\"", expected_victim))
        && l.contains(&format!("\"protocol_amount\":\"{}\"", expected_proto))));
}

#[test]
fn slash_escrow_boundary_fee_0_and_10000_bp() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");

    c.open_escrow("op_o0".into(), "esc_0".into(), acct("a.testnet"), "escrow:0".into(), "metals.t1".into(), "500".into(), 0);
    c.slash_escrow("op_s0".into(), "esc_0".into(), acct("b.testnet"), acct("protocol.testnet"), 0);
    assert!(get_logs().iter().any(|l| l.contains("\"victim_amount\":\"500\"") && l.contains("\"protocol_amount\":\"0\"")));

    c.open_escrow("op_o10k".into(), "esc_10k".into(), acct("a.testnet"), "escrow:10k".into(), "metals.t1".into(), "500".into(), 0);
    c.slash_escrow("op_s10k".into(), "esc_10k".into(), acct("b.testnet"), acct("protocol.testnet"), 10_000);
    assert!(get_logs().iter().any(|l| l.contains("\"victim_amount\":\"0\"") && l.contains("\"protocol_amount\":\"500\"")));
}

#[test]
fn owner_rotates_operator_and_views_work() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    assert_eq!(c.get_owner(), acct("owner.testnet"));
    assert_eq!(c.get_operator(), acct("op.testnet"));
    assert_eq!(c.get_escrow("missing".into()), None);

    c.set_operator(acct("op2.testnet"));
    assert_eq!(c.get_operator(), acct("op2.testnet"));
}

#[test]
#[should_panic(expected = "NEAR_ESCROW_INVALID: protocol_fee_bp")]
fn slash_escrow_rejects_fee_above_10000_bp() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow("op_o".into(), "esc_bad_bp".into(), acct("a.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
    c.slash_escrow("op_s".into(), "esc_bad_bp".into(), acct("b.testnet"), acct("protocol.testnet"), 10_001);
}

#[test]
#[should_panic(expected = "NEAR_ESCROW_INVALID_VICTIM")]
fn slash_escrow_rejects_self_victim_equal_to_funder() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow("op_o".into(), "esc_self".into(), acct("attacker.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
    c.slash_escrow("op_s".into(), "esc_self".into(), acct("attacker.testnet"), acct("protocol.testnet"), 1_000);
}

#[test]
#[should_panic(expected = "NEAR_ESCROW_INVALID_VICTIM: protocol cannot equal funder")]
fn slash_escrow_rejects_protocol_equal_to_funder() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow("op_o".into(), "esc_sp".into(), acct("attacker.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
    c.slash_escrow("op_s".into(), "esc_sp".into(), acct("defender.testnet"), acct("attacker.testnet"), 1_000);
}

#[test]
#[should_panic(expected = "NEAR_ESCROW_STATE")]
fn rejects_double_claim_with_new_op() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow(
        "op_o3".into(),
        "escrow_3".into(),
        acct("col1.testnet"),
        "escrow:00112233445566778899aabbccddeeff".into(),
        "metals.t1".into(),
        "500".into(),
        0,
    );
    c.claim_escrow("op_c3".into(), "escrow_3".into(), acct("merc.testnet"));
    c.claim_escrow("op_c4".into(), "escrow_3".into(), acct("merc.testnet"));
}

#[test]
#[should_panic(expected = "NEAR_ESCROW_STATE")]
fn slash_escrow_rejects_already_refunded() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow("op_o".into(), "esc_r".into(), acct("a.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
    c.refund_escrow("op_r".into(), "esc_r".into(), acct("a.testnet"), None);
    c.slash_escrow("op_s".into(), "esc_r".into(), acct("b.testnet"), acct("protocol.testnet"), 1_000);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn blocks_funder_from_self_refunding_active_bond() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow(
        "op_war_open_2".into(),
        "escrow_war_2".into(),
        acct("attacker.testnet"),
        "escrow:00112233445566778899aabbccddeeff".into(),
        "metals.t1".into(),
        "1000".into(),
        0,
    );
    set_caller("attacker.testnet");
    c.refund_escrow("op_self_refund".into(), "escrow_war_2".into(), acct("attacker.testnet"), None);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn blocks_unauthorized_slash() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow("op_o".into(), "esc_u".into(), acct("a.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
    set_caller("b.testnet");
    c.slash_escrow("op_s".into(), "esc_u".into(), acct("b.testnet"), acct("protocol.testnet"), 1_000);
}

#[test]
#[should_panic(expected = "NEAR_ESCROW_EXISTS")]
fn rejects_duplicate_escrow_id_under_new_op() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow("op_1".into(), "esc_dup".into(), acct("a.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
    c.open_escrow("op_2".into(), "esc_dup".into(), acct("a.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
}

#[test]
#[should_panic(expected = "NEAR_ESCROW_STATE: refund exceeds remaining hold")]
fn rejects_excess_partial_refund() {
    set_caller("owner.testnet");
    let mut c = BountyEscrowContract::new(acct("owner.testnet"), acct("op.testnet"));
    set_caller("op.testnet");
    c.open_escrow("op_1".into(), "esc_ex".into(), acct("a.testnet"), "escrow:1".into(), "metals.t1".into(), "500".into(), 0);
    c.refund_escrow("op_2".into(), "esc_ex".into(), acct("a.testnet"), Some("501".into()));
}
