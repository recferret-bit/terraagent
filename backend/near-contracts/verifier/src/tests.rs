use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn setup(now_ms: u64, strict: bool) -> IntentVerifierContract {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct("owner.testnet"))
        .block_timestamp(now_ms * 1_000_000)
        .build());
    IntentVerifierContract::new(acct("owner.testnet"), acct("minter.testnet"), Some(strict))
}

fn real_four_way_intents() -> Vec<SignedTokenDiffIntent> {
    vec![
        SignedTokenDiffIntent {
            diff: TokenDiffLeg {
                account_id: "buyer.testnet".into(),
                deltas: BTreeMap::from([
                    ("USDC".into(), "-101500000".into()),
                    ("metals.t1".into(), "100".into()),
                ]),
            },
            signature: "ed25519:3jUMApafYodUJBKUZyHNjqu6tRPdKx3Dupspq52HEXyWvF6z9XhU1oSiW8qFmZvhcAStsK8MqP2X72sKfJfD6Dfn".into(),
            nonce: "CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws=".into(),
            deadline_ms: 1_763_000_900_000,
            public_key: "ed25519:AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9".into(),
            recipient: None,
        },
        SignedTokenDiffIntent {
            diff: TokenDiffLeg {
                account_id: "seller.testnet".into(),
                deltas: BTreeMap::from([
                    ("USDC".into(), "100000000".into()),
                    ("metals.t1".into(), "-100".into()),
                ]),
            },
            signature: "ed25519:VH8fivNhW7X7jWnvpAtcVsFdwsY7rEwsbJi4Mwns57gg9uCxkY54sqMPqjvysTtSTdG6tyaWDSErtcJYWPaXyDv".into(),
            nonce: "DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw=".into(),
            deadline_ms: 1_763_000_900_000,
            public_key: "ed25519:9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu".into(),
            recipient: None,
        },
        SignedTokenDiffIntent {
            diff: TokenDiffLeg {
                account_id: "stall.testnet".into(),
                deltas: BTreeMap::from([("USDC".into(), "500000".into())]),
            },
            signature: "ed25519:ymhZgEG6cbRo1DP6m4V7vsLcBNEhAAs3BN4tbC2PmUKSJ7LZsYQvF8jPbhatscGmHQojcNgJgeLVSygRGw3cMhB".into(),
            nonce: "DQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0=".into(),
            deadline_ms: 1_763_000_900_000,
            public_key: "ed25519:GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse".into(),
            recipient: None,
        },
        SignedTokenDiffIntent {
            diff: TokenDiffLeg {
                account_id: "protocol.testnet".into(),
                deltas: BTreeMap::from([("USDC".into(), "1000000".into())]),
            },
            signature: "ed25519:K91Wf36KLtPfVdT6c8BLeSF4qP5dbpHWCES8TDWe7YMF7AvticjTNjGqDvvHezQYPUNccLViofj8AeDti54FNBw".into(),
            nonce: "Dg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4=".into(),
            deadline_ms: 1_763_000_900_000,
            public_key: "ed25519:EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1".into(),
            recipient: None,
        },
    ]
}

