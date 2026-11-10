use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Promise};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Report {
    pub reporter: AccountId,
    pub reason: String,
    pub evidence_hash: String,
    pub block_height: u64,
}

#[near(contract_state)]
pub struct Contract {
    reports: LookupMap<String, Vec<Report>>,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            reports: LookupMap::new(b"s"),
        }
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self::default()
    }

    /// One report per reporter. The attached deposit must cover the new storage.
    #[payable]
    pub fn report(&mut self, account: String, reason: String, evidence_hash: String) {
        let reporter = env::predecessor_account_id();
        let before = env::storage_usage();
        let mut list = self.reports.get(&account).cloned().unwrap_or_default();
        if !list.iter().any(|item| item.reporter == reporter) {
            list.push(Report {
                reporter: reporter.clone(),
                reason,
                evidence_hash,
                block_height: env::block_height(),
            });
            self.reports.insert(account, list);
        }
        let used = env::storage_usage().saturating_sub(before);
        let required = env::storage_byte_cost().saturating_mul(u128::from(used));
        let attached = env::attached_deposit();
        require!(
            attached >= required,
            "insufficient deposit for storage"
        );
        let refund = attached.saturating_sub(required);
        if refund.as_yoctonear() > 0 {
            Promise::new(reporter).transfer(refund).detach();
        }
    }

    pub fn get(&self, account: String) -> Vec<Report> {
        self.reports.get(&account).cloned().unwrap_or_default()
    }
}
