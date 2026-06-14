import { GbtGenerator, GbtResult, ThreadTransaction as RustThreadTransaction } from 'rust-gbt';
import logger from '../logger';
import {
  MempoolBlock,
  VerboseMempoolTransactionExtended,
  MempoolBlockWithTransactions,
  MempoolBlockDelta,
  CompactThreadTransaction,
  TransactionClassified,
  TransactionCompressed,
  MempoolDeltaChange,
  GbtCandidates,
  PoolTag,
} from '../mempool.interfaces';
import { Common, OnlineFeeStatsCalculator } from './common';
import config from '../config';
import { Worker } from 'worker_threads';
import path from 'path';
import PoolsRepository from '../repositories/PoolsRepository';

const MAX_UINT32 = Math.pow(2, 32) - 1;

class MempoolBlocks {
  private mempoolBlocks: MempoolBlockWithTransactions[] = [];
  private mempoolBlockDeltas: MempoolBlockDelta[] = [];
  private txSelectionWorker: Worker | null = null;
  private rustInitialized = false;
  private rustGbtGenerator: GbtGenerator = new GbtGenerator(
    config.EXPLORER.MIN_BLOCK_SIZE_UNITS,
    config.EXPLORER.MEMPOOL_BLOCKS_AMOUNT
  );

  private nextUid = 1;
  private uidMap: Map<number, string> = new Map(); // map short numerical uids to full txids
  private txidMap: Map<string, number> = new Map(); // map full txids back to short numerical uids

  private pools: { [id: number]: PoolTag } = {};

  public getMempoolBlocks(): MempoolBlock[] {
    return this.mempoolBlocks.map((block) => {
      return {
        blockSize: block.blockSize,
        nTx: block.nTx,
        totalFees: block.totalFees,
        medianFee: block.medianFee,
        feeRange: block.feeRange,
      };
    });
  }

  public getMempoolBlocksWithTransactions(): MempoolBlockWithTransactions[] {
    return this.mempoolBlocks;
  }

  public getMempoolBlockDeltas(): MempoolBlockDelta[] {
    return this.mempoolBlockDeltas;
  }

  public async updatePools$(): Promise<void> {
    if (['mainnet', 'testnet4', 'chipnet', 'scalenet'].includes(config.EXPLORER.NETWORK) === false) {
      this.pools = {};
      return;
    }
    const allPools = await PoolsRepository.$getPools();
    this.pools = {};
    for (const pool of allPools) {
      this.pools[pool.uniqueId] = pool;
    }
  }

  private calculateMempoolDeltas(
    prevBlocks: MempoolBlockWithTransactions[],
    mempoolBlocks: MempoolBlockWithTransactions[]
  ): MempoolBlockDelta[] {
    const mempoolBlockDeltas: MempoolBlockDelta[] = [];
    for (let i = 0; i < Math.max(mempoolBlocks.length, prevBlocks.length); i++) {
      let added: TransactionClassified[] = [];
      let removed: string[] = [];
      const changed: TransactionClassified[] = [];
      if (mempoolBlocks[i] && !prevBlocks[i]) {
        added = mempoolBlocks[i].transactions;
      } else if (!mempoolBlocks[i] && prevBlocks[i]) {
        removed = prevBlocks[i].transactions.map((tx) => tx.txid);
      } else if (mempoolBlocks[i] && prevBlocks[i]) {
        const prevIds = {};
        const newIds = {};
        prevBlocks[i].transactions.forEach((tx) => {
          prevIds[tx.txid] = tx;
        });
        mempoolBlocks[i].transactions.forEach((tx) => {
          newIds[tx.txid] = true;
        });
        prevBlocks[i].transactions.forEach((tx) => {
          if (!newIds[tx.txid]) {
            removed.push(tx.txid);
          }
        });
        mempoolBlocks[i].transactions.forEach((tx) => {
          if (!prevIds[tx.txid]) {
            added.push(tx);
          } else if (tx.rate !== prevIds[tx.txid].rate) {
            changed.push(tx);
          }
        });
      }
      mempoolBlockDeltas.push({
        added: added.map(this.compressTx),
        removed,
        changed: changed.map(this.compressDeltaChange),
      });
    }
    return mempoolBlockDeltas;
  }

