use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, NearToken, PanicOnDefault, Promise, PromiseOrValue, PublicKey,
};
use serde_json::json;

const MIN_INITIAL_MILLINEAR: u128 = 20; // 0.02 NEAR
const CONTRACT_RESERVE_MILLINEAR: u128 = 50; // 0.05 NEAR minimum contract storage reserve

const RESERVED_LABELS: [&str; 9] = [
    "relayer",
    "minter",
    "npc",
    "admin",
    "root",
    "system",
    "near",
    "intents",
    "terraagent",
];

fn validate_pilot_label(label: &str) {
    require!(
        label.len() >= 2 && label.len() <= 32,
        "NEAR_PROVIDER_REJECTED: pilot label must be 2..32 chars"
    );
    require!(
        !label.starts_with('-') && !label.ends_with('-') && !label.contains("--"),
        "NEAR_PROVIDER_REJECTED: invalid hyphen placement in pilot label"
    );
    require!(
        label
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
        "NEAR_PROVIDER_REJECTED: pilot label must contain only [a-z0-9-]"
    );
    require!(
        !RESERVED_LABELS.contains(&label) && !label.starts_with("guild-"),
        "NEAR_NAME_TAKEN: reserved pilot label"
    );
}

fn emit_pilots_event(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "terra-pilots",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PilotFactoryContract {
    owner_id: AccountId,
    operator_id: AccountId,
    created_accounts: LookupMap<String, String>,
    processed_ops: LookupMap<String, String>,
}

#[near]
impl PilotFactoryContract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        Self {
            owner_id,
            operator_id,
            created_accounts: LookupMap::new(b"a"),
            processed_ops: LookupMap::new(b"o"),
        }
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator_id.clone()
    }

    pub fn get_pilot_account(&self, label: String) -> Option<String> {
        self.created_accounts.get(&label).cloned()
    }

    pub fn set_operator(&mut self, operator_id: AccountId) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id,
            "NEAR_NOT_OWNER: only owner can rotate operator_id"
        );
        self.operator_id = operator_id.clone();
        emit_pilots_event("operator_updated", json!({ "operator_id": operator_id }));
    }

    #[payable]
    pub fn create_pilot_account(
        &mut self,
        op_id: String,
        label: String,
        public_key: PublicKey,
    ) -> PromiseOrValue<String> {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.operator_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: caller is not authorized operator or owner"
        );
        require!(!op_id.trim().is_empty(), "op_id is required");

        if let Some(existing) = self.processed_ops.get(&op_id) {
            return PromiseOrValue::Value(existing.clone());
        }

        validate_pilot_label(&label);
        require!(
            !self.created_accounts.contains_key(&label),
            "NEAR_NAME_TAKEN: pilot sub-account already created"
        );

        let full_id_str = format!("{}.{}", label, env::current_account_id());
        require!(
            full_id_str.len() <= 64,
            "NEAR_PROVIDER_REJECTED: sub-account exceeds 64 chars"
        );
        let new_account_id: AccountId = full_id_str
            .parse()
            .expect("NEAR_PROVIDER_REJECTED: invalid NEAR sub-account ID");

        let min_initial = NearToken::from_millinear(MIN_INITIAL_MILLINEAR);
        let attached = env::attached_deposit();
        let funding = if attached >= min_initial {
            attached
        } else {
            let reserve = NearToken::from_millinear(CONTRACT_RESERVE_MILLINEAR);
            require!(
                env::account_balance() >= min_initial.saturating_add(reserve),
                "NEAR_UNAVAILABLE: pilot factory balance below reserve"
            );
            min_initial
        };

        self.created_accounts
            .insert(label.clone(), new_account_id.to_string());
        self.processed_ops
            .insert(op_id.clone(), new_account_id.to_string());

        emit_pilots_event(
            "pilot_account_created",
            json!({
                "op_id": op_id,
                "account_id": new_account_id,
                "public_key": String::from(&public_key),
                "funded_yocto": funding.as_yoctonear().to_string(),
            }),
        );

        let promise = Promise::new(new_account_id)
            .create_account()
            .transfer(funding)
            .add_full_access_key(public_key);

        PromiseOrValue::Promise(promise)
    }
}

#[cfg(test)]
mod tests {
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

    fn setup_ctx(predecessor: &str, attached_millinear: u128) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("pilots.terraagent.testnet"))
            .predecessor_account_id(account(predecessor))
            .account_balance(NearToken::from_near(5))
            .attached_deposit(NearToken::from_millinear(attached_millinear));
        testing_env!(builder.build());
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
        assert_eq!(
            contract.get_pilot_account("alex-pilot".to_string()),
            Some("alex-pilot.pilots.terraagent.testnet".to_string())
        );
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains("pilot_account_created")));

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
    #[should_panic(expected = "NEAR_NAME_TAKEN")]
    fn rejects_duplicate_label_under_different_op() {
        setup_ctx("relayer.terraagent.testnet", 20);
        let mut contract = PilotFactoryContract::new(
            account("terraagent.testnet"),
            account("relayer.terraagent.testnet"),
        );
        let _ = contract.create_pilot_account("op-1".into(), "nova".into(), sample_pk());
        let _ = contract.create_pilot_account("op-2".into(), "nova".into(), sample_pk());
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
    fn rejects_reserved_label() {
        setup_ctx("relayer.terraagent.testnet", 20);
        let mut contract = PilotFactoryContract::new(
            account("terraagent.testnet"),
            account("relayer.terraagent.testnet"),
        );
        let _ = contract.create_pilot_account("op-1".into(), "admin".into(), sample_pk());
    }

    #[test]
    fn owner_rotates_operator() {
        setup_ctx("terraagent.testnet", 0);
        let mut contract = PilotFactoryContract::new(
            account("terraagent.testnet"),
            account("relayer.terraagent.testnet"),
        );
        contract.set_operator(account("minter.terraagent.testnet"));
        assert_eq!(contract.get_operator(), account("minter.terraagent.testnet"));
    }
}
