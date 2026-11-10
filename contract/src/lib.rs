use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Report {
    pub reporter: AccountId,
    pub reason: String,
    pub evidence_hash: String,
    pub block_height: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Anchored {
    pub head: String,
    pub block_height: u64,
}

#[near(contract_state)]
pub struct Contract {
    reports: LookupMap<String, Vec<Report>>,
    /// YoctoNEAR of prepaid storage still available to each reporter.
    balances: LookupMap<AccountId, u128>,
    /// The account that called `storage_deposit` first. `anchor` requires it.
    owner: LookupMap<u8, AccountId>,
    anchor: LookupMap<u8, Anchored>,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            reports: LookupMap::new(b"s"),
            balances: LookupMap::new(b"b"),
            owner: LookupMap::new(b"o"),
            anchor: LookupMap::new(b"h"),
        }
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self::default()
    }

    /// Credits the attached deposit to the predecessor's prepaid storage.
    /// The storage this balance record uses is charged to that balance.
    /// Called once with the reporter's full-access key. A function-call key cannot attach a deposit.
    #[payable]
    pub fn storage_deposit(&mut self) {
        let account = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        let before = env::storage_usage();
        let balance = self
            .balances
            .get(&account)
            .copied()
            .unwrap_or(0)
            .saturating_add(attached);
        self.balances.insert(account.clone(), balance);
        if self.owner.get(&0).is_none() {
            self.owner.insert(0, account.clone());
        }
        self.charge(account, before);
    }

    /// Store the receipt-ledger head with this block height.
    /// No deposit: a function-call key cannot attach NEAR. Storage is charged
    /// to the owner's prepaid balance. Only the first depositor may call it.
    pub fn anchor(&mut self, head: String) {
        let account = env::predecessor_account_id();
        require!(self.owner.get(&0) == Some(&account), "only the owner");
        let before = env::storage_usage();
        self.anchor.insert(
            0,
            Anchored {
                head,
                block_height: env::block_height(),
            },
        );
        self.charge(account, before);
    }

    /// One report per reporter. No deposit: storage is charged to the prepaid balance.
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
        self.charge(reporter, before);
    }

    pub fn get(&self, account: String) -> Vec<Report> {
        self.reports.get(&account).cloned().unwrap_or_default()
    }

    pub fn storage_balance_of(&self, account: AccountId) -> NearToken {
        NearToken::from_yoctonear(self.balances.get(&account).copied().unwrap_or(0))
    }

    pub fn get_anchor(&self) -> Option<Anchored> {
        self.anchor.get(&0).cloned()
    }
}

impl Contract {
    fn charge(&mut self, account: AccountId, before: u64) {
        // store::LookupMap keeps writes in memory until flush. storage_usage misses them until then.
        self.reports.flush();
        self.balances.flush();
        self.owner.flush();
        self.anchor.flush();
        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost()
            .saturating_mul(u128::from(used))
            .as_yoctonear();
        let balance = self.balances.get(&account).copied().unwrap_or(0);
        require!(balance >= cost, "insufficient storage balance");
        if cost > 0 {
            self.balances.insert(account, balance - cost);
            self.balances.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_created_receipts, VMContextBuilder};
    use near_sdk::testing_env;

    fn context(predecessor: AccountId, deposit: NearToken) {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .block_height(42);
        testing_env!(builder.build());
    }

    #[test]
    fn deposit_is_spent_on_a_string_account_and_nothing_is_transferred() {
        let reporter = accounts(0);
        let deposit = NearToken::from_yoctonear(10_000_000_000_000_000_000_000);
        context(reporter.clone(), deposit);
        let mut contract = Contract::new();
        contract.storage_deposit();
        let after_deposit = contract.storage_balance_of(reporter.clone());
        assert!(after_deposit.as_yoctonear() > 0);
        assert!(after_deposit.as_yoctonear() < deposit.as_yoctonear());

        let subject = "0x0000000000000000000000000000000000000001".to_string();
        context(reporter.clone(), NearToken::from_yoctonear(0));
        contract.report(subject.clone(), "injection".to_string(), "ab".repeat(32));
        let after_report = contract.storage_balance_of(reporter.clone());
        assert!(after_report.as_yoctonear() < after_deposit.as_yoctonear());
        let stored = contract.get(subject);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].reporter, reporter);
        assert_eq!(stored[0].block_height, 42);
        assert!(get_created_receipts().is_empty());

        let balance = after_report;
        context(reporter.clone(), NearToken::from_yoctonear(0));
        contract.report(
            "0x0000000000000000000000000000000000000001".to_string(),
            "again".to_string(),
            "cd".repeat(32),
        );
        assert_eq!(contract.storage_balance_of(reporter).as_yoctonear(), balance.as_yoctonear());
        assert!(get_created_receipts().is_empty());
    }

    #[test]
    #[should_panic(expected = "insufficient storage balance")]
    fn a_deposit_smaller_than_its_record_is_refused() {
        context(accounts(0), NearToken::from_yoctonear(1));
        let mut contract = Contract::new();
        contract.storage_deposit();
    }

    #[test]
    #[should_panic(expected = "insufficient storage balance")]
    fn a_report_without_prepaid_storage_is_refused() {
        let reporter = accounts(0);
        context(reporter.clone(), NearToken::from_yoctonear(0));
        let mut contract = Contract::new();
        contract.report("bad.near".to_string(), "injection".to_string(), "ab".repeat(32));
    }

    #[test]
    fn the_owner_anchors_the_head_and_nothing_is_transferred() {
        let reporter = accounts(0);
        let deposit = NearToken::from_yoctonear(10_000_000_000_000_000_000_000);
        context(reporter.clone(), deposit);
        let mut contract = Contract::new();
        contract.storage_deposit();
        let after_deposit = contract.storage_balance_of(reporter.clone());
        context(reporter.clone(), NearToken::from_yoctonear(0));
        contract.anchor("abc".repeat(20));
        let stored = contract.get_anchor().expect("head");
        assert_eq!(stored.head, "abc".repeat(20));
        assert_eq!(stored.block_height, 42);
        assert!(contract.storage_balance_of(reporter).as_yoctonear() < after_deposit.as_yoctonear());
        assert!(get_created_receipts().is_empty());
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn another_account_cannot_anchor() {
        let reporter = accounts(0);
        context(reporter, NearToken::from_yoctonear(10_000_000_000_000_000_000_000));
        let mut contract = Contract::new();
        contract.storage_deposit();
        context(accounts(1), NearToken::from_yoctonear(0));
        contract.anchor("nope".to_string());
    }
}