  /**
   * Create block templates based on the current mempool.
   * This function is only called if RUST_GBT config is false, otherwise the rust implementation is used: $rustMakeBlockTemplates.
   *
   * @param transactions
   * @param newMempool
   * @param candidates
   * @param saveResults
   */
  public async $makeBlockTemplates(
    transactions: string[],
    newMempool: { [txid: string]: VerboseMempoolTransactionExtended },
    candidates: GbtCandidates | undefined,
    saveResults = false
  ): Promise<MempoolBlockWithTransactions[]> {
    const start = Date.now();

    // reset mempool short ids
    if (saveResults) {
      this.resetUids();
    }
    // set missing short ids
    for (const txid of transactions) {
      const tx = newMempool[txid];
      this.setUid(tx, !saveResults);
    }

    // prepare a stripped down version of the mempool with only the minimum necessary data
    // to reduce the overhead of passing this data to the worker thread
    const strippedMempool: Map<number, CompactThreadTransaction> = new Map();
    for (const txid of transactions) {
      const entry = newMempool[txid];
      if (entry.uid !== null && entry.uid !== undefined) {
        const stripped = {
          uid: entry.uid,
          fee: entry.fee,
          size: entry.size,
          sigops: entry.sigops,
          feePerSize: entry.feePerSize,
          inputs: entry.vin
            .map((v) => this.getUid(newMempool[v.txid]))
            .filter((uid) => uid !== null && uid !== undefined) as number[],
        };
        strippedMempool.set(entry.uid, stripped);
      }
    }

    // (re)initialize tx selection worker thread
    if (!this.txSelectionWorker) {
      this.txSelectionWorker = new Worker(path.resolve(__dirname, './tx-selection-worker.js'));
      // if the thread throws an unexpected error, or exits for any other reason,
      // reset worker state so that it will be re-initialized on the next run
      this.txSelectionWorker.once('error', () => {
        this.txSelectionWorker = null;
      });
      this.txSelectionWorker.once('exit', () => {
        this.txSelectionWorker = null;
      });
    }

    // run the block construction algorithm in a separate thread, and wait for a result
    let threadErrorListener;
    try {
      const workerResultPromise = new Promise<{
        blocks: number[][];
        rates: Map<number, number>;
      }>((resolve, reject) => {
        threadErrorListener = reject;
        this.txSelectionWorker?.once('message', (result): void => {
          resolve(result);
        });
        this.txSelectionWorker?.once('error', reject);
      });
      this.txSelectionWorker.postMessage({
        type: 'set',
        mempool: strippedMempool,
      });
      const { blocks, rates } = this.convertResultTxids(await workerResultPromise);

      // clean up thread error listener
      this.txSelectionWorker?.removeListener('error', threadErrorListener);

      const processed = this.processBlockTemplates(
        newMempool,
        blocks,
        null,
        Object.entries(rates),
        candidates,
        saveResults
      );

      logger.debug(`makeBlockTemplates completed in ${(Date.now() - start) / 1000} seconds`);

      return processed;
    } catch (e) {
      logger.err('makeBlockTemplates failed. ' + (e instanceof Error ? e.message : e));
    }
    return this.mempoolBlocks;
  }

