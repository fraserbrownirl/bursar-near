use near_sdk::{env, near, require, AccountId, PanicOnDefault, Promise};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Anchored {
    pub head: String,
    pub block_height: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    anchor: Option<Anchored>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, anchor: None }
    }

    /// Store the receipt-ledger head. The predecessor is the account that
    /// holds the function-call key. The attached deposit covers new storage.
    #[payable]
    pub fn anchor(&mut self, head: String) {
        let predecessor = env::predecessor_account_id();
        require!(predecessor == self.owner, "only the owner");
        let before = env::storage_usage();
        self.anchor = Some(Anchored {
            head,
            block_height: env::block_height(),
        });
        let after = env::storage_usage();
        let attached = env::attached_deposit();
        if after > before {
            let required = env::storage_byte_cost().saturating_mul(u128::from(after - before));
            require!(attached >= required, "insufficient deposit for storage");
            let refund = attached.saturating_sub(required);
            if refund.as_yoctonear() > 0 {
                Promise::new(predecessor).transfer(refund).detach();
            }
        } else if attached.as_yoctonear() > 0 {
            Promise::new(predecessor).transfer(attached).detach();
        }
    }

    pub fn get_anchor(&self) -> Option<Anchored> {
        self.anchor.clone()
    }
}
