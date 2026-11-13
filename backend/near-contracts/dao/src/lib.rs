use std::collections::BTreeMap;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use serde_json::json;

const DEFAULT_PASS_ABOVE_BP: u32 = 5_000;
const DEFAULT_PASS_MIN_YES: u32 = 2;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DaoMemberRecord {
    pub account_id: String,
    pub can_propose: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoteRecord {
    pub voter: String,
    pub vote: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalRecord {
    pub id: u32,
    pub proposer: String,
    pub status: String,
    pub votes: Vec<VoteRecord>,
    pub kind: String,
    pub description: String,
    pub payload_json: String,
    pub cost: Option<String>,
    pub token_id: Option<String>,
    pub debited: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DaoRecord {
    pub dao_account_id: String,
    pub name: String,
    pub members: Vec<DaoMemberRecord>,
    pub balances: BTreeMap<String, String>,
    pub proposals: Vec<ProposalRecord>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TreasuryDaoContract {
    owner_id: AccountId,
    operator_id: AccountId,
    daos: LookupMap<String, DaoRecord>,
    processed_ops: LookupMap<String, String>,
}

fn parse_u128(raw: &str) -> u128 {
    raw.parse::<u128>()
        .expect("TREASURY_INSUFFICIENT: invalid amount")
}

fn rule_passes(
    members: &[DaoMemberRecord],
    votes: &[VoteRecord],
    pass_above_bp: u32,
    pass_min_yes: u32,
) -> bool {
    let member_count = members.len() as u128;
    if member_count == 0 {
        return false;
    }
    let mut yes: u128 = 0;
    let mut no: u128 = 0;
    for v in votes {
        if members.iter().any(|m| m.account_id == v.voter) {
            if v.vote == "approve" {
                yes += 1;
            } else {
                no += 1;
            }
        }
    }
    if yes == 0 {
        return false;
    }
    if yes * 10_000 > (pass_above_bp as u128) * member_count {
        return true;
    }
    yes >= (pass_min_yes as u128) && no == 0
}

fn settle_cost(dao: &mut DaoRecord, proposal: &mut ProposalRecord) {
    if proposal.debited {
        return;
    }
    if let (Some(cost_str), Some(token_id)) = (&proposal.cost, &proposal.token_id) {
        let cost = parse_u128(cost_str);
        if cost > 0 {
            let cur = dao
                .balances
                .get(token_id)
                .map(|s| parse_u128(s))
                .unwrap_or(0);
            require!(
                cur >= cost,
                "TREASURY_INSUFFICIENT: treasury balance cannot cover proposal cost"
            );
            let next = cur - cost;
            if next == 0 {
                dao.balances.remove(token_id);
            } else {
                dao.balances.insert(token_id.clone(), next.to_string());
            }
        }
        proposal.debited = true;
    }
}

fn emit_dao(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "terra-dao",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

#[near]
impl TreasuryDaoContract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        Self {
            owner_id,
            operator_id,
            daos: LookupMap::new(b"d"),
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

    fn require_operator(&self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.operator_id || caller == self.owner_id,
            "NEAR_NOT_OWNER: caller not authorized"
        );
    }

    /// Creates a planet treasury DAO with deduplicated initial council members. Idempotent by `op_id`.
    pub fn create_dao(
        &mut self,
        op_id: String,
        dao_account_id: String,
        name: String,
        council_account_ids: Vec<String>,
    ) -> String {
        require!(!op_id.is_empty(), "DAO_NOT_FOUND: op_id required");
        require!(!dao_account_id.trim().is_empty(), "DAO_NOT_FOUND: dao_account_id required");
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev.clone();
        }
        if !self.daos.contains_key(&dao_account_id) {
            let mut members = Vec::new();
            for account_id in council_account_ids {
                if !members.iter().any(|m: &DaoMemberRecord| m.account_id == account_id) {
                    members.push(DaoMemberRecord {
                        account_id,
                        can_propose: true,
                    });
                }
            }
            let record = DaoRecord {
                dao_account_id: dao_account_id.clone(),
                name: if name.trim().is_empty() {
                    "dao".to_string()
                } else {
                    name.trim().to_string()
                },
                members,
                balances: BTreeMap::new(),
                proposals: Vec::new(),
            };
            self.daos.insert(dao_account_id.clone(), record);
            emit_dao("create_dao", json!({ "dao_account_id": dao_account_id }));
        }
        self.processed_ops.insert(op_id, dao_account_id.clone());
        dao_account_id
    }

    pub fn deposit(
        &mut self,
        op_id: String,
        dao_account_id: String,
        from: String,
        token_id: String,
        amount: String,
    ) -> String {
        require!(!op_id.is_empty(), "DAO_NOT_FOUND: op_id required");
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev.clone();
        }
        let mut dao = self
            .daos
            .get(&dao_account_id)
            .cloned()
            .expect("DAO_NOT_FOUND: dao does not exist");
        let add_val = parse_u128(&amount);
        require!(add_val > 0, "TREASURY_INSUFFICIENT: deposit amount must be > 0");
        let cur = dao
            .balances
            .get(&token_id)
            .map(|s| parse_u128(s))
            .unwrap_or(0);
        let next = cur
            .checked_add(add_val)
            .expect("TREASURY_OVERFLOW: treasury balance overflow");
        dao.balances.insert(token_id.clone(), next.to_string());
        self.daos.insert(dao_account_id.clone(), dao);
        let res = next.to_string();
        self.processed_ops.insert(op_id, res.clone());
        emit_dao(
            "deposit",
            json!({ "dao_account_id": dao_account_id, "from": from, "token_id": token_id, "amount": amount }),
        );
        res
    }

    pub fn add_member(
        &mut self,
        op_id: String,
        dao_account_id: String,
        member: String,
        can_propose: Option<bool>,
    ) -> bool {
        require!(!op_id.is_empty(), "DAO_NOT_FOUND: op_id required");
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev == "true";
        }
        let mut dao = self
            .daos
            .get(&dao_account_id)
            .cloned()
            .expect("DAO_NOT_FOUND: dao does not exist");
        if let Some(existing) = dao.members.iter_mut().find(|m| m.account_id == member) {
            if let Some(flag) = can_propose {
                existing.can_propose = flag;
            }
        } else {
            dao.members.push(DaoMemberRecord {
                account_id: member.clone(),
                can_propose: can_propose.unwrap_or(true),
            });
        }
        self.daos.insert(dao_account_id.clone(), dao);
        self.processed_ops.insert(op_id, "true".to_string());
        emit_dao("add_member", json!({ "dao_account_id": dao_account_id, "member": member }));
        true
    }

    pub fn remove_member(&mut self, op_id: String, dao_account_id: String, member: String) -> bool {
        require!(!op_id.is_empty(), "DAO_NOT_FOUND: op_id required");
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev == "true";
        }
        let mut dao = self
            .daos
            .get(&dao_account_id)
            .cloned()
            .expect("DAO_NOT_FOUND: dao does not exist");
        let before = dao.members.len();
        dao.members.retain(|m| m.account_id != member);
        let removed = dao.members.len() < before;
        if removed {
            self.daos.insert(dao_account_id.clone(), dao);
        }
        self.processed_ops.insert(op_id, removed.to_string());
        emit_dao("remove_member", json!({ "dao_account_id": dao_account_id, "member": member, "removed": removed }));
        removed
    }

    #[allow(clippy::too_many_arguments)]
    pub fn propose(
        &mut self,
        op_id: String,
        dao_account_id: String,
        proposer: String,
        description: String,
        kind: String,
        payload_json: String,
        cost: Option<String>,
        token_id: Option<String>,
    ) -> u32 {
        require!(!op_id.is_empty(), "DAO_NOT_FOUND: op_id required");
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev.parse::<u32>().unwrap_or(0);
        }
        let mut dao = self
            .daos
            .get(&dao_account_id)
            .cloned()
            .expect("DAO_NOT_FOUND: dao does not exist");
        let member = dao
            .members
            .iter()
            .find(|m| m.account_id == proposer)
            .expect("NOT_A_MEMBER: proposer is not a council member");
        require!(
            member.can_propose,
            "NOT_A_MEMBER: member is not allowed to propose"
        );
        if let (Some(c), Some(t)) = (&cost, &token_id) {
            let needed = parse_u128(c);
            let avail = dao.balances.get(t).map(|s| parse_u128(s)).unwrap_or(0);
            require!(
                avail >= needed,
                "TREASURY_INSUFFICIENT: treasury balance below proposal cost"
            );
        }
        let proposal_id = dao.proposals.len() as u32;
        dao.proposals.push(ProposalRecord {
            id: proposal_id,
            proposer: proposer.clone(),
            status: "InProgress".to_string(),
            votes: Vec::new(),
            kind: kind.clone(),
            description,
            payload_json,
            cost,
            token_id,
            debited: false,
        });
        self.daos.insert(dao_account_id.clone(), dao);
        self.processed_ops.insert(op_id, proposal_id.to_string());
        emit_dao("propose", json!({ "dao_account_id": dao_account_id, "proposal_id": proposal_id, "proposer": proposer, "kind": kind }));
        proposal_id
    }

    #[allow(clippy::too_many_arguments)]
    pub fn vote(
        &mut self,
        op_id: String,
        dao_account_id: String,
        proposal_id: u32,
        voter: String,
        vote: String,
        pass_above_bp: Option<u32>,
        pass_min_yes: Option<u32>,
    ) -> String {
        require!(!op_id.is_empty(), "DAO_NOT_FOUND: op_id required");
        require!(
            vote == "approve" || vote == "reject",
            "INVALID_VOTE: vote must be approve or reject"
        );
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev.clone();
        }
        let mut dao = self
            .daos
            .get(&dao_account_id)
            .cloned()
            .expect("DAO_NOT_FOUND: dao does not exist");
        require!(
            dao.members.iter().any(|m| m.account_id == voter),
            "NOT_A_MEMBER: voter is not a council member"
        );
        let idx = dao
            .proposals
            .iter()
            .position(|p| p.id == proposal_id)
            .expect("DAO_NOT_FOUND: proposal does not exist");
        require!(
            dao.proposals[idx].status == "InProgress",
            "PROPOSAL_CLOSED: proposal is no longer open"
        );
        require!(
            !dao.proposals[idx].votes.iter().any(|v| v.voter == voter),
            "ALREADY_VOTED: member already voted"
        );
        dao.proposals[idx].votes.push(VoteRecord {
            voter: voter.clone(),
            vote: vote.clone(),
        });

        let above_bp = pass_above_bp.unwrap_or(DEFAULT_PASS_ABOVE_BP);
        let min_yes = pass_min_yes.unwrap_or(DEFAULT_PASS_MIN_YES);
        let mut status = "InProgress".to_string();
        if rule_passes(&dao.members, &dao.proposals[idx].votes, above_bp, min_yes) {
            let mut proposal = dao.proposals[idx].clone();
            settle_cost(&mut dao, &mut proposal);
            proposal.status = "Approved".to_string();
            dao.proposals[idx] = proposal;
            status = "Approved".to_string();
        }
        self.daos.insert(dao_account_id.clone(), dao);
        self.processed_ops.insert(op_id, status.clone());
        emit_dao("vote", json!({ "dao_account_id": dao_account_id, "proposal_id": proposal_id, "voter": voter, "status": status }));
        status
    }

    pub fn finalize(
        &mut self,
        op_id: String,
        dao_account_id: String,
        proposal_id: u32,
        pass_above_bp: Option<u32>,
        pass_min_yes: Option<u32>,
    ) -> String {
        require!(!op_id.is_empty(), "DAO_NOT_FOUND: op_id required");
        self.require_operator();
        if let Some(prev) = self.processed_ops.get(&op_id) {
            return prev.clone();
        }
        let mut dao = self
            .daos
            .get(&dao_account_id)
            .cloned()
            .expect("DAO_NOT_FOUND: dao does not exist");
        let idx = dao
            .proposals
            .iter()
            .position(|p| p.id == proposal_id)
            .expect("DAO_NOT_FOUND: proposal does not exist");
        if dao.proposals[idx].status != "InProgress" {
            let status = dao.proposals[idx].status.clone();
            self.processed_ops.insert(op_id, status.clone());
            return status;
        }
        let above_bp = pass_above_bp.unwrap_or(DEFAULT_PASS_ABOVE_BP);
        let min_yes = pass_min_yes.unwrap_or(DEFAULT_PASS_MIN_YES);
        let status = if !rule_passes(&dao.members, &dao.proposals[idx].votes, above_bp, min_yes) {
            dao.proposals[idx].status = "Expired".to_string();
            "Expired".to_string()
        } else {
            let mut proposal = dao.proposals[idx].clone();
            settle_cost(&mut dao, &mut proposal);
            proposal.status = "Approved".to_string();
            dao.proposals[idx] = proposal;
            "Approved".to_string()
        };
        self.daos.insert(dao_account_id.clone(), dao);
        self.processed_ops.insert(op_id, status.clone());
        emit_dao("finalize", json!({ "dao_account_id": dao_account_id, "proposal_id": proposal_id, "status": status }));
        status
    }

    pub fn get_dao(&self, dao_account_id: String) -> DaoRecord {
        self.daos
            .get(&dao_account_id)
            .cloned()
            .expect("DAO_NOT_FOUND: dao does not exist")
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator_id.clone()
    }
}

#[cfg(test)]
mod tests;
