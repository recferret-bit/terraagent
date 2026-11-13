use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowRecord {
    pub escrow_id: String,
    pub status: String,
    pub funder: AccountId,
    pub beneficiary: String,
    pub token_id: String,
    pub amount: u128,
    pub expires_at_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowView {
    pub escrow_id: String,
    pub status: String,
    pub funder: AccountId,
    pub beneficiary: String,
    pub token_id: String,
    pub amount: String,
    pub expires_at_ms: u64,
}

impl From<&EscrowRecord> for EscrowView {
    fn from(r: &EscrowRecord) -> Self {
        Self {
            escrow_id: r.escrow_id.clone(),
            status: r.status.clone(),
            funder: r.funder.clone(),
            beneficiary: r.beneficiary.clone(),
            token_id: r.token_id.clone(),
            amount: r.amount.to_string(),
            expires_at_ms: r.expires_at_ms,
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct BountyEscrowContract {
    owner_id: AccountId,
    operator_id: AccountId,
    escrows: LookupMap<String, EscrowRecord>,
    processed_ops: LookupMap<String, String>,
}

fn emit_escrow(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "terra-escrow",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

#[near]
impl BountyEscrowContract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        Self {
            owner_id,
            operator_id,
            escrows: LookupMap::new(b"e"),
            processed_ops: LookupMap::new(b"o"),
        }
    }

    pub fn set_operator(&mut self, operator_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "NEAR_NOT_OWNER: only owner can update operator"
        );
        self.operator_id = operator_id;
    }

    /// Opens a mercenary or raid-defense bounty escrow (`EscrowPort.open`). Idempotent by `op_id`.
    pub fn open_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        funder: AccountId,
        beneficiary: String,
        token_id: String,
        amount: String,
        expires_at_ms: u64,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        require!(!escrow_id.is_empty(), "NEAR_ESCROW_INVALID: escrow_id required");
        require!(!beneficiary.is_empty(), "NEAR_ESCROW_STATE: beneficiary required");
        let caller = env::predecessor_account_id();
        require!(
            caller == self.operator_id || caller == self.owner_id || caller == funder,
            "NEAR_NOT_OWNER: caller not authorized to open escrow"
        );
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let qty = amount
            .parse::<u128>()
            .unwrap_or_else(|_| env::panic_str("NEAR_ESCROW_INVALID: invalid amount"));
        require!(qty > 0, "NEAR_ESCROW_INVALID: amount must be > 0");
        require!(
            self.escrows.get(&escrow_id).is_none(),
            "NEAR_ESCROW_EXISTS: escrow_id already exists"
        );

        let rec = EscrowRecord {
            escrow_id: escrow_id.clone(),
            status: "open".to_string(),
            funder: funder.clone(),
            beneficiary: beneficiary.clone(),
            token_id: token_id.clone(),
            amount: qty,
            expires_at_ms,
        };
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        emit_escrow(
            "escrow_open",
            json!({
                "escrow_id": escrow_id,
                "funder": funder,
                "beneficiary": beneficiary,
                "token_id": token_id,
                "amount": qty.to_string(),
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Claims an open escrow for `caller` (`EscrowPort.claim`). Idempotent by `op_id`.
    pub fn claim_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        caller: AccountId,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        let pred = env::predecessor_account_id();
        require!(
            pred == self.operator_id || pred == self.owner_id,
            "NEAR_NOT_OWNER: only operator may settle escrow claims"
        );
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let mut rec = self
            .escrows
            .get(&escrow_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_NOT_FOUND: escrow not found"));
        require!(rec.status == "open", "NEAR_ESCROW_STATE: escrow is not open");

        rec.status = "claimed".to_string();
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        emit_escrow(
            "escrow_claim",
            json!({
                "escrow_id": escrow_id,
                "to": caller,
                "amount": rec.amount.to_string(),
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Refunds all or part of an open escrow (`EscrowPort.refund`, W22-28 partial mercenary refund).
    pub fn refund_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        _caller: AccountId,
        amount: Option<String>,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        let pred = env::predecessor_account_id();
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let mut rec = self
            .escrows
            .get(&escrow_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_NOT_FOUND: escrow not found"));
        require!(
            pred == self.operator_id || pred == self.owner_id || pred == rec.funder,
            "NEAR_NOT_OWNER: not authorized to refund escrow"
        );
        require!(rec.status == "open", "NEAR_ESCROW_STATE: escrow is not open");

        let requested = match amount {
            None => rec.amount,
            Some(raw) => raw
                .parse::<u128>()
                .unwrap_or_else(|_| env::panic_str("NEAR_ESCROW_INVALID: invalid refund amount")),
        };
        require!(
            requested <= rec.amount,
            "NEAR_ESCROW_STATE: refund exceeds remaining hold"
        );

        if requested == rec.amount {
            rec.status = "refunded".to_string();
        } else if requested > 0 {
            rec.amount -= requested;
        }
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        emit_escrow(
            "escrow_refund",
            json!({
                "escrow_id": escrow_id,
                "to": rec.funder,
                "refunded": requested.to_string(),
                "status": rec.status,
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    /// Slashes an open diplomacy or war bond escrow (`EscrowPort.slash`):
    /// splits the bond `90%` (`10_000 - protocol_fee_bp`) to `victim_id` and `10%` (`protocol_fee_bp`) to `protocol_id`.
    /// Idempotent by `op_id`.
    pub fn slash_escrow(
        &mut self,
        op_id: String,
        escrow_id: String,
        victim_id: AccountId,
        protocol_id: AccountId,
        protocol_fee_bp: u32,
    ) -> EscrowView {
        require!(!op_id.is_empty(), "NEAR_ESCROW_INVALID: op_id required");
        require!(
            protocol_fee_bp <= 10_000,
            "NEAR_ESCROW_INVALID: protocol_fee_bp must be <= 10_000"
        );
        let pred = env::predecessor_account_id();
        require!(
            pred == self.operator_id || pred == self.owner_id,
            "NEAR_NOT_OWNER: only operator may slash escrows"
        );
        if let Some(existing_id) = self.processed_ops.get(&op_id) {
            if let Some(existing) = self.escrows.get(existing_id) {
                return EscrowView::from(existing);
            }
        }
        let mut rec = self
            .escrows
            .get(&escrow_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("NEAR_ESCROW_NOT_FOUND: escrow not found"));
        require!(rec.status == "open", "NEAR_ESCROW_STATE: escrow is not open");

        let protocol_cut = (rec.amount * (protocol_fee_bp as u128)) / 10_000;
        let victim_cut = rec.amount - protocol_cut;
        rec.status = "slashed".to_string();
        self.escrows.insert(escrow_id.clone(), rec.clone());
        self.processed_ops.insert(op_id.clone(), escrow_id.clone());

        emit_escrow(
            "escrow_slash",
            json!({
                "escrow_id": escrow_id,
                "funder": rec.funder,
                "victim_id": victim_id,
                "victim_amount": victim_cut.to_string(),
                "protocol_id": protocol_id,
                "protocol_amount": protocol_cut.to_string(),
                "protocol_fee_bp": protocol_fee_bp,
                "memo": op_id,
            }),
        );
        EscrowView::from(&rec)
    }

    pub fn get_escrow(&self, escrow_id: String) -> Option<EscrowView> {
        self.escrows.get(&escrow_id).map(EscrowView::from)
    }
}

#[cfg(test)]
mod tests {
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

        let replay = c.slash_escrow(
            "op_war_slash".into(),
            "escrow_war_1".into(),
            acct("defender.testnet"),
            acct("protocol.terraagent.testnet"),
            1_000,
        );
        assert_eq!(replay.status, "slashed");
    }
}