  /**
   * Update the block templates based on the changes in the mempool.
   * This function is only called if RUST_GBT config is false, otherwise the rust implementation is used: $rustUpdateBlockTemplates.
   *
   * @param transactions
   * @param newMempool
   * @param added
   * @param removed
   * @param candidates
   * @param saveResults
   */
  public async $updateBlockTemplates(
    transactions: string[],
    newMempool: { [txid: string]: VerboseMempoolTransactionExtended },
    added: VerboseMempoolTransactionExtended[],
    removed: VerboseMempoolTransactionExtended[],
    candidates: GbtCandidates | undefined,
    saveResults = false
  ): Promise<void> {
    if (!this.txSelectionWorker) {
      // need to reset the worker
      await this.$makeBlockTemplates(transactions, newMempool, candidates, saveResults);
      return;
    }

    const start = Date.now();

    const addedAndChanged = added;
    for (const tx of addedAndChanged) {
      this.setUid(tx, false);
    }
    const removedTxs = removed.filter((tx) => tx.uid) as VerboseMempoolTransactionExtended[];

    // prepare a stripped down version of the mempool with only the minimum necessary data
    // to reduce the overhead of passing this data to the worker thread
    const addedStripped: CompactThreadTransaction[] = addedAndChanged
      .filter((entry) => entry.uid)
      .map((entry) => {
        return {
          uid: entry.uid || 0,
          fee: entry.fee,
          size: entry.size,
          sigops: entry.sigops,
          feePerSize: entry.feePerSize,
          inputs: entry.vin
            .map((v) => this.getUid(newMempool[v.txid]))
            .filter((uid) => uid !== null && uid !== undefined) as number[],
        };
      });

    // run the block construction algorithm in a separate thread, and wait for a result
    let threadErrorListener;
    try {
      const workerResultPromise = new Promise<{
        blocks: number[][];
        rates: Map<number, number>;
      }>((resolve, reject) => {
        threadErrorListener = reject;
        this.txSelectionWorker?.once('message', (result): void => {
          resolve(result);
        });
        this.txSelectionWorker?.once('error', reject);
      });
      this.txSelectionWorker.postMessage({
        type: 'update',
        added: addedStripped,
        removed: removedTxs.map((tx) => tx.uid) as number[],
      });
      const { blocks, rates } = this.convertResultTxids(await workerResultPromise);

      this.removeUids(removedTxs);

      // clean up thread error listener
      this.txSelectionWorker?.removeListener('error', threadErrorListener);

      this.processBlockTemplates(newMempool, blocks, null, Object.entries(rates), candidates, saveResults);
      logger.debug(`updateBlockTemplates completed in ${(Date.now() - start) / 1000} seconds`);
    } catch (e) {
      logger.err('updateBlockTemplates failed. ' + (e instanceof Error ? e.message : e));
    }
  }

  private resetRustGbt(): void {
    this.rustInitialized = false;
    this.rustGbtGenerator = new GbtGenerator(
      config.EXPLORER.MIN_BLOCK_SIZE_UNITS,
      config.EXPLORER.MEMPOOL_BLOCKS_AMOUNT
    );
  }

  /**
   * Create block templates using the Rust GBT generator.
   * This function is only called if RUST_GBT config is true.
   *
   * @param txids
   * @param newMempool
   * @param candidates
   * @param saveResults
   * @returns
   */
  public async $rustMakeBlockTemplates(
    txids: string[],
    newMempool: { [txid: string]: VerboseMempoolTransactionExtended },
    candidates: GbtCandidates | undefined,
    saveResults = false
  ): Promise<MempoolBlockWithTransactions[]> {
    const start = Date.now();

    // reset mempool short ids
    if (saveResults) {
      this.resetUids();
    }

    const transactions = txids.map((txid) => newMempool[txid]).filter((tx) => tx);
    const missingFromMempool = txids.length - transactions.length;
    if (missingFromMempool > 0) {
      logger.debug(
        `RUST makeBlockTemplates: ${missingFromMempool} txid(s) in txids list not found in newMempool (dropped before Rust): ${txids
          .filter((txid) => !newMempool[txid])
          .join(', ')}`
      );
    }
    // set missing short ids
    for (const tx of transactions) {
      this.setUid(tx, !saveResults);
    }
    // set short ids for transaction inputs (deduplicate: a tx may spend multiple outputs of the
    // same parent, which must count as only one dependency to avoid inflating missing_parent_count)
    for (const tx of transactions) {
      tx.inputs = [
        ...new Set(
          tx.vin
            .map((v) => this.getUid(newMempool[v.txid]))
            .filter((uid): uid is number => uid !== null && uid !== undefined)
        ),
      ];
    }
    const txsWithNoUid = transactions.filter((tx) => !tx.uid);
    if (txsWithNoUid.length > 0) {
      logger.debug(
        `RUST makeBlockTemplates: ${txsWithNoUid.length} tx(s) have no uid after setUid (will be skipped by Rust): ${txsWithNoUid
          .map((tx) => tx.txid)
          .join(', ')}`
      );
    }

    // run the block construction algorithm in a separate thread, and wait for a result
    const rustGbt = saveResults
      ? this.rustGbtGenerator
      : new GbtGenerator(config.EXPLORER.MIN_BLOCK_SIZE_UNITS, config.EXPLORER.MEMPOOL_BLOCKS_AMOUNT);
    try {
      const { blocks, blockSizes, rates, overflow } = this.convertNapiResultTxids(
        await rustGbt.make(transactions as RustThreadTransaction[], this.nextUid)
      );
      if (saveResults) {
        this.rustInitialized = true;
      }
      const expectedSize = transactions.length;
      const resultMempoolSize = blocks.reduce((total, block) => total + block.length, 0) + overflow.length;
      logger.debug(
        `RUST updateBlockTemplates returned ${resultMempoolSize} txs out of ${expectedSize} in the mempool, ${overflow.length} were unmineable`
      );
      const processed = this.processBlockTemplates(newMempool, blocks, blockSizes, rates, candidates, saveResults);
      logger.debug(`RUST makeBlockTemplates completed in ${(Date.now() - start) / 1000} seconds`);
      return processed;
    } catch (e) {
      logger.err('RUST makeBlockTemplates failed. ' + (e instanceof Error ? e.message : e));
      if (saveResults) {
        this.resetRustGbt();
      }
    }
    return this.mempoolBlocks;
  }

