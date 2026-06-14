import config from '../config';
import bitcoinApi from './bitcoin/bitcoin-api-factory';
import {
  VerboseMempoolTransactionExtended,
  VerboseTransactionExtended,
  BytesPerSecond,
  GbtCandidates,
} from '../mempool.interfaces';
import logger from '../logger';
import { Common } from './common';
import transactionUtils from './transaction-utils';
import { IBitcoinApi } from './bitcoin/bitcoin-api.interface';
import loadingIndicators from './loading-indicators';
import bitcoinClient from './bitcoin/bitcoin-client';
import bitcoinSecondClient from './bitcoin/bitcoin-second-client';
import valkeyCache from './valkey-cache';
import blocks from './blocks';

class Mempool {
  private inSync = false;
  private mempoolCacheDelta = -1;
  private mempoolCache: { [txId: string]: VerboseMempoolTransactionExtended } = {};
  private mempoolCandidates: { [txid: string]: boolean } = {};
  private spendMap = new Map<string, VerboseMempoolTransactionExtended>();
  private recentlyDeleted: VerboseMempoolTransactionExtended[][] = []; // buffer of transactions deleted in recent mempool updates
  private mempoolInfo: IBitcoinApi.MempoolInfo;
  private mempoolChangedCallback:
    | ((
        newMempool: { [txId: string]: VerboseMempoolTransactionExtended },
        newTransactions: VerboseMempoolTransactionExtended[],
        deletedTransactions: VerboseMempoolTransactionExtended[][]
      ) => void)
    | undefined;
  private $asyncMempoolChangedCallback:
    | ((
        newMempool: { [txId: string]: VerboseMempoolTransactionExtended },
        mempoolSize: number,
        newTransactions: VerboseMempoolTransactionExtended[],
        deletedTransactions: VerboseMempoolTransactionExtended[][],
        candidates?: GbtCandidates
      ) => Promise<void>)
    | undefined;

  private txPerSecondArray: number[] = [];
  private txPerSecond = 0;

  private bytesPerSecondArray: BytesPerSecond[] = [];
  private bytesPerSecond = 0;
  private mempoolProtection = 0;
  private latestTransactions: any[] = [];

  private ESPLORA_MISSING_TX_WARNING_THRESHOLD = 100;
  private ESPLORA_BATCH_QUERY_BASE_SIZE = 1000;
  private SAMPLE_TIME = 10000; // In ms
  private timer = new Date().getTime();
  private missingTxCount = 0;
  private mainLoopTimeout = 120000;
  private txPerSecondInterval: NodeJS.Timeout | null = null;

  public limitGBT = config.EXPLORER.USE_SECOND_NODE_FOR_MINFEE && config.EXPLORER.LIMIT_GBT;

  constructor() {
    // Initialize mempoolInfo here to avoid circular dependency issues
    // Use config directly instead of Common.isLiquid() to break circular dependency
    this.mempoolInfo = {
      loaded: false,
      size: 0,
      bytes: 0,
      usage: 0,
      total_fee: 0,
      maxmempool: 300000000,
      mempoolminfee: 0.00001,
      minrelaytxfee: 0.00001,
    };
    this.txPerSecondInterval = setInterval(this.updateTxPerSecond.bind(this), 1000);
  }

  /**
   * Cleanup resources (timers, etc.)
   * This should only be called when shutting down or in test teardown
   */
  public destroy(): void {
    if (this.txPerSecondInterval) {
      clearInterval(this.txPerSecondInterval);
      this.txPerSecondInterval = null;
    }
  }

  /**
   * Return true if we should leave resources available for mempool tx caching
   */
  public hasPriority(): boolean {
    if (this.inSync) {
      return false;
    } else {
      return this.mempoolCacheDelta == -1 || this.mempoolCacheDelta > 25;
    }
  }

  public isInSync(): boolean {
    return this.inSync;
  }

  public setOutOfSync(): void {
    this.inSync = false;
    loadingIndicators.setProgress('mempool', 99);
  }

  public getLatestTransactions() {
    return this.latestTransactions;
  }

  public setMempoolChangedCallback(
    fn: (
      newMempool: { [txId: string]: VerboseMempoolTransactionExtended },
      newTransactions: VerboseMempoolTransactionExtended[],
      deletedTransactions: VerboseMempoolTransactionExtended[][]
    ) => void
  ): void {
    this.mempoolChangedCallback = fn;
  }

