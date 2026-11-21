use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn ctx(predecessor: &str) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder.predecessor_account_id(predecessor.parse().unwrap());
    builder
}

fn new_contract() -> TreasuryDaoContract {
    testing_env!(ctx("terraagent.testnet").build());
    TreasuryDaoContract::new(
        "terraagent.testnet".parse().unwrap(),
        "minter.terraagent.testnet".parse().unwrap(),
    )
}

#[test]
fn dao_lifecycle_deposit_propose_vote_and_finalize() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());

    // Deduplicates duplicate council member IDs on create_dao
    let dao_id = contract.create_dao(
        "op-create".into(),
        "kepler.dao.mock".into(),
        "kepler".into(),
        vec!["a.mock".into(), "b.mock".into(), "c.mock".into(), "a.mock".into()],
    );
    assert_eq!(dao_id, "kepler.dao.mock");
    assert_eq!(contract.get_dao(dao_id.clone()).members.len(), 3);

    contract.deposit("op-dep".into(), dao_id.clone(), "a.mock".into(), "metals.t1".into(), "500".into());
    // Idempotent deposit replay
    contract.deposit("op-dep".into(), dao_id.clone(), "a.mock".into(), "metals.t1".into(), "500".into());
    assert_eq!(contract.get_dao(dao_id.clone()).balances.get("metals.t1").map(String::as_str), Some("500"));

    let pid = contract.propose(
        "op-prop".into(),
        dao_id.clone(),
        "a.mock".into(),
        "Shield".into(),
        "meteor_shield".into(),
        r#"{"cost":"150","tokenId":"metals.t1"}"#.into(),
        Some("150".into()),
        Some("metals.t1".into()),
    );
    assert_eq!(pid, 0);

    let s1 = contract.vote("op-v1".into(), dao_id.clone(), pid, "a.mock".into(), "approve".into(), None, None);
    assert_eq!(s1, "InProgress");
    let s2 = contract.vote("op-v2".into(), dao_id.clone(), pid, "b.mock".into(), "approve".into(), None, None);
    assert_eq!(s2, "Approved");

    let view = contract.get_dao(dao_id.clone());
    assert_eq!(view.balances.get("metals.t1").map(String::as_str), Some("350"));
    assert_eq!(view.proposals[0].status, "Approved");

    // Second proposal expires on finalize
    let pid2 = contract.propose(
        "op-prop-2".into(),
        dao_id.clone(),
        "a.mock".into(),
        "Pulse".into(),
        "orbital_pulse".into(),
        "{}".into(),
        None,
        None,
    );
    contract.vote("op-v3".into(), dao_id.clone(), pid2, "a.mock".into(), "approve".into(), None, None);
    let fin = contract.finalize("op-fin".into(), dao_id.clone(), pid2, None, None);
    assert_eq!(fin, "Expired");

    // Exact balance exhaustion removes zero-balance token entry cleanly
    let pid3 = contract.propose(
        "op-prop-3".into(),
        dao_id.clone(),
        "a.mock".into(),
        "Drain".into(),
        "meteor_shield".into(),
        "{}".into(),
        Some("350".into()),
        Some("metals.t1".into()),
    );
    contract.vote("op-v4".into(), dao_id.clone(), pid3, "a.mock".into(), "approve".into(), None, None);
    contract.vote("op-v5".into(), dao_id.clone(), pid3, "b.mock".into(), "approve".into(), None, None);
    assert_eq!(contract.get_dao(dao_id).balances.get("metals.t1"), None);
}