#[test]
fn borsh_iso_and_base58_helpers_match_canonical_nep413_shape() {
    assert_eq!(iso8601_utc(1_763_000_000_123), "2025-11-13T02:13:20.123Z");
    let raw = decode_base58("11111111111111111111111111111111").unwrap();
    assert_eq!(raw, vec![0u8; 32]);
    let b64 = decode_base64("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap();
    assert_eq!(b64.len(), 32);
}

#[test]
fn verifies_real_ed25519_nep413_four_way_zero_sum_and_blocks_replay_tamper_expiry() {
    let mut c = setup(1_763_000_000_000, true);
    c.deposit_balance("buyer.testnet".into(), "USDC".into(), "101500000".into());
    c.deposit_balance("seller.testnet".into(), "metals.t1".into(), "100".into());

    let intents = real_four_way_intents();

    // Non-zero-sum subset rejects cleanly before nonces are marked used
    let skewed = c.simulate_intents(vec![intents[0].clone()]);
    assert!(!skewed.ok);
    assert_eq!(skewed.error_code.as_deref(), Some("NEAR_INTENT_NOT_ZERO_SUM"));

    let sim = c.simulate_intents(intents.clone());
    assert!(sim.ok, "expected valid simulation, got {:?}", sim.error_code);

    let receipt = c.execute_intents("op-4way-1".into(), intents.clone());
    assert_eq!(receipt.settled_intents, 4);
    assert_eq!(c.balance_of("buyer.testnet".into(), "USDC".into()), "0");
    assert_eq!(c.balance_of("buyer.testnet".into(), "metals.t1".into()), "100");
    assert_eq!(c.balance_of("seller.testnet".into(), "USDC".into()), "100000000");
    assert_eq!(c.balance_of("seller.testnet".into(), "metals.t1".into()), "0");
    assert_eq!(c.balance_of("stall.testnet".into(), "USDC".into()), "500000");
    assert_eq!(c.balance_of("protocol.testnet".into(), "USDC".into()), "1000000");

    // Replaying same op_id is idempotent
    let replay_op = c.execute_intents("op-4way-1".into(), intents.clone());
    assert_eq!(replay_op.settled_intents, 4);

    // Replaying same nonces under new op_id fails
    let sim_reused = c.simulate_intents(intents.clone());
    assert!(!sim_reused.ok);
    assert_eq!(sim_reused.error_code.as_deref(), Some("NEAR_INTENT_NONCE_REUSED"));
}

#[test]
fn public_key_registry_expiry_and_tampered_delta_checks() {
    let mut c = setup(1_763_000_000_000, false);
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct("alice.testnet"))
        .block_timestamp(1_763_000_000_000 * 1_000_000)
        .build());
    let pub_b58 = "ed25519:AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9".to_string();
    c.add_public_key(pub_b58.clone());
    assert!(c.has_public_key("alice.testnet".into(), pub_b58.clone()));
    c.remove_public_key(pub_b58.clone());
    assert!(!c.has_public_key("alice.testnet".into(), pub_b58));

    let mut intents = real_four_way_intents();
    // Tamper 1 delta unit -> cryptographic signature check fails immediately
    intents[0].diff.deltas.insert("USDC".into(), "-101500001".into());
    let sim_tamper = c.simulate_intents(intents.clone());
    assert!(!sim_tamper.ok);
    assert_eq!(sim_tamper.error_code.as_deref(), Some("NEAR_INTENT_BAD_SIGNATURE"));

    // Expired block timestamp fails
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct("minter.testnet"))
        .block_timestamp(1_763_001_000_000 * 1_000_000)
        .build());
    let sim_exp = c.simulate_intents(real_four_way_intents());
    assert!(!sim_exp.ok);
    assert_eq!(sim_exp.error_code.as_deref(), Some("NEAR_INTENT_EXPIRED"));
}

#[test]
fn enforces_registered_account_key_binding_and_permissionless_registered_execution() {
    let mut c = setup(1_763_000_000_000, true);
    c.deposit_balance("buyer.testnet".into(), "USDC".into(), "101500000".into());
    c.deposit_balance("seller.testnet".into(), "metals.t1".into(), "100".into());

    // Register a DIFFERENT key for buyer.testnet -> intent signed by another key must be rejected!
    c.register_account_key(
        "buyer.testnet".into(),
        "ed25519:9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu".into(),
    );
    let sim_spoofed = c.simulate_intents(real_four_way_intents());
    assert!(!sim_spoofed.ok);
    assert_eq!(
        sim_spoofed.error_code.as_deref(),
        Some("NEAR_INTENT_UNREGISTERED_KEY")
    );

    // Register all 4 legitimate signer keys -> non-operator solver can execute permissionlessly
    for it in real_four_way_intents() {
        c.register_account_key(it.diff.account_id, it.public_key);
    }
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct("solver.testnet"))
        .block_timestamp(1_763_000_000_000 * 1_000_000)
        .build());
    let receipt = c.execute_intents("op-solver-1".into(), real_four_way_intents());
    assert_eq!(receipt.settled_intents, 4);
}

#[test]
#[should_panic(expected = "NEAR_NOT_OWNER")]
fn blocks_third_party_from_executing_unregistered_account_intents() {
    let mut c = setup(1_763_000_000_000, true);
    c.deposit_balance("buyer.testnet".into(), "USDC".into(), "101500000".into());
    c.deposit_balance("seller.testnet".into(), "metals.t1".into(), "100".into());

    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct("mallory.testnet"))
        .block_timestamp(1_763_000_000_000 * 1_000_000)
        .build());
    c.execute_intents("op-drain-1".into(), real_four_way_intents());
}