  public setAsyncMempoolChangedCallback(
    fn: (
      newMempool: { [txId: string]: VerboseMempoolTransactionExtended },
      mempoolSize: number,
      newTransactions: VerboseMempoolTransactionExtended[],
      deletedTransactions: VerboseMempoolTransactionExtended[][],
      candidates?: GbtCandidates
    ) => Promise<void>
  ): void {
    this.$asyncMempoolChangedCallback = fn;
  }

  public getMempool(): { [txid: string]: VerboseMempoolTransactionExtended } {
    return this.mempoolCache;
  }

  public getSpendMap(): Map<string, VerboseMempoolTransactionExtended> {
    return this.spendMap;
  }

  public getFromSpendMap(txid, index): VerboseMempoolTransactionExtended | void {
    return this.spendMap.get(`${txid}:${index}`);
  }

  public async $setMempool(mempoolData: { [txId: string]: VerboseMempoolTransactionExtended }) {
    this.mempoolCache = mempoolData;
    let count = 0;
    const valkeyTimer = Date.now();
    if (config.EXPLORER.CACHE_ENABLED && config.VALKEY.ENABLED) {
      logger.debug(`Migrating ${Object.keys(this.mempoolCache).length} transactions from disk cache to Valkey cache`);
    }
    for (const txid of Object.keys(this.mempoolCache)) {
      if (
        !this.mempoolCache[txid].adjustedSize ||
        this.mempoolCache[txid].sigops == null ||
        this.mempoolCache[txid].feePerSize == null
      ) {
        this.mempoolCache[txid] = transactionUtils.extendMempoolTransaction(this.mempoolCache[txid]);
      }
      if (this.mempoolCache[txid].order == null) {
        this.mempoolCache[txid].order = transactionUtils.txidToOrdering(txid);
      }
      for (const vin of this.mempoolCache[txid].vin) {
        transactionUtils.addInnerScriptsToVin(vin);
      }
      count++;
      if (config.EXPLORER.CACHE_ENABLED && config.VALKEY.ENABLED) {
        await valkeyCache.$addTransaction(this.mempoolCache[txid]);
      }
      this.mempoolCache[txid].flags = Common.getTransactionFlags(this.mempoolCache[txid]);
    }
    if (config.EXPLORER.CACHE_ENABLED && config.VALKEY.ENABLED) {
      await valkeyCache.$flushTransactions();
      logger.debug(
        `Finished migrating cache transactions in ${((Date.now() - valkeyTimer) / 1000).toFixed(2)} seconds`
      );
    }
    if (this.mempoolChangedCallback) {
      this.mempoolChangedCallback(this.mempoolCache, [], []);
    }
    if (this.$asyncMempoolChangedCallback) {
      await this.$asyncMempoolChangedCallback(
        this.mempoolCache,
        count,
        [],
        [],
        this.limitGBT ? { txs: {}, added: [], removed: [] } : undefined
      );
    }
    this.addToSpendMap(Object.values(this.mempoolCache));
  }

  // Melroy: Only used with esplora?
  public async $reloadMempool(expectedCount: number): Promise<VerboseMempoolTransactionExtended[]> {
    let count = 0;
    let done = false;
    let last_txid;
    const newTransactions: VerboseMempoolTransactionExtended[] = [];
    loadingIndicators.setProgress('mempool', (count / expectedCount) * 100);
    while (!done) {
      try {
        const result = await bitcoinApi.$getAllMempoolTransactions(last_txid, this.ESPLORA_BATCH_QUERY_BASE_SIZE);
        if (result) {
          for (const tx of result) {
            const extendedTransaction = transactionUtils.extendMempoolTransaction(tx);
            if (!this.mempoolCache[extendedTransaction.txid]) {
              newTransactions.push(extendedTransaction);
              this.mempoolCache[extendedTransaction.txid] = extendedTransaction;
            }
            count++;
          }
          logger.info(`Fetched ${count} of ${expectedCount} mempool transactions from esplora`);
          if (result.length > 0) {
            last_txid = result[result.length - 1].txid;
          } else {
            done = true;
          }
          if (Math.floor((count / expectedCount) * 100) < 100) {
            loadingIndicators.setProgress('mempool', (count / expectedCount) * 100);
          }
        } else {
          done = true;
        }
      } catch (err) {
        logger.err('failed to fetch bulk mempool transactions from esplora');
      }
    }
    logger.info(`Done inserting loaded mempool transactions into local cache`);
    return newTransactions;
  }