  // Unused method
  public async $oneOffRustBlockTemplates(
    transactions: string[],
    newMempool: { [txid: string]: VerboseMempoolTransactionExtended },
    candidates: GbtCandidates | undefined
  ): Promise<MempoolBlockWithTransactions[]> {
    return this.$rustMakeBlockTemplates(transactions, newMempool, candidates, false);
  }

  /**
   * Update the block templates based on the changes in the mempool.
   * This function is called if RUST_GBT config is true.
   *
   * @param transactions
   * @param newMempool
   * @param added
   * @param removed
   * @param candidates
   * @returns
   */
  public async $rustUpdateBlockTemplates(
    transactions: string[],
    newMempool: { [txid: string]: VerboseMempoolTransactionExtended },
    added: VerboseMempoolTransactionExtended[],
    removed: VerboseMempoolTransactionExtended[],
    candidates: GbtCandidates | undefined
  ): Promise<MempoolBlockWithTransactions[]> {
    // GBT optimization requires that uids never get too sparse
    // as a sanity check, we should also explicitly prevent uint32 uid overflow
    if (this.nextUid + added.length >= Math.min(Math.max(262144, 2 * transactions.length), MAX_UINT32)) {
      this.resetRustGbt();
    }

    if (!this.rustInitialized) {
      // need to reset the worker
      return this.$rustMakeBlockTemplates(transactions, newMempool, candidates, true);
    }

    const start = Date.now();
    // set missing short ids
    for (const tx of added) {
      this.setUid(tx, false);
    }
    // set short ids for transaction inputs (deduplicate: a tx may spend multiple outputs of the
    // same parent, which must count as only one dependency to avoid inflating missing_parent_count)
    for (const tx of added) {
      tx.inputs = [
        ...new Set(tx.vin.map((v) => this.getUid(newMempool[v.txid])).filter((uid): uid is number => !!uid)),
      ];
    }
    const removedTxs = removed.filter((tx) => tx.uid) as VerboseMempoolTransactionExtended[];
    const removedWithoutUid = removed.length - removedTxs.length;
    if (removedWithoutUid > 0) {
      logger.debug(
        `RUST updateBlockTemplates: ${removedWithoutUid} removed tx(s) had no uid (not forwarded to Rust remove list)`
      );
    }
    const addedWithNoUid = added.filter((tx) => !tx.uid);
    if (addedWithNoUid.length > 0) {
      logger.debug(
        `RUST updateBlockTemplates: ${addedWithNoUid.length} added tx(s) have no uid after setUid (will be skipped by Rust): ${addedWithNoUid
          .map((tx) => tx.txid)
          .join(', ')}`
      );
    }

    // run the block construction algorithm in a separate thread, and wait for a result
    try {
      const { blocks, blockSizes, rates, overflow } = this.convertNapiResultTxids(
        await this.rustGbtGenerator.update(
          added as RustThreadTransaction[],
          removedTxs.map((tx) => tx.uid) as number[],
          this.nextUid
        )
      );
      const resultMempoolSize = blocks.reduce((total, block) => total + block.length, 0) + overflow.length;
      logger.debug(
        `RUST updateBlockTemplates returned ${resultMempoolSize} txs out of ${transactions.length} candidates, ${overflow.length} were unmineable`
      );
      if (transactions.length !== resultMempoolSize) {
        throw new Error(
          `GBT returned wrong number of transactions ${transactions.length} vs ${resultMempoolSize}, cache is probably out of sync`
        );
      } else {
        const processed = this.processBlockTemplates(newMempool, blocks, blockSizes, rates, candidates, true);
        this.removeUids(removedTxs);
        logger.debug(`RUST updateBlockTemplates completed in ${(Date.now() - start) / 1000} seconds`);
        return processed;
      }
    } catch (e) {
      logger.err('RUST updateBlockTemplates failed. ' + (e instanceof Error ? e.message : e));
      this.resetRustGbt();
      return this.mempoolBlocks;
    }
  }

