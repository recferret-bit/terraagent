use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue, PublicKey,
};
use serde_json::json;

const MIN_INITIAL_MILLINEAR: u128 = 20; // 0.02 NEAR
const CONTRACT_RESERVE_MILLINEAR: u128 = 50; // 0.05 NEAR minimum liquid buffer above storage lock
const CALLBACK_GAS: Gas = Gas::from_tgas(12);

const RESERVED_LABELS: [&str; 18] = [
    "relayer",
    "minter",
    "pilots",
    "protocol",
    "res",
    "deed",
    "bounty",
    "staking",
    "dao",
    "treasury",
    "agents",
    "npc",
    "admin",
    "root",
    "system",
    "near",
    "intents",
    "terraagent",
];

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait ExtSelf {
    fn on_pilot_created(
        &mut self,
        op_id: String,
        label: String,
        new_account_id: AccountId,
        public_key: String,
        funded_yocto: String,
    ) -> String;
}

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
            let attached = env::attached_deposit();
            if attached > NearToken::from_yoctonear(0) {
                let _ = Promise::new(caller).transfer(attached);
            }
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
        let storage_locked = NearToken::from_yoctonear(
            (env::storage_usage() as u128)
                .saturating_mul(env::storage_byte_cost().as_yoctonear()),
        );
        let liquid_balance = env::account_balance().saturating_sub(storage_locked);
        let funding = if attached >= min_initial {
            attached
        } else {
            let reserve = NearToken::from_millinear(CONTRACT_RESERVE_MILLINEAR);
            require!(
                liquid_balance >= min_initial.saturating_add(reserve),
                "NEAR_UNAVAILABLE: pilot factory liquid balance below reserve"
            );
            min_initial
        };

        let pk_str = String::from(&public_key);
        let funded_str = funding.as_yoctonear().to_string();

        let promise = Promise::new(new_account_id.clone())
            .create_account()
            .transfer(funding)
            .add_full_access_key(public_key)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_pilot_created(op_id, label, new_account_id, pk_str, funded_str),
            );

        PromiseOrValue::Promise(promise)
    }

    #[private]
    pub fn on_pilot_created(
        &mut self,
        op_id: String,
        label: String,
        new_account_id: AccountId,
        public_key: String,
        funded_yocto: String,
        #[callback_result] call_result: Result<(), PromiseError>,
    ) -> String {
        require!(
            call_result.is_ok(),
            "NEAR_NAME_TAKEN: child sub-account creation failed on-chain"
        );
        let id_str = new_account_id.to_string();
        self.created_accounts.insert(label, id_str.clone());
        self.processed_ops.insert(op_id.clone(), id_str.clone());
        emit_pilots_event(
            "pilot_account_created",
            json!({
                "op_id": op_id,
                "account_id": id_str,
                "public_key": public_key,
                "funded_yocto": funded_yocto,
            }),
        );
        id_str
    }
}

#[cfg(test)]
mod tests;