  public getMempoolCandidates(): { [txid: string]: boolean } {
    return this.mempoolCandidates;
  }

  public async $updateMemPoolInfo() {
    this.mempoolInfo = await this.$getMempoolInfo();
  }

  public getMempoolInfo(): IBitcoinApi.MempoolInfo {
    return this.mempoolInfo;
  }

  public getTxPerSecond(): number {
    return this.txPerSecond;
  }

  public getBytesPerSecond(): number {
    return this.bytesPerSecond;
  }

  public getFirstSeenForTransactions(txIds: string[]): number[] {
    const txTimes: number[] = [];
    txIds.forEach((txId: string) => {
      const tx = this.mempoolCache[txId];
      if (tx && tx.firstSeen) {
        txTimes.push(tx.firstSeen);
      } else {
        txTimes.push(0);
      }
    });
    return txTimes;
  }

  // Melroy: Only used with esplora?
  // TODO: If so, we need to remote this.
  public async $updateMempool(
    transactions: string[],
    minFeeMempool: string[],
    minFeeTip: number,
    pollRate: number
  ): Promise<void> {
    logger.debug(`Updating mempool...`);

    // warn if this run stalls the main loop for more than 2 minutes
    const timer = this.startTimer();

    const start = new Date().getTime();
    let hasChange = false;
    const currentMempoolSize = Object.keys(this.mempoolCache).length;
    this.updateTimerProgress(timer, 'got raw mempool');
    const diff = transactions.length - currentMempoolSize;
    const newTransactions: VerboseMempoolTransactionExtended[] = [];

    this.mempoolCacheDelta = Math.abs(diff);

    if (!this.inSync) {
      loadingIndicators.setProgress('mempool', (currentMempoolSize / transactions.length) * 100);
    }

    // https://github.com/mempool/mempool/issues/3283
    const logEsplora404 = (missingTxCount, threshold, time) => {
      const log = `In the past ${
        time / 1000
      } seconds, esplora tx API replied ${missingTxCount} times with a 404 error code while updating nodejs backend mempool`;
      if (missingTxCount >= threshold) {
        logger.warn(log);
      } else if (missingTxCount > 0) {
        logger.debug(log);
      }
    };

    let intervalTimer = Date.now();

    const loaded = false;
    if (!loaded) {
      const remainingTxids = transactions.filter((txid) => !this.mempoolCache[txid]);
      const sliceLength = this.ESPLORA_BATCH_QUERY_BASE_SIZE;
      for (let i = 0; i < Math.ceil(remainingTxids.length / sliceLength); i++) {
        const slice = remainingTxids.slice(i * sliceLength, (i + 1) * sliceLength);
        const txs = await transactionUtils.$getMempoolTransactionsExtended(slice, false, false, false);
        logger.debug(`fetched ${txs.length} transactions`);
        this.updateTimerProgress(timer, 'fetched new transactions');

        for (const transaction of txs) {
          this.mempoolCache[transaction.txid] = transaction;
          if (this.inSync) {
            this.txPerSecondArray.push(new Date().getTime());
            this.bytesPerSecondArray.push({
              unixTime: new Date().getTime(),
              size: transaction.size,
            });
          }
          hasChange = true;
          newTransactions.push(transaction);

          if (config.VALKEY.ENABLED) {
            await valkeyCache.$addTransaction(transaction);
          }
        }

        if (txs.length < slice.length) {
          const missing = slice.length - txs.length;
          logger.debug(`Error finding ${missing} transactions in the mempool: `);
        }

        if (Date.now() - intervalTimer > Math.max(pollRate * 2, 5_000)) {
          if (this.inSync) {
            // Break and restart mempool loop if we spend too much time processing
            // new transactions that may lead to falling behind on block height
            logger.debug('Breaking mempool loop because the 5s time limit exceeded.');
            break;
          } else {
            const progress = ((currentMempoolSize + newTransactions.length) / transactions.length) * 100;
            logger.debug(
              `Mempool is synchronizing. Processed ${newTransactions.length}/${diff} txs (${Math.round(progress)}%)`
            );
            if (Math.floor(progress) < 100) {
              loadingIndicators.setProgress('mempool', progress);
            }
            intervalTimer = Date.now();
          }
        }
      }
    }

    // Reset esplora 404 counter and log a warning if needed
    const elapsedTime = new Date().getTime() - this.timer;
    if (elapsedTime > this.SAMPLE_TIME) {
      logEsplora404(this.missingTxCount, this.ESPLORA_MISSING_TX_WARNING_THRESHOLD, elapsedTime);
      this.timer = new Date().getTime();
      this.missingTxCount = 0;
    }

    // Prevent mempool from clear on bitcoind restart by delaying the deletion
    if (this.mempoolProtection === 0 && currentMempoolSize > 20000 && transactions.length / currentMempoolSize <= 0.8) {
      this.mempoolProtection = 1;
      this.inSync = false;
      logger.warn(
        `Mempool clear protection triggered because transactions.length: ${transactions.length} and currentMempoolSize: ${currentMempoolSize}.`
      );
      setTimeout(
        () => {
          this.mempoolProtection = 2;
          logger.warn('Mempool clear protection ended, normal operation resumed.');
        },
        1000 * 60 * config.EXPLORER.CLEAR_PROTECTION_MINUTES
      );
    }

    const deletedTransactions: VerboseMempoolTransactionExtended[] = [];

    if (this.mempoolProtection !== 1) {
      this.mempoolProtection = 0;
      // Index object for faster search
      const transactionsObject = {};
      transactions.forEach((txId) => (transactionsObject[txId] = true));

      // Delete evicted transactions from mempool
      for (const tx in this.mempoolCache) {
        if (!transactionsObject[tx]) {
          deletedTransactions.push(this.mempoolCache[tx]);
        }
      }
      for (const tx of deletedTransactions) {
        delete this.mempoolCache[tx.txid];
      }
    }

    const candidates = await this.getNextCandidates(minFeeMempool, minFeeTip, deletedTransactions);

    const newMempoolSize = currentMempoolSize + newTransactions.length - deletedTransactions.length;
    const newTransactionsStripped = newTransactions.map((tx) => Common.stripTransaction(tx));
    this.latestTransactions = newTransactionsStripped.concat(this.latestTransactions).slice(0, 6);

    this.mempoolCacheDelta = Math.abs(transactions.length - newMempoolSize);

    const candidatesChanged = candidates?.added?.length || candidates?.removed?.length;

    this.recentlyDeleted.unshift(deletedTransactions);
    this.recentlyDeleted.length = Math.min(this.recentlyDeleted.length, 10); // truncate to the last 10 mempool updates

    if (this.mempoolChangedCallback && (hasChange || newTransactions.length || deletedTransactions.length)) {
      this.mempoolChangedCallback(this.mempoolCache, newTransactions, this.recentlyDeleted);
    }
    if (
      this.$asyncMempoolChangedCallback &&
      (hasChange || newTransactions.length || deletedTransactions.length || candidatesChanged)
    ) {
      this.updateTimerProgress(timer, 'running async mempool callback');
      await this.$asyncMempoolChangedCallback(
        this.mempoolCache,
        newMempoolSize,
        newTransactions,
        this.recentlyDeleted,
        candidates
      );
      this.updateTimerProgress(timer, 'completed async mempool callback');
    }

    if (!this.inSync && transactions.length === newMempoolSize) {
      this.inSync = true;
      logger.notice('The mempool is now in sync!');
      loadingIndicators.setProgress('mempool', 100);
    }

    // Update Valkey cache
    if (config.VALKEY.ENABLED) {
      await valkeyCache.$flushTransactions();
      await valkeyCache.$removeTransactions(deletedTransactions.map((tx) => tx.txid));
    }

    const end = new Date().getTime();
    const time = end - start;
    logger.debug(
      `Mempool updated in ${time / 1000} seconds. New size: ${Object.keys(this.mempoolCache).length} (${
        diff > 0 ? '+' + diff : diff
      })`
    );

    this.clearTimer(timer);
  }