#[test]
fn member_management_quorum_and_operator_rotation() {
    let mut contract = new_contract();
    assert_eq!(contract.get_owner().as_str(), "terraagent.testnet");
    assert_eq!(contract.get_operator().as_str(), "minter.terraagent.testnet");

    contract.set_operator("op2.terraagent.testnet".parse().unwrap());
    assert_eq!(contract.get_operator().as_str(), "op2.terraagent.testnet");

    testing_env!(ctx("op2.terraagent.testnet").build());
    let dao_id = contract.create_dao(
        "op-c".into(),
        "council.dao".into(),
        "   ".into(),
        vec!["a.mock".into(), "b.mock".into(), "c.mock".into(), "d.mock".into()],
    );
    assert_eq!(contract.get_dao(dao_id.clone()).name, "dao");

    // Add observer member with can_propose: false, then remove d.mock
    assert!(contract.add_member("op-add".into(), dao_id.clone(), "obs.mock".into(), Some(false)));
    assert!(contract.remove_member("op-rem".into(), dao_id.clone(), "d.mock".into()));
    assert!(!contract.remove_member("op-rem-miss".into(), dao_id.clone(), "nobody.mock".into()));

    // With 4 members (a, b, c, obs), 2 yes + 0 no passes via `yes >= pass_min_yes && no == 0`!
    let pid = contract.propose("op-p1".into(), dao_id.clone(), "a.mock".into(), "x".into(), "x".into(), "{}".into(), None, None);
    contract.vote("op-v1".into(), dao_id.clone(), pid, "a.mock".into(), "approve".into(), None, None);
    let status = contract.vote("op-v2".into(), dao_id.clone(), pid, "b.mock".into(), "approve".into(), None, None);
    assert_eq!(status, "Approved");

    // If 1 no vote is cast first on 4 members, 2 yes is only 50% (not > 5000 bp) and `no > 0`, so stays InProgress until 3rd yes!
    let pid2 = contract.propose("op-p2".into(), dao_id.clone(), "a.mock".into(), "y".into(), "y".into(), "{}".into(), None, None);
    contract.vote("op-v3".into(), dao_id.clone(), pid2, "obs.mock".into(), "reject".into(), None, None);
    contract.vote("op-v4".into(), dao_id.clone(), pid2, "a.mock".into(), "approve".into(), None, None);
    let mid = contract.vote("op-v5".into(), dao_id.clone(), pid2, "b.mock".into(), "approve".into(), None, None);
    assert_eq!(mid, "InProgress");
    let passed = contract.vote("op-v6".into(), dao_id, pid2, "c.mock".into(), "approve".into(), None, None);
    assert_eq!(passed, "Approved");
}

#[test]
#[should_panic(expected = "NOT_A_MEMBER: member is not allowed to propose")]
fn blocks_member_without_propose_permission() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao("op-c".into(), "c.dao".into(), "c".into(), vec!["a.mock".into()]);
    contract.add_member("op-m".into(), dao_id.clone(), "obs.mock".into(), Some(false));
    contract.propose("op-p".into(), dao_id, "obs.mock".into(), "x".into(), "x".into(), "{}".into(), None, None);
}

#[test]
#[should_panic(expected = "ALREADY_VOTED")]
fn double_vote_panics() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao("op-c".into(), "c.dao.mock".into(), "c".into(), vec!["a.mock".into(), "b.mock".into(), "c.mock".into()]);
    let pid = contract.propose("op-p".into(), dao_id.clone(), "a.mock".into(), "x".into(), "x".into(), "{}".into(), None, None);
    contract.vote("op-v1".into(), dao_id.clone(), pid, "a.mock".into(), "approve".into(), None, None);
    contract.vote("op-v2".into(), dao_id, pid, "a.mock".into(), "reject".into(), None, None);
}

#[test]
#[should_panic(expected = "INVALID_VOTE")]
fn rejects_invalid_vote_choice() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao("op-c".into(), "c.dao".into(), "c".into(), vec!["a.mock".into(), "b.mock".into()]);
    let pid = contract.propose("op-p".into(), dao_id.clone(), "a.mock".into(), "x".into(), "x".into(), "{}".into(), None, None);
    contract.vote("op-v".into(), dao_id, pid, "a.mock".into(), "abstain".into(), None, None);
}

#[test]
#[should_panic(expected = "PROPOSAL_CLOSED")]
fn rejects_vote_on_closed_proposal() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao("op-c".into(), "c.dao".into(), "c".into(), vec!["a.mock".into(), "b.mock".into()]);
    let pid = contract.propose("op-p".into(), dao_id.clone(), "a.mock".into(), "x".into(), "x".into(), "{}".into(), None, None);
    contract.finalize("op-f".into(), dao_id.clone(), pid, None, None);
    contract.vote("op-v".into(), dao_id, pid, "a.mock".into(), "approve".into(), None, None);
}

#[test]
#[should_panic(expected = "TREASURY_INSUFFICIENT")]
fn rejects_proposal_exceeding_treasury() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao("op-c".into(), "c.dao".into(), "c".into(), vec!["a.mock".into()]);
    contract.deposit("op-d".into(), dao_id.clone(), "a.mock".into(), "metals.t1".into(), "50".into());
    contract.propose("op-p".into(), dao_id, "a.mock".into(), "x".into(), "x".into(), "{}".into(), Some("51".into()), Some("metals.t1".into()));
}

#[test]
#[should_panic(expected = "TREASURY_OVERFLOW")]
fn rejects_treasury_deposit_overflow() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao("op-c".into(), "c.dao".into(), "c".into(), vec!["a.mock".into()]);
    contract.deposit("op-d1".into(), dao_id.clone(), "a.mock".into(), "metals.t1".into(), u128::MAX.to_string());
    contract.deposit("op-d2".into(), dao_id, "a.mock".into(), "metals.t1".into(), "1".into());
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn rejects_unauthorized_caller() {
    let mut contract = new_contract();
    testing_env!(ctx("attacker.testnet").build());
    contract.create_dao("op-c".into(), "c.dao".into(), "c".into(), vec![]);
}

