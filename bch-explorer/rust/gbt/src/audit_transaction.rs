use crate::{
    u32_hasher_types::{u32hashset_new, U32HasherState},
    ThreadTransaction,
};
use std::{
    collections::HashSet,
    hash::{Hash, Hasher},
};

#[derive(Clone, Debug)]
pub struct AuditTransaction {
    pub uid: u32,
    order: u32,
    pub size: u32,
    pub sigops: u32,
    fee_per_size: f64,
    pub inputs: Vec<u32>,
    pub children: HashSet<u32, U32HasherState>,
    /// Number of in-mempool parents not yet added to any projected block.
    /// Starts at the count of inputs that exist in the audit pool.
    /// Decremented each time a parent is added to a block.
    /// When it reaches 0 the transaction is eligible for inclusion.
    pub missing_parent_count: u32,
    pub used: bool,
}

impl Hash for AuditTransaction {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.uid.hash(state);
    }
}

impl PartialEq for AuditTransaction {
    fn eq(&self, other: &Self) -> bool {
        self.uid == other.uid
    }
}

impl Eq for AuditTransaction {}

impl AuditTransaction {
    pub fn from_thread_transaction(tx: &ThreadTransaction) -> Self {
        Self {
            uid: tx.uid,
            order: tx.order,
            size: tx.size,
            sigops: tx.sigops,
            fee_per_size: tx.fee_per_size,
            inputs: tx.inputs.clone(),
            children: u32hashset_new(),
            missing_parent_count: 0,
            used: false,
        }
    }

    /// Returns the fee-per-byte rate used for sorting (descending = highest priority first).
    #[inline]
    pub const fn score(&self) -> f64 {
        self.fee_per_size
    }

    #[inline]
    pub const fn order(&self) -> u32 {
        self.order
    }
}