  public getNextCandidates(
    minFeeTransactions: string[],
    blockHeight: number,
    deletedTransactions: VerboseMempoolTransactionExtended[]
  ): GbtCandidates | undefined {
    if (this.limitGBT) {
      const deletedTxsMap = {};
      for (const tx of deletedTransactions) {
        deletedTxsMap[tx.txid] = tx;
      }
      const newCandidateTxMap = {};
      for (const txid of minFeeTransactions) {
        if (this.mempoolCache[txid]) {
          newCandidateTxMap[txid] = true;
        }
      }
      const removed: VerboseMempoolTransactionExtended[] = [];
      const added: VerboseMempoolTransactionExtended[] = [];
      // don't prematurely remove txs included in a new block
      if (blockHeight > blocks.getCurrentBlockHeight()) {
        for (const txid of Object.keys(this.mempoolCandidates)) {
          newCandidateTxMap[txid] = true;
        }
      } else {
        for (const txid of Object.keys(this.mempoolCandidates)) {
          if (!newCandidateTxMap[txid]) {
            if (this.mempoolCache[txid]) {
              removed.push(this.mempoolCache[txid]);
            } else if (deletedTxsMap[txid]) {
              removed.push(deletedTxsMap[txid]);
            }
          }
        }
      }

      for (const txid of Object.keys(newCandidateTxMap)) {
        if (!this.mempoolCandidates[txid]) {
          added.push(this.mempoolCache[txid]);
        }
      }

      this.mempoolCandidates = newCandidateTxMap;
      return {
        txs: this.mempoolCandidates,
        added,
        removed,
      };
    }
  }

