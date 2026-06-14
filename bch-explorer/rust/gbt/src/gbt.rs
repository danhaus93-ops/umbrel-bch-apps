use std::{collections::VecDeque, mem::ManuallyDrop};
use tracing::{debug, info, warn};

use crate::{
    audit_transaction::AuditTransaction,
    u32_hasher_types::{u32hashset_new, U32HasherState},
    GbtResult, ThreadTransactionsMap,
};

// BCHN coinbase reservation (matches resetBlock() in BCHN miner.cpp)
const BLOCK_RESERVED_SIZE: u32 = 1_000;
const BLOCK_RESERVED_SIGCHECKS: u32 = 100;

// Give up trying to fill the current block after this many consecutive failures
// when the block is nearly full (matches MAX_CONSECUTIVE_FAILURES in BCHN miner.cpp)
const MAX_CONSECUTIVE_FAILURES: u32 = 1_000;

type AuditPool = Vec<Option<ManuallyDrop<AuditTransaction>>>;

/// Build projected mempool blocks using the BCHN `addTxs` transaction selection algorithm.
///
/// See `BlockAssembler::addTxs` in BCHN's
/// [miner.cpp](https://gitlab.com/bitcoin-cash-node/bitcoin-cash-node/-/blob/master/src/miner.cpp).
///
/// Transactions are selected individually in descending fee-per-byte order.
/// Topological ordering is enforced via a per-transaction `missing_parent_count` that
/// is decremented as parents are added to the block. Children whose count reaches zero
/// are moved to a backlog queue for immediate processing.
pub fn gbt(
    mempool: &mut ThreadTransactionsMap,
    max_uid: usize,
    max_block_size: u32,
    max_blocks: usize,
) -> GbtResult {
    // BCH consensus sigchecks limit: GetMaxBlockSigChecksCount(blockSize) = blockSize / 141
    let max_sigchecks: u32 = max_block_size / 141;

    info!("Initializing working vecs with uid capacity for {}", max_uid + 1);
    let mempool_len = mempool.len();
    let mut audit_pool: AuditPool = Vec::with_capacity(max_uid + 1);
    audit_pool.resize(max_uid + 1, None);
    let mut  mempool_stack: Vec<u32> = Vec::with_capacity(mempool_len);

    // Phase 1: populate audit pool
    info!("Building audit pool");
    for (uid, tx) in &mut *mempool {
        let audit_tx = AuditTransaction::from_thread_transaction(tx);
        // Safety: audit_pool and mempool_stack must always contain the same transactions
        audit_pool[*uid as usize] = Some(ManuallyDrop::new(audit_tx));
        mempool_stack.push(*uid);
    }

    // Phase 2: build children sets and initialize missing_parent_count
    info!("Building parent→child relationships");
    for &txid in & mempool_stack {
        // Collect inputs first to avoid borrowing audit_pool mutably and immutably at once.
        // Deduplicate so a tx spending multiple outputs of the same parent doesn't inflate
        // missing_parent_count beyond what the parent can decrement via its children HashSet.
        let mut inputs: Vec<u32> = if let Some(Some(tx)) = audit_pool.get(txid as usize) {
            tx.inputs.clone()
        } else {
            continue;
        };
        inputs.sort_unstable();
        inputs.dedup();

        for parent_uid in inputs {
            if let Some(Some(_parent)) = audit_pool.get(parent_uid as usize) {
                // parent is in the mempool: register the relationship
                if let Some(Some(parent)) = audit_pool.get_mut(parent_uid as usize) {
                    parent.children.insert(txid);
                }
                if let Some(Some(tx)) = audit_pool.get_mut(txid as usize) {
                    tx.missing_parent_count += 1;
                }
            }
        }
    }

    // Phase 3: sort by descending fee_per_size; tie-break by ascending order (partial txid)
    info!("Sorting by descending fee rate");
    let mut sorted: Vec<u32> =  mempool_stack;
    sorted.sort_unstable_by(|&a, &b| {
        let ta = audit_pool[a as usize].as_ref().expect("uid in audit_pool");
        let tb = audit_pool[b as usize].as_ref().expect("uid in audit_pool");
        // primary: descending score (fee_per_size)
        tb.score()
            .partial_cmp(&ta.score())
            .unwrap_or(std::cmp::Ordering::Equal)
            // tie-break: ascending order (lower partial txid first, matches lexicographic txid order)
            .then_with(|| ta.order().cmp(&tb.order()))
    });

    // Phase 4: build projected blocks (BCHN addTxs algorithm)
    info!("Building blocks (BCHN addTxs)");
    let mut blocks: Vec<Vec<u32>> = Vec::new();
    let mut block_sizes: Vec<u32> = Vec::new();
    let mut sorted_idx: usize = 0;
    let mut backlog: VecDeque<u32> = VecDeque::new();
    // Tracks txs that were encountered in the sorted list but skipped due to missing parents.
    // Only these are eligible for promotion to the backlog once their parents are added.
    let mut skipped_uids: std::collections::HashSet<u32, U32HasherState> = u32hashset_new();

    for _ in 0..max_blocks {
        let mut block_size: u32 = BLOCK_RESERVED_SIZE;
        let mut block_sigchecks: u32 = BLOCK_RESERVED_SIGCHECKS;
        let mut consecutive_failures: u32 = 0;
        let mut transactions: Vec<u32> = Vec::with_capacity(4096.min(mempool_len));
        // Backlog items that didn't fit in this block; prepended to backlog for the next block.
        let mut next_block_deferred: Vec<u32> = Vec::new();

        loop {
            // Prefer the backlog (children whose parents were just added) over the sorted list
            let (next_uid, from_backlog) = if let Some(uid) = backlog.pop_front() {
                (uid, true)
            } else if sorted_idx < sorted.len() {
                let uid = sorted[sorted_idx];
                sorted_idx += 1;
                (uid, false)
            } else {
                break; // both sources exhausted
            };

            // Skip transactions already added to a previous block
            let tx_used = audit_pool
                .get(next_uid as usize)
                .and_then(Option::as_ref)
                .map_or(true, |tx| tx.used);
            if tx_used {
                continue;
            }

            // Topological constraint: all in-mempool parents must have been added first
            let missing = audit_pool[next_uid as usize]
                .as_ref()
                .map_or(0, |tx| tx.missing_parent_count);
            if missing > 0 {
                // Record that this tx was encountered; it will be promoted to the backlog
                // once its last parent is added.
                skipped_uids.insert(next_uid);
                continue;
            }

            let (tx_size, tx_sigops) = audit_pool[next_uid as usize]
                .as_ref()
                .map_or((0, 0), |tx| (tx.size, tx.sigops));

            // BCHN TestTx: two independent BCH block limits (raw bytes + sigchecks)
            if block_size + tx_size >= max_block_size
                || block_sigchecks + tx_sigops >= max_sigchecks
            {
                consecutive_failures += 1;
                if from_backlog {
                    // Keep for the next block rather than discarding
                    next_block_deferred.push(next_uid);
                }
                // BCHN give-up condition: many failures when close to full
                if consecutive_failures > MAX_CONSECUTIVE_FAILURES
                    && block_size > max_block_size - 1_000
                {
                    break;
                }
                continue;
            }

            // Add transaction to the current block
            if let Some(Some(tx)) = audit_pool.get_mut(next_uid as usize) {
                tx.used = true;
                transactions.push(tx.uid);
                block_size += tx.size;
                block_sigchecks += tx.sigops;
                consecutive_failures = 0;

                // Collect children before releasing the borrow
                let children: Vec<u32> = tx.children.iter().copied().collect();

                // Decrement missing_parent_count for all children
                for child_uid in children {
                    if let Some(Some(child)) = audit_pool.get_mut(child_uid as usize) {
                        if child.missing_parent_count > 0 {
                            child.missing_parent_count -= 1;
                        }
                        // Promote to backlog if the child was previously skipped in the
                        // sorted iteration and is now fully unblocked
                        if child.missing_parent_count == 0
                            && skipped_uids.contains(&child_uid)
                            && !child.used
                        {
                            backlog.push_back(child_uid);
                        }
                    }
                }
            }
        }

        if transactions.is_empty() {
            // Re-queue any deferred items so they appear in overflow
            for uid in next_block_deferred.drain(..).rev() {
                backlog.push_front(uid);
            }
            break;
        }

        blocks.push(transactions);
        block_sizes.push(block_size);

        // Deferred backlog items couldn't fit in this block; try them first in the next one
        for uid in next_block_deferred.drain(..).rev() {
            backlog.push_front(uid);
        }
    }

    // Phase 5: collect remaining unused transactions as overflow
    info!("Collecting overflow transactions");

    // Any uid still in skipped_uids with missing_parent_count > 0 will never be included.
    // These are in-mempool children whose parents were also never included (e.g. pruned before
    // the algorithm reached them, or part of a cycle). Log them so we can diagnose gaps.
    let stuck_count = skipped_uids.iter().filter(|&&uid| {
        audit_pool
            .get(uid as usize)
            .and_then(Option::as_ref)
            .map_or(false, |tx| tx.missing_parent_count > 0 && !tx.used)
    }).count();
    if stuck_count > 0 {
        warn!(
            "{} tx(s) stuck in skipped_uids with unresolved parents (included in overflow)",
            stuck_count
        );
        for &uid in &skipped_uids {
            if let Some(Some(tx)) = audit_pool.get(uid as usize) {
                if tx.missing_parent_count > 0 && !tx.used {
                    debug!(
                        "  stuck uid={} missing_parent_count={} inputs={:?}",
                        uid, tx.missing_parent_count, tx.inputs
                    );
                }
            }
        }
    }

    // Collect all unused transactions: remaining sorted list, backlog, and any transactions
    // stuck in skipped_uids (e.g. due to duplicate parent UIDs inflating missing_parent_count).
    // Use a seen-set to deduplicate across the three sources.
    let mut seen = u32hashset_new();
    let overflow: Vec<u32> = sorted[sorted_idx..]
        .iter()
        .chain(backlog.iter())
        .chain(skipped_uids.iter())
        .copied()
        .filter(|&uid| {
            if !seen.insert(uid) {
                return false;
            }
            audit_pool
                .get(uid as usize)
                .and_then(Option::as_ref)
                .map_or(false, |tx| !tx.used)
        })
        .collect();

    let total_accounted = blocks.iter().map(|b| b.len()).sum::<usize>() + overflow.len();
    debug!(
        "gbt summary: mempool={} placed_in_blocks={} overflow={} total_accounted={} unaccounted={}",
        mempool_len,
        blocks.iter().map(|b| b.len()).sum::<usize>(),
        overflow.len(),
        total_accounted,
        mempool_len.saturating_sub(total_accounted),
    );

    debug!("blocks: {:#?}", blocks);
    debug!("overflow count: {}", overflow.len());

    // Drop all ManuallyDrop<AuditTransaction> allocations
    for (uid, _thread_tx) in mempool.iter() {
        if let Some(audit_tx) = audit_pool
            .get_mut(*uid as usize)
            .and_then(Option::take)
        {
            ManuallyDrop::into_inner(audit_tx);
        }
    }

    // The BCHN algorithm selects transactions on their own fee_per_size without
    // ancestor-score recalculation, so no rate adjustments are needed.
    let rates: Vec<Vec<f64>> = Vec::new();

    GbtResult {
        blocks,
        block_sizes,
        rates,
        overflow,
    }
}