  private processBlockTemplates(
    mempool: { [txid: string]: VerboseMempoolTransactionExtended },
    blocks: string[][],
    blockSizes: number[] | null,
    rates: [string, number][],
    candidates: GbtCandidates | undefined, // candidates is not used in BCH (this is used in BTC for CPFP)
    saveResults
  ): MempoolBlockWithTransactions[] {
    for (const [txid, rate] of rates) {
      if (txid in mempool) {
        mempool[txid].feePerSize = rate;
      }
    }

    const lastBlockIndex = blocks.length - 1;
    let hasBlockStack = blocks.length >= 8;
    let stackSize;
    let feeStatsCalculator: OnlineFeeStatsCalculator | null = null;
    if (hasBlockStack) {
      if (blockSizes && blockSizes[7] !== null) {
        stackSize = blockSizes[7];
      } else {
        stackSize = blocks[lastBlockIndex].reduce((total, tx) => total + (mempool[tx]?.size || 0), 0);
      }
      hasBlockStack = stackSize > config.EXPLORER.MIN_BLOCK_SIZE_UNITS;
      feeStatsCalculator = new OnlineFeeStatsCalculator(stackSize, 0.5, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
    }

    const sizeLimit = config.EXPLORER.MIN_BLOCK_SIZE_UNITS;
    // update this thread's mempool with the results
    let mempoolTx: VerboseMempoolTransactionExtended;
    const mempoolBlocks: MempoolBlockWithTransactions[] = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      let totalSize = 0;
      let totalFees = 0;
      const transactions: VerboseMempoolTransactionExtended[] = [];

      // backfill purged transactions
      if (candidates?.txs && blockIndex === blocks.length - 1) {
        for (const txid of Object.keys(mempool)) {
          if (!candidates.txs[txid]) {
            block.push(txid);
          }
        }
      }

      for (let i = 0; i < block.length; i++) {
        const txid = block[i];
        if (txid in mempool) {
          mempoolTx = mempool[txid];
          // save position in projected blocks
          mempoolTx.position = {
            block: blockIndex,
            size: totalSize + mempoolTx.size / 2,
          };

          // online calculation of stack-of-blocks fee stats
          if (hasBlockStack && blockIndex === lastBlockIndex && feeStatsCalculator) {
            feeStatsCalculator.processNext(mempoolTx);
          }

          totalSize += mempoolTx.size;
          totalFees += mempoolTx.fee;

          if (totalSize <= sizeLimit) {
            transactions.push(mempoolTx);
          }
        }
      }
      mempoolBlocks[blockIndex] = this.dataToMempoolBlocks(block, transactions, totalSize, totalFees);
    }

    if (saveResults) {
      const deltas = this.calculateMempoolDeltas(this.mempoolBlocks, mempoolBlocks);
      this.mempoolBlocks = mempoolBlocks;
      this.mempoolBlockDeltas = deltas;
    }

    return mempoolBlocks;
  }

