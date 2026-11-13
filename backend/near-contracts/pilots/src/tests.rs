use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

fn account(id: &str) -> AccountId {
    id.parse().unwrap()
}

fn sample_pk() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap()
}

fn setup_ctx_full(current: &str, predecessor: &str, balance_millinear: u128, attached_millinear: u128) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account(current))
        .predecessor_account_id(account(predecessor))
        .account_balance(NearToken::from_millinear(balance_millinear))
        .attached_deposit(NearToken::from_millinear(attached_millinear));
    testing_env!(builder.build());
}

fn setup_ctx(predecessor: &str, attached_millinear: u128) {
    setup_ctx_full("pilots.terraagent.testnet", predecessor, 5_000, attached_millinear);
}

#[test]
fn operator_creates_pilot_subaccount_and_replays_idempotently() {
    setup_ctx("terraagent.testnet", 0);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );

    setup_ctx("relayer.terraagent.testnet", 20);
    let res = contract.create_pilot_account(
        "named-account:google:sub-1".to_string(),
        "alex-pilot".to_string(),
        sample_pk(),
    );
    assert!(matches!(res, PromiseOrValue::Promise(_)));

    // Simulate successful child CreateAccount callback:
    setup_ctx("pilots.terraagent.testnet", 0);
    let committed = contract.on_pilot_created(
        "named-account:google:sub-1".to_string(),
        "alex-pilot".to_string(),
        account("alex-pilot.pilots.terraagent.testnet"),
        String::from(&sample_pk()),
        NearToken::from_millinear(20).as_yoctonear().to_string(),
        Ok(()),
    );
    assert_eq!(committed, "alex-pilot.pilots.terraagent.testnet");
    assert_eq!(
        contract.get_pilot_account("alex-pilot".to_string()),
        Some("alex-pilot.pilots.terraagent.testnet".to_string())
    );
    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("pilot_account_created")));

    setup_ctx("relayer.terraagent.testnet", 20);
    let replay = contract.create_pilot_account(
        "named-account:google:sub-1".to_string(),
        "alex-pilot".to_string(),
        sample_pk(),
    );
    match replay {
        PromiseOrValue::Value(id) => {
            assert_eq!(id, "alex-pilot.pilots.terraagent.testnet");
        }
        PromiseOrValue::Promise(_) => panic!("expected cached Value on idempotent replay"),
    }
}

#[test]
fn accepts_boundary_2_char_and_32_char_labels_and_vault_sponsored_funding() {
    setup_ctx("terraagent.testnet", 0);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );

    // Zero attached deposit uses contract vault liquid balance when well above reserve.
    setup_ctx("relayer.terraagent.testnet", 0);
    let r2 = contract.create_pilot_account("op-2c".into(), "ab".into(), sample_pk());
    assert!(matches!(r2, PromiseOrValue::Promise(_)));

    let label_32 = "a".repeat(32);
    let r32 = contract.create_pilot_account("op-32c".into(), label_32, sample_pk());
    assert!(matches!(r32, PromiseOrValue::Promise(_)));
}

#[test]
#[should_panic(expected = "NEAR_NAME_TAKEN")]
fn rejects_duplicate_label_under_different_op() {
    setup_ctx("relayer.terraagent.testnet", 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-1".into(), "nova".into(), sample_pk());
    setup_ctx("pilots.terraagent.testnet", 0);
    contract.on_pilot_created(
        "op-1".into(),
        "nova".into(),
        account("nova.pilots.terraagent.testnet"),
        String::from(&sample_pk()),
        "20000000000000000000000".into(),
        Ok(()),
    );
    setup_ctx("relayer.terraagent.testnet", 20);
    let _ = contract.create_pilot_account("op-2".into(), "nova".into(), sample_pk());
}

#[test]
fn failed_child_callback_leaves_label_and_op_clean() {
    setup_ctx("pilots.terraagent.testnet", 0);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.on_pilot_created(
            "op-fail".into(),
            "ghost".into(),
            account("ghost.pilots.terraagent.testnet"),
            String::from(&sample_pk()),
            "20000000000000000000000".into(),
            Err(PromiseError::Failed),
        );
    }));
    assert!(panicked.is_err());
    assert_eq!(contract.get_pilot_account("ghost".into()), None);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn rejects_unauthorized_caller() {
    setup_ctx("attacker.testnet", 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-1".into(), "nova".into(), sample_pk());
}

#[test]
#[should_panic(expected = "NEAR_NAME_TAKEN: reserved pilot label")]
fn rejects_reserved_protocol_label() {
    setup_ctx("relayer.terraagent.testnet", 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-1".into(), "protocol".into(), sample_pk());
}

#[test]
#[should_panic(expected = "NEAR_NAME_TAKEN: reserved pilot label")]
fn rejects_reserved_guild_prefix() {
    setup_ctx("relayer.terraagent.testnet", 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-1".into(), "guild-alpha".into(), sample_pk());
}

#[test]
#[should_panic(expected = "pilot label must be 2..32 chars")]
fn rejects_1_char_label() {
    setup_ctx("relayer.terraagent.testnet", 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-1".into(), "x".into(), sample_pk());
}

#[test]
#[should_panic(expected = "invalid hyphen placement")]
fn rejects_double_hyphen_label() {
    setup_ctx("relayer.terraagent.testnet", 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-1".into(), "alex--pilot".into(), sample_pk());
}

#[test]
#[should_panic(expected = "must contain only [a-z0-9-]")]
fn rejects_uppercase_label() {
    setup_ctx("relayer.terraagent.testnet", 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-1".into(), "AlexPilot".into(), sample_pk());
}

#[test]
#[should_panic(expected = "sub-account exceeds 64 chars")]
fn rejects_subaccount_exceeding_64_chars() {
    // 40-char current account + '.' + 25-char label = 66 chars > 64!
    let long_factory = "pilots.very-long-sub-domain-root.testnet";
    setup_ctx_full(long_factory, "relayer.terraagent.testnet", 5_000, 20);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-long".into(), "a".repeat(25), sample_pk());
}

#[test]
#[should_panic(expected = "NEAR_UNAVAILABLE")]
fn rejects_when_liquid_balance_below_reserve_without_deposit() {
    setup_ctx_full("pilots.terraagent.testnet", "relayer.terraagent.testnet", 30, 0);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    let _ = contract.create_pilot_account("op-low".into(), "nova".into(), sample_pk());
}

#[test]
fn owner_rotates_operator_and_views_work() {
    setup_ctx("terraagent.testnet", 0);
    let mut contract = PilotFactoryContract::new(
        account("terraagent.testnet"),
        account("relayer.terraagent.testnet"),
    );
    assert_eq!(contract.get_owner(), account("terraagent.testnet"));
    contract.set_operator(account("minter.terraagent.testnet"));
    assert_eq!(contract.get_operator(), account("minter.terraagent.testnet"));
}