#[test]
#[should_panic(expected = "INVALID_QUORUM")]
fn rejects_quorum_above_10000_bp() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao("op-c".into(), "c.dao".into(), "c".into(), vec!["a.mock".into(), "b.mock".into()]);
    let pid = contract.propose("op-p".into(), dao_id.clone(), "a.mock".into(), "x".into(), "x".into(), "{}".into(), None, None);
    contract.vote("op-v".into(), dao_id, pid, "a.mock".into(), "approve".into(), Some(10_001), None);
}

#[test]
fn council_members_can_propose_and_vote_directly_without_operator() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao(
        "op-dir-c".into(),
        "ocean.dao.terraagent.testnet".into(),
        "Ocean Council".into(),
        vec!["alice.testnet".into(), "bob.testnet".into()],
    );

    testing_env!(ctx("alice.testnet").build());
    let pid = contract.propose(
        "op-dir-p".into(),
        dao_id.clone(),
        "alice.testnet".into(),
        "Shield Upgrade".into(),
        "shield".into(),
        "{}".into(),
        None,
        None,
    );
    assert_eq!(
        contract.vote("op-dir-v1".into(), dao_id.clone(), pid, "alice.testnet".into(), "approve".into(), None, None),
        "InProgress"
    );

    testing_env!(ctx("bob.testnet").build());
    assert_eq!(
        contract.vote("op-dir-v2".into(), dao_id, pid, "bob.testnet".into(), "approve".into(), None, None),
        "Approved"
    );
}

#[test]
#[should_panic(expected = "only operator may override quorum parameters")]
fn blocks_council_member_from_overriding_quorum_to_self_approve_proposal() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao(
        "op-q-c".into(),
        "dune.dao.terraagent.testnet".into(),
        "Dune Council".into(),
        vec!["alice.testnet".into(), "bob.testnet".into(), "carol.testnet".into()],
    );

    testing_env!(ctx("alice.testnet").build());
    let pid = contract.propose(
        "op-q-p".into(),
        dao_id.clone(),
        "alice.testnet".into(),
        "Drain treasury".into(),
        "guild_subsidy".into(),
        "{}".into(),
        None,
        None,
    );
    contract.vote(
        "op-q-v".into(),
        dao_id,
        pid,
        "alice.testnet".into(),
        "approve".into(),
        Some(0),
        Some(1),
    );
}

#[test]
fn weighted_vote_1_5x_archon_breaks_4_member_deadlock_and_rejects_non_operator_weight_spoof() {
    let mut contract = new_contract();
    testing_env!(ctx("minter.terraagent.testnet").build());
    let dao_id = contract.create_dao(
        "op-w-create".into(),
        "archon.dao.testnet".into(),
        "Archon Council".into(),
        vec!["archon.testnet".into(), "ally.testnet".into(), "nay.testnet".into(), "silent.testnet".into()],
    );
    let pid = contract.propose(
        "op-w-prop".into(),
        dao_id.clone(),
        "archon.testnet".into(),
        "Shield".into(),
        "meteor_shield".into(),
        "{}".into(),
        None,
        None,
    );
    // One reject blocks the `yes >= 2 && no == 0` clause; 2 unweighted yes votes would be 20_000 == 5_000 * 4 (not >).
    assert_eq!(contract.vote("op-w-nay".into(), dao_id.clone(), pid, "nay.testnet".into(), "reject".into(), None, None), "InProgress");
    // Non-operator cannot spoof `weight_bp` on `vote_weighted`.
    testing_env!(ctx("archon.testnet").build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.vote_weighted("op-w-spoof".into(), dao_id.clone(), pid, "archon.testnet".into(), "approve".into(), Some(15_000), None, None);
    })).is_err());

    // Operator records Tier 3+ 1.5x (15_000 bp) + 1.0x (10_000 bp) = 25_000 > 20_000 -> Approved!
    testing_env!(ctx("minter.terraagent.testnet").build());
    assert_eq!(
        contract.vote_weighted("op-w-archon".into(), dao_id.clone(), pid, "archon.testnet".into(), "approve".into(), Some(15_000), None, None),
        "InProgress"
    );
    assert_eq!(
        contract.vote("op-w-ally".into(), dao_id.clone(), pid, "ally.testnet".into(), "approve".into(), None, None),
        "Approved"
    );
    assert_eq!(contract.get_dao_weights(dao_id).get("0:archon.testnet").copied(), Some(15_000));
}