  private dataToMempoolBlocks(
    transactionIds: string[],
    transactions: VerboseMempoolTransactionExtended[],
    totalSize: number,
    totalFees: number
  ): MempoolBlockWithTransactions {
    return {
      blockSize: totalSize,
      nTx: transactionIds.length,
      totalFees: totalFees,
      medianFee: Common.percentile(
        transactions.map((tx) => tx.feePerSize),
        config.EXPLORER.RECOMMENDED_FEE_PERCENTILE
      ),
      feeRange: Common.getFeesInRange(transactions, 8),
      transactionIds: transactionIds,
      transactions: transactions.map((tx) => Common.classifyTransaction(tx)),
    };
  }

  private resetUids(): void {
    this.uidMap.clear();
    this.txidMap.clear();
    this.nextUid = 1;
  }

  private setUid(tx: VerboseMempoolTransactionExtended, skipSet = false): number {
    if (!this.txidMap.has(tx.txid) || !skipSet) {
      const uid = this.nextUid;
      this.nextUid++;
      this.uidMap.set(uid, tx.txid);
      this.txidMap.set(tx.txid, uid);
      tx.uid = uid;
      return uid;
    } else {
      tx.uid = this.txidMap.get(tx.txid) as number;
      return tx.uid;
    }
  }

  private getUid(tx: VerboseMempoolTransactionExtended): number | void {
    if (tx) {
      return this.txidMap.get(tx.txid);
    }
  }

  private removeUids(txs: VerboseMempoolTransactionExtended[]): void {
    for (const tx of txs) {
      const uid = this.txidMap.get(tx.txid);
      if (uid != null) {
        this.uidMap.delete(uid);
        this.txidMap.delete(tx.txid);
      }
      tx.uid = undefined;
    }
  }

  private convertResultTxids({ blocks, rates }: { blocks: number[][]; rates: Map<number, number> }): {
    blocks: string[][];
    rates: { [root: string]: number };
  } {
    const convertedBlocks: string[][] = blocks.map((block) =>
      block.map((uid) => {
        return this.uidMap.get(uid) || '';
      })
    );
    const convertedRates = {};
    for (const rateUid of rates.keys()) {
      const rateTxid = this.uidMap.get(rateUid);
      if (rateTxid) {
        convertedRates[rateTxid] = rates.get(rateUid);
      }
    }

    return {
      blocks: convertedBlocks,
      rates: convertedRates,
    } as {
      blocks: string[][];
      rates: { [root: string]: number };
    };
  }

  private convertNapiResultTxids({ blocks, blockSizes, rates, overflow }: GbtResult): {
    blocks: string[][];
    blockSizes: number[];
    rates: [string, number][];
    overflow: string[];
  } {
    const convertedBlocks: string[][] = blocks.map((block) =>
      block.map((uid) => {
        const txid = this.uidMap.get(uid);
        if (txid !== undefined) {
          return txid;
        } else {
          throw new Error('GBT returned a block containing a transaction with unknown uid');
        }
      })
    );
    const convertedRates: [string, number][] = [];
    for (const [rateUid, rate] of rates) {
      const rateTxid = this.uidMap.get(rateUid) as string;
      convertedRates.push([rateTxid, rate]);
    }
    const convertedOverflow: string[] = overflow.map((uid) => {
      const txid = this.uidMap.get(uid);
      if (txid !== undefined) {
        return txid;
      } else {
        throw new Error('GBT returned an unmineable transaction with unknown uid');
      }
    });
    return {
      blocks: convertedBlocks,
      blockSizes: blockSizes,
      rates: convertedRates,
      overflow: convertedOverflow,
    };
  }

  public compressTx(tx: TransactionClassified): TransactionCompressed {
    return [
      tx.txid,
      tx.fee,
      tx.size,
      tx.value,
      Math.round((tx.rate || tx.fee / tx.size) * 100) / 100,
      tx.flags,
      tx.time || 0,
    ];
  }

  public compressDeltaChange(tx: TransactionClassified): MempoolDeltaChange {
    return [tx.txid, Math.round((tx.rate || tx.fee / tx.size) * 100) / 100, tx.flags];
  }
}

export default new MempoolBlocks();