  private startTimer() {
    const state: any = {
      start: Date.now(),
      progress: 'begin $updateMempool',
      timer: null,
    };
    state.timer = setTimeout(() => {
      logger.err(`$updateMempool stalled at "${state.progress}"`);
    }, this.mainLoopTimeout);
    return state;
  }

  private updateTimerProgress(state, msg) {
    state.progress = msg;
  }

  private clearTimer(state) {
    if (state.timer) {
      clearTimeout(state.timer);
    }
  }

  public addToSpendMap(transactions: VerboseMempoolTransactionExtended[]): void {
    for (const tx of transactions) {
      for (const vin of tx.vin) {
        this.spendMap.set(`${vin.txid}:${vin.vout}`, tx);
      }
    }
  }

  public removeFromSpendMap(transactions: VerboseTransactionExtended[]): void {
    for (const tx of transactions) {
      for (const vin of tx.vin) {
        const key = `${vin.txid}:${vin.vout}`;
        if (this.spendMap.get(key)?.txid === tx.txid) {
          this.spendMap.delete(key);
        }
      }
    }
  }

  private updateTxPerSecond() {
    const nowMinusTimeSpan = new Date().getTime() - 1000 * config.STATISTICS.TX_PER_SECOND_SAMPLE_PERIOD;
    this.txPerSecondArray = this.txPerSecondArray.filter((unixTime) => unixTime > nowMinusTimeSpan);
    this.txPerSecond = this.txPerSecondArray.length / config.STATISTICS.TX_PER_SECOND_SAMPLE_PERIOD || 0;

    this.bytesPerSecondArray = this.bytesPerSecondArray.filter((data) => data.unixTime > nowMinusTimeSpan);
    if (this.bytesPerSecondArray.length) {
      this.bytesPerSecond = Math.round(
        this.bytesPerSecondArray.map((data) => data.size).reduce((a, b) => a + b) /
          config.STATISTICS.TX_PER_SECOND_SAMPLE_PERIOD
      );
    }
  }

  private $getMempoolInfo() {
    if (config.EXPLORER.USE_SECOND_NODE_FOR_MINFEE) {
      return Promise.all([bitcoinClient.getMempoolInfo(), bitcoinSecondClient.getMempoolInfo()]).then(
        ([mempoolInfo, secondMempoolInfo]) => {
          mempoolInfo.maxmempool = secondMempoolInfo.maxmempool;
          mempoolInfo.mempoolminfee = secondMempoolInfo.mempoolminfee;
          mempoolInfo.minrelaytxfee = secondMempoolInfo.minrelaytxfee;
          return mempoolInfo;
        }
      );
    }
    return bitcoinClient.getMempoolInfo();
  }
}

export default new Mempool();
