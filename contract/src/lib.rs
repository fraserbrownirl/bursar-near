use near_sdk::store::LookupMap;
use near_sdk::{near, AccountId};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Report {
    pub reason: String,
    pub evidence_hash: String,
}

#[near(contract_state)]
pub struct Contract {
    reports: LookupMap<AccountId, Report>,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            reports: LookupMap::new(b"r"),
        }
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self::default()
    }

    /// First report for an account wins. `evidence_hash` is the ledger hash of the STOP.
    pub fn report(&mut self, account: AccountId, reason: String, evidence_hash: String) {
        if self.reports.get(&account).is_none() {
            self.reports.insert(
                account,
                Report {
                    reason,
                    evidence_hash,
                },
            );
        }
    }

    pub fn get(&self, account: AccountId) -> Option<Report> {
        self.reports.get(&account).cloned()
    }
}
