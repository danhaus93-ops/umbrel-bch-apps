import config from '../config';
import bitcoinApi, { bitcoinCoreApi } from './bitcoin/bitcoin-api-factory';
import logger from '../logger';
import memPool from './mempool';
import {
  BlockExtended,
  BlockExtension,
  BlockSummary,
  PoolTag,
  VerboseTransactionExtended,
  TransactionMinerInfo,
  VerboseMempoolTransactionExtended,
  TransactionClassified,
  BlockAudit,
  TransactionAudit,
} from '../mempool.interfaces';
import { Common } from './common';
import diskCache from './disk-cache';
import transactionUtils from './transaction-utils';
import bitcoinClient from './bitcoin/bitcoin-client';
import { IBitcoinApi } from './bitcoin/bitcoin-api.interface';
import { IPublicApi } from './bitcoin/public-api.interface';
import poolsRepository from '../repositories/PoolsRepository';
import blocksRepository from '../repositories/BlocksRepository';
import loadingIndicators from './loading-indicators';
import BitcoinApi from './bitcoin/bitcoin-api';
import BlocksRepository from '../repositories/BlocksRepository';
import HashratesRepository from '../repositories/HashratesRepository';
import indexer from '../indexer';
import poolsParser from './pools-parser';
import BlocksSummariesRepository from '../repositories/BlocksSummariesRepository';
import BlocksAuditsRepository from '../repositories/BlocksAuditsRepository';
import mining from './mining/mining';
import DifficultyAdjustmentsRepository from '../repositories/DifficultyAdjustmentsRepository';
import PricesRepository from '../repositories/PricesRepository';
import priceUpdater from '../tasks/price-updater';
import chainTips from './chain-tips';
import websocketHandler from './websocket-handler';
import valkeyCache from './valkey-cache';
import { calcBitsDifference } from './difficulty-adjustment';
import { parseDATUMTemplateCreator } from '../utils/bitcoin-script';
import database from '../database';

class Blocks {
  private blocks: BlockExtended[] = [];
  private blockSummaries: BlockSummary[] = [];
  private currentBlockHeight = 0;
  private currentBits = 0;
  private newBlockCallbacks: ((
    block: BlockExtended,
    txIds: string[],
    transactions: VerboseTransactionExtended[]
  ) => void)[] = [];
  private newAsyncBlockCallbacks: ((
    block: BlockExtended,
    txIds: string[],
    transactions: VerboseMempoolTransactionExtended[]
  ) => Promise<void>)[] = [];
  // private classifyingBlocks = false;

  private mainLoopTimeout = 120000;

  public getBlocks(): BlockExtended[] {
    return this.blocks;
  }

  public setBlocks(blocks: BlockExtended[]) {
    this.blocks = blocks;
  }

  public getBlockSummaries(): BlockSummary[] {
    return this.blockSummaries;
  }

  public setBlockSummaries(blockSummaries: BlockSummary[]) {
    this.blockSummaries = blockSummaries;
  }

  public setNewBlockCallback(
    fn: (block: BlockExtended, txIds: string[], transactions: VerboseTransactionExtended[]) => void
  ) {
    this.newBlockCallbacks.push(fn);
  }

  public setNewAsyncBlockCallback(
    fn: (block: BlockExtended, txIds: string[], transactions: VerboseMempoolTransactionExtended[]) => Promise<void>
  ) {
    this.newAsyncBlockCallbacks.push(fn);
  }

  /**
   * Return the list of transaction for a block
   * @param blockHash
   * @param blockHeight
   * @param blockTime
   * @param onlyCoinbase - Set to true if you only need the coinbase transaction
   * @param txIds - optional ordered list of transaction ids if already known
   * @param quiet - don't print non-essential logs (default false)
   * @param addMempoolData - calculate sigops etc (default false)
   * @param stale - Set to true if the block is stale (default false)
   * @returns Promise<TransactionExtended[]>
   */
  private async $getTransactionsExtended(
    blockHash: string,
    blockHeight: number,
    blockTime: number,
    onlyCoinbase: boolean,
    txIds: string[] | null = null,
    quiet = false,
    addMempoolData = false,
    stale = false
  ): Promise<VerboseTransactionExtended[]> {
    const transactionMap: { [txid: string]: VerboseTransactionExtended } = {};

    if (!txIds) {
      txIds = await bitcoinApi.$getTxIdsForBlock(blockHash, stale);
    }

    const mempool = memPool.getMempool();
    let foundInMempool = 0;
    let totalFound = 0;

    // Copy existing transactions from the mempool
    if (!onlyCoinbase) {
      for (const txid of txIds) {
        if (mempool[txid]) {
          mempool[txid].status = {
            confirmed: true,
            block_height: blockHeight,
            block_hash: blockHash,
            block_time: blockTime,
          };
          transactionMap[txid] = mempool[txid];
          foundInMempool++;
          totalFound++;
        }
      }
    }

    if (onlyCoinbase) {
      try {
        const coinbase = await transactionUtils.$getTransactionExtendedRetry(
          txIds[0],
          false,
          false,
          false,
          addMempoolData
        );
        if (coinbase && coinbase.vin[0].is_coinbase) {
          return [coinbase];
        } else {
          const msg = `Expected a coinbase tx, but the backend API returned something else`;
          logger.err(msg);
          throw new Error(msg);
        }
      } catch (e) {
        const msg = `Cannot fetch coinbase tx ${txIds[0]}. Reason: ` + (e instanceof Error ? e.message : e);
        logger.err(msg);
        // tolerate this error for stale blocks (the cb transaction won't be accessible via normal RPCs)
        if (!stale) {
          throw new Error(msg);
        }
      }
    }

    // Fetch remaining txs in bulk if stale
    if (stale) {
      try {
        const rawTransactions = await bitcoinApi.$getTxsForBlock(blockHash, stale);
        for (const tx of rawTransactions) {
          if (!transactionMap[tx.txid]) {
            transactionMap[tx.txid] = addMempoolData
              ? transactionUtils.extendMempoolTransaction(tx)
              : transactionUtils.extendTransaction(tx);
            totalFound++;
          }
        }
      } catch (e) {
        logger.err(`Cannot fetch bulk txs for block ${blockHash}. Reason: ` + (e instanceof Error ? e.message : e));
      }
    }

    // Fetch remaining txs individually
    for (const txid of txIds.filter((txid) => !transactionMap[txid])) {
      if (!quiet && (totalFound % Math.round(txIds.length / 10) === 0 || totalFound + 1 === txIds.length)) {
        // Avoid log spam
        logger.debug(`Indexing tx ${totalFound + 1} of ${txIds.length} in block #${blockHeight}`);
      }
      try {
        const tx = await transactionUtils.$getTransactionExtendedRetry(txid, false, false, false, addMempoolData);
        transactionMap[txid] = tx;
        totalFound++;
      } catch (e) {
        const msg = `Cannot fetch tx ${txid}. Reason: ` + (e instanceof Error ? e.message : e);
        logger.err(msg);
        throw new Error(msg);
      }
    }

    if (!quiet) {
      logger.debug(
        `${foundInMempool} of ${txIds.length} found in mempool. ${
          totalFound - foundInMempool
        } fetched through backend service.`
      );
    }

    // Require the first transaction to be a coinbase
    const coinbase = transactionMap[txIds[0]];
    if (!coinbase || !coinbase.vin[0].is_coinbase) {
      const msg = `Expected first tx in a block to be a coinbase, but found something else`;
      logger.err(msg);
      throw new Error(msg);
    }

    // Require all transactions to be present
    if (txIds.some((txid) => !transactionMap[txid])) {
      const msg = `Failed to fetch ${txIds.length - totalFound} transactions from block`;
      logger.err(msg);
      throw new Error(msg);
    }

    // Return list of transactions, preserving block order
    return txIds.map((txid) => transactionMap[txid]);
  }

  /**
   * Return a block summary (list of stripped transactions)
   * @param block
   * @returns BlockSummary
   */
  public summarizeBlock(block: IBitcoinApi.VerboseBlock): BlockSummary {
    const stripped = block.tx.map((tx: IBitcoinApi.VerboseTransaction): TransactionClassified => {
      return {
        txid: tx.txid,
        size: tx.size,
        fee: tx.fee ? Math.round(tx.fee * 100000000) : 0,
        value: Math.round(tx.vout.reduce((acc, vout) => acc + (vout.value ? vout.value : 0), 0) * 100000000),
        flags: 0,
      };
    });

    return {
      id: block.hash,
      transactions: stripped,
    };
  }

  public summarizeBlockTransactions(
    hash: string,
    height: number,
    transactions: VerboseTransactionExtended[]
  ): BlockSummary {
    return {
      id: hash,
      transactions: Common.classifyTransactions(transactions, height),
    };
  }

  /**
   * Return a block with additional data (reward, coinbase, fees...)
   * @param block
   * @param transactions
   * @returns BlockExtended
   */
  private async $getBlockExtended(
    block: IPublicApi.Block,
    transactions: VerboseTransactionExtended[]
  ): Promise<BlockExtended> {
    const coinbaseTx = transactionUtils.stripCoinbaseTransaction(transactions[0]);

    const blk: Partial<BlockExtended> = Object.assign({}, block);
    const extras: Partial<BlockExtension> = {};

    extras.reward = transactions[0].vout.reduce((acc, curr) => acc + curr.value, 0);
    extras.coinbaseRaw = coinbaseTx.vin[0].scriptsig;
    extras.orphans = chainTips.getOrphanedBlocksAtHeight(blk.height);

    if (block.height === 0) {
      extras.medianFee = 0;
      extras.feeRange = [0, 0, 0, 0, 0, 0, 0];
      extras.totalFees = 0;
      extras.avgFee = 0;
      extras.avgFeeRate = 0;
      extras.utxoSetChange = 0;
      extras.avgTxSize = 0;
      extras.totalInputs = 0;
      extras.totalOutputs = 1;
      extras.totalOutputAmt = 0;
    } else {
      const stats: IBitcoinApi.BlockStats = await this.$getBlockStats(block, transactions);
      // Important note: In BCH the fee rates are returned in BCH/B, so we need to convert them to sat/B by multiplying by 100000000
      const multiplier = 1e8;

      // Loop over stats.feerate_percentiles and multiply each value
      const feeRatePercentiles = stats.feerate_percentiles.map((fee) => fee * multiplier);
      extras.medianFee = feeRatePercentiles[2]; // 50th percentile is the median fee rate
      extras.feeRange = [stats.minfeerate * multiplier, feeRatePercentiles, stats.maxfeerate * multiplier].flat();
      extras.totalFees = stats.totalfee * multiplier;
      extras.avgFee = stats.avgfee * multiplier;
      extras.avgFeeRate = stats.avgfeerate * multiplier;
      extras.utxoSetChange = stats.utxo_increase;
      extras.avgTxSize = Math.round((stats.total_size / stats.txs) * 100) * 0.01;
      extras.totalInputs = stats.ins;
      extras.totalOutputs = stats.outs;
      extras.totalOutputAmt = stats.total_out; // Maybe we need   Math.round(stats.total_out * multiplier) ?
      // TODO: Extend with more info like ABLA, but also minfee, subsidy, ... for example (and store it in the DB)
      // See also bitcoin-cli getblockstats
    }

    if (Common.blocksSummariesIndexingEnabled()) {
      extras.feePercentiles = await BlocksSummariesRepository.$getFeePercentilesByBlockId(block.id);
      if (extras.feePercentiles !== null) {
        extras.medianFeeAmt = extras.feePercentiles[3];
      }
    }

    extras.size = block.size;
    if (coinbaseTx?.vout.length > 0) {
      extras.coinbaseAddress = coinbaseTx.vout[0].scriptpubkey_address ?? null;
      extras.coinbaseAddresses = [
        ...new Set<string>(coinbaseTx.vout.map((v) => v.scriptpubkey_address).filter((a) => a) as string[]),
      ];
      extras.coinbaseSignature = coinbaseTx.vout[0].scriptpubkey_asm ?? null;
      extras.coinbaseSignatureAscii = transactionUtils.hex2ascii(coinbaseTx.vin[0].scriptsig) ?? null;
    } else {
      extras.coinbaseAddress = null;
      extras.coinbaseAddresses = null;
      extras.coinbaseSignature = null;
      extras.coinbaseSignatureAscii = null;
    }

    const header = await bitcoinClient.getBlockHeader(block.id, false);
    extras.header = header;

    const coinStatsIndex = indexer.isBCHNIndexReady('coinstatsindex');
    if (coinStatsIndex !== null && coinStatsIndex.best_block_height >= block.height) {
      const txoutset = await bitcoinClient.getTxoutSetinfo('none', block.height);
      ((extras.utxoSetSize = txoutset.txouts),
        (extras.totalInputAmt = Math.round(txoutset.block_info.prevout_spent * 100000000)));
    } else {
      extras.utxoSetSize = null;
      extras.totalInputAmt = null;
    }

    if (['mainnet', 'testnet4', 'chipnet', 'scalenet'].includes(config.EXPLORER.NETWORK)) {
      let pool: PoolTag;
      if (coinbaseTx !== undefined) {
        pool = await this.$findBlockMiner(coinbaseTx);
      } else {
        if (config.DATABASE.ENABLED === true) {
          pool = await poolsRepository.$getUnknownPool();
        } else {
          pool = poolsParser.unknownPool;
        }
      }

      if (!pool) {
        // We should never have this situation in practise
        logger.warn(
          `Cannot assign pool to block ${blk.height} and 'unknown' pool does not exist. ` +
            `Check your "pools" table entries`
        );
      } else {
        extras.pool = {
          id: pool.uniqueId,
          name: pool.name,
          slug: pool.slug,
          minerNames: null,
        };

        if (extras.pool.name === 'OCEAN') {
          extras.pool.minerNames = parseDATUMTemplateCreator(extras.coinbaseRaw);
        }
      }

      extras.matchRate = null;
      extras.expectedFees = null;
      extras.expectedSize = null;
      if (config.EXPLORER.AUDIT) {
        const auditScore = await BlocksAuditsRepository.$getBlockAuditScore(block.id);
        if (auditScore != null) {
          extras.matchRate = auditScore.matchRate;
          extras.expectedFees = auditScore.expectedFees;
          extras.expectedSize = auditScore.expectedSize;
        }
      }
    }

    blk.extras = <BlockExtension>extras;
    return <BlockExtended>blk;
  }

  private async $getBlockStats(
    block: IPublicApi.Block,
    transactions: VerboseTransactionExtended[]
  ): Promise<IBitcoinApi.BlockStats> {
    if (!block.stale) {
      return bitcoinClient.getBlockStats(block.id);
    }

    const totalFee = transactions.reduce((acc, tx) => acc + tx.fee, 0);
    const totalSize = transactions.reduce((acc, tx) => acc + tx.size, 0);
    const totalReward = transactions[0].vout.reduce((acc, vout) => acc + vout.value, 0);
    const sortedByFee = transactions.sort((a, b) => a.fee - b.fee);
    const sortedBySize = transactions.sort((a, b) => a.size - b.size);
    const sortedByFeerate = transactions.sort((a, b) => a.fee / a.size - b.fee / b.size);
    const sortedFeerates = sortedByFeerate.map((tx) => tx.fee / tx.size);
    const avgfee = totalFee / transactions.length;
    const avgfeerate = totalFee / block.size;
    const avgtxsize = totalSize / transactions.length;
    const medianfee = sortedByFee[Math.floor(transactions.length / 2)].fee;
    const mediantime = block.timestamp;
    const mediantxsize = sortedBySize[Math.floor(transactions.length / 2)].size;
    const minfee = sortedByFee[0].fee;
    const maxfee = sortedByFee[sortedByFee.length - 1].fee;
    const minfeerate = sortedFeerates[0];
    const maxfeerate = sortedFeerates[sortedFeerates.length - 1];
    const mintxsize = sortedBySize[0].size;
    const maxtxsize = sortedBySize[sortedBySize.length - 1].size;
    const ins = transactions.reduce((acc, tx) => acc + tx.vin.length, 0);
    const outs = transactions.reduce((acc, tx) => acc + tx.vout.length, 0);
    const subsidy = totalReward - totalFee;
    const time = block.timestamp;
    const total_out = transactions.reduce((acc, tx) => acc + tx.vout.reduce((acc, vout) => acc + vout.value, 0), 0);
    const total_size = block.size;
    const totalfee = totalFee;
    const txs = transactions.length;
    const utxo_increase = 0;
    const utxo_size_inc = 0;
    const block_size = block.abla_state?.block_size;
    const block_size_limit = block.abla_state?.block_size_limit;
    const next_block_size_limit = block.abla_state?.next_block_size_limit;

    return {
      avgfee,
      avgfeerate,
      avgtxsize,
      blockhash: block.id,
      feerate_percentiles: [
        minfeerate,
        sortedFeerates[Math.floor(transactions.length / 4)],
        medianfee,
        sortedFeerates[Math.floor((transactions.length * 3) / 4)],
        maxfeerate,
      ],
      height: block.height,
      ins,
      maxfee,
      maxfeerate,
      maxtxsize,
      medianfee,
      mediantime,
      mediantxsize,
      minfee,
      minfeerate,
      mintxsize,
      outs,
      subsidy,
      time,
      total_out,
      total_size,
      totalfee,
      txs,
      utxo_increase,
      utxo_size_inc,
      block_size,
      block_size_limit,
      next_block_size_limit,
    };
  }

  /**
   * Try to find which miner found the block
   * @param txMinerInfo
   * @returns
   */
  private async $findBlockMiner(txMinerInfo: TransactionMinerInfo | undefined): Promise<PoolTag> {
    if (txMinerInfo === undefined || txMinerInfo.vout.length < 1) {
      if (config.DATABASE.ENABLED === true) {
        return await poolsRepository.$getUnknownPool();
      } else {
        return poolsParser.unknownPool;
      }
    }

    const addresses = txMinerInfo.vout
      .map((vout) => vout.scriptpubkey_address)
      .filter((address) => address) as string[];

    let pools: PoolTag[] = [];
    if (config.DATABASE.ENABLED === true) {
      pools = await poolsRepository.$getPools();
    } else {
      pools = poolsParser.miningPools;
    }

    const pool = poolsParser.matchBlockMiner(txMinerInfo.vin[0].scriptsig, addresses || [], pools);
    if (pool) {
      return pool;
    }

    if (config.DATABASE.ENABLED === true) {
      return await poolsRepository.$getUnknownPool();
    } else {
      return poolsParser.unknownPool;
    }
  }

  /**
   * [INDEXING] Index all blocks summaries for the block txs visualization
   */
  public async $generateBlocksSummariesDatabase(): Promise<void> {
    if (Common.blocksSummariesIndexingEnabled() === false) {
      return;
    }

    try {
      const blockchainInfo = await bitcoinClient.getBlockchainInfo();
      const currentBlockHeight = blockchainInfo.blocks;
      let indexingBlockAmount = Math.min(config.EXPLORER.INDEXING_BLOCKS_AMOUNT, currentBlockHeight);
      if (indexingBlockAmount <= -1) {
        indexingBlockAmount = currentBlockHeight + 1;
      }
      const lastBlockToIndex = Math.max(0, currentBlockHeight - indexingBlockAmount + 1);

      // Get all indexed block hash
      const indexedBlocks = (await blocksRepository.$getIndexedBlocks()).filter(
        (block) => block.height >= lastBlockToIndex
      );
      const indexedBlockSummariesHashesArray = await BlocksSummariesRepository.$getIndexedSummariesId();

      const indexedBlockSummariesHashes = {}; // Use a map for faster seek during the indexing loop
      for (const hash of indexedBlockSummariesHashesArray) {
        indexedBlockSummariesHashes[hash] = true;
      }

      // Logging
      let newlyIndexed = 0;
      let totalIndexed = indexedBlockSummariesHashesArray.length;
      let indexedThisRun = 0;
      let timer = Date.now() / 1000;
      const startedAt = Date.now() / 1000;

      for (const block of indexedBlocks) {
        if (indexedBlockSummariesHashes[block.hash] === true) {
          continue;
        }

        // Logging
        const elapsedSeconds = Date.now() / 1000 - timer;
        if (elapsedSeconds > 5) {
          const runningFor = Date.now() / 1000 - startedAt;
          const blockPerSeconds = indexedThisRun / elapsedSeconds;
          const progress = Math.round((totalIndexed / indexedBlocks.length) * 10000) / 100;
          logger.debug(
            `Indexing block summary for #${block.height} | ~${blockPerSeconds.toFixed(
              2
            )} blocks/sec | total: ${totalIndexed}/${
              indexedBlocks.length
            } (${progress}%) | elapsed: ${runningFor.toFixed(2)} seconds`,
            logger.tags.mining
          );
          timer = Date.now() / 1000;
          indexedThisRun = 0;
        }

        await this.$indexBlockSummary(block.hash, block.height, block.stale);

        // Logging
        indexedThisRun++;
        totalIndexed++;
        newlyIndexed++;
      }
      if (newlyIndexed > 0) {
        logger.notice(`Blocks summaries indexing completed: indexed ${newlyIndexed} blocks`, logger.tags.mining);
      } else {
        logger.debug(`Blocks summaries indexing completed: indexed ${newlyIndexed} blocks`, logger.tags.mining);
      }
    } catch (e) {
      logger.err(
        `Blocks summaries indexing failed. Trying again in 10 seconds. Reason: ${e instanceof Error ? e.message : e}`,
        logger.tags.mining
      );
      throw e;
    }
  }

  public async $indexBlockSummary(hash: string, height: number, stale?: boolean): Promise<void> {
    await this.$getStrippedBlockTransactions(hash, true, true); // This will index the block summary
  }

  /**
   * [INDEXING] Index expected fees & size for all audited blocks
   */
  public async $generateAuditStats(): Promise<void> {
    const blockIds = await BlocksAuditsRepository.$getBlocksWithoutSummaries();
    if (!blockIds?.length) {
      return;
    }
    let timer = Date.now();
    let indexedThisRun = 0;
    let indexedTotal = 0;
    logger.debug(`Indexing ${blockIds.length} block audit details`);
    for (const hash of blockIds) {
      const summary = await BlocksSummariesRepository.$getTemplate(hash);
      let totalFees = 0;
      let totalSize = 0;
      for (const tx of summary?.transactions || []) {
        totalFees += tx.fee;
        totalSize += tx.size;
      }
      await BlocksAuditsRepository.$setSummary(hash, totalFees, totalSize);
      const cachedBlock = this.blocks.find((block) => block.id === hash);
      if (cachedBlock) {
        cachedBlock.extras.expectedFees = totalFees;
        cachedBlock.extras.expectedSize = totalSize;
      }

      indexedThisRun++;
      indexedTotal++;
      const elapsedSeconds = (Date.now() - timer) / 1000;
      if (elapsedSeconds > 5) {
        const blockPerSeconds = indexedThisRun / elapsedSeconds;
        logger.debug(
          `Indexed ${indexedTotal} / ${blockIds.length} block audit details (${blockPerSeconds.toFixed(1)}/s)`
        );
        timer = Date.now();
        indexedThisRun = 0;
      }
    }
    logger.debug(`Indexing block audit details completed`);
  }

  /**
   * [INDEXING] Index transaction classification flags for Goggles
   */
  public async $classifyBlocks(): Promise<void> {
    return;

    // All code below is currently not used, since they say it requires esplora backend.
    // It also seems to save this as a 'template', which is the blocks_templates DB table.
    // Where the tranactions become some kind of json string and put in the template column.

    // Old code starts here:
    // if (this.classifyingBlocks) {
    //   return;
    // }
    // this.classifyingBlocks = true;

    // // classification requires an esplora backend
    // if (!Common.gogglesIndexingEnabled() || config.MEMPOOL.BACKEND !== 'esplora') {
    //   return;
    // }

    // const currentBlockHeight = this.getCurrentBlockHeight();

    // const targetSummaryVersion: number = 1;
    // const targetTemplateVersion: number = 1;

    // const unclassifiedBlocksList = await BlocksSummariesRepository.$getSummariesBelowVersion(targetSummaryVersion);
    // const unclassifiedTemplatesList = await BlocksSummariesRepository.$getTemplatesBelowVersion(targetTemplateVersion);

    // // nothing to do
    // if (!unclassifiedBlocksList?.length && !unclassifiedTemplatesList?.length) {
    //   return;
    // }

    // let timer = Date.now();
    // let indexedThisRun = 0;
    // let indexedTotal = 0;

    // const minHeight = Math.min(
    //   unclassifiedBlocksList[unclassifiedBlocksList.length - 1]?.height ?? Infinity,
    //   unclassifiedTemplatesList[unclassifiedTemplatesList.length - 1]?.height ?? Infinity,
    // );
    // const numToIndex = Math.max(
    //   unclassifiedBlocksList.length,
    //   unclassifiedTemplatesList.length,
    // );

    // const unclassifiedBlocks = {};
    // const unclassifiedTemplates = {};
    // for (const block of unclassifiedBlocksList) {
    //   unclassifiedBlocks[block.height] = block.id;
    // }
    // for (const template of unclassifiedTemplatesList) {
    //   unclassifiedTemplates[template.height] = template.id;
    // }

    // logger.debug(`Classifying blocks and templates from #${currentBlockHeight} to #${minHeight}`, logger.tags.goggles);

    // for (let height = currentBlockHeight; height >= 0; height--) {
    //   try {
    //     let txs: MempoolTransactionExtended[] | null = null;
    //     if (unclassifiedBlocks[height]) {
    //       const blockHash = unclassifiedBlocks[height];
    //       // fetch transactions
    //       txs = (await bitcoinApi.$getTxsForBlock(blockHash, true)).map(tx => transactionUtils.extendMempoolTransaction(tx)) || [];
    //       // add CPFP
    //       const cpfpSummary = calculateGoodBlockCpfp(height, txs, []);
    //       // classify
    //       const { transactions: classifiedTxs } = this.summarizeBlockTransactions(blockHash, height, cpfpSummary.transactions);
    //       await BlocksSummariesRepository.$saveTransactions(height, blockHash, classifiedTxs, 2);
    //       if (unclassifiedBlocks[height].version < 2 && targetSummaryVersion === 2) {
    //         const cpfpClusters = await CpfpRepository.$getClustersAt(height);
    //         if (!cpfpRepository.compareClusters(cpfpClusters, cpfpSummary.clusters)) {
    //           // CPFP clusters changed - update the compact_cpfp tables
    //           await CpfpRepository.$deleteClustersAt(height);
    //           await this.$saveCpfp(blockHash, height, cpfpSummary);
    //         }
    //       }
    //       await Common.sleep$(250);
    //     }
    //     if (unclassifiedTemplates[height]) {
    //       // classify template
    //       const blockHash = unclassifiedTemplates[height];
    //       const template = await BlocksSummariesRepository.$getTemplate(blockHash);
    //       const alreadyClassified = template?.transactions?.reduce((classified, tx) => (classified || tx.flags > 0), false);
    //       let classifiedTemplate = template?.transactions || [];
    //       if (!alreadyClassified) {
    //         const templateTxs: (TransactionExtended | TransactionClassified)[] = [];
    //         const blockTxMap: { [txid: string]: TransactionExtended } = {};
    //         for (const tx of (txs || [])) {
    //           blockTxMap[tx.txid] = tx;
    //         }
    //         for (const templateTx of (template?.transactions || [])) {
    //           let tx: TransactionExtended | null = blockTxMap[templateTx.txid];
    //           if (!tx) {
    //             try {
    //               tx = await transactionUtils.$getTransactionExtended(templateTx.txid, false, true, false);
    //             } catch (e) {
    //               // transaction probably not found
    //             }
    //           }
    //           templateTxs.push(tx || templateTx);
    //         }
    //         const cpfpSummary = calculateGoodBlockCpfp(height, templateTxs?.filter(tx => tx['effectiveFeePerVsize'] != null) as MempoolTransactionExtended[], []);
    //         // classify
    //         const { transactions: classifiedTxs } = this.summarizeBlockTransactions(blockHash, height, cpfpSummary.transactions);
    //         const classifiedTxMap: { [txid: string]: TransactionClassified } = {};
    //         for (const tx of classifiedTxs) {
    //           classifiedTxMap[tx.txid] = tx;
    //         }
    //         classifiedTemplate = classifiedTemplate.map(tx => {
    //           if (classifiedTxMap[tx.txid]) {
    //             tx.flags = classifiedTxMap[tx.txid].flags || 0;
    //           }
    //           return tx;
    //         });
    //       }
    //       await BlocksSummariesRepository.$saveTemplate({ height, template: { id: blockHash, transactions: classifiedTemplate }, version: 1 });
    //       await Common.sleep$(250);
    //     }
    //   } catch (e) {
    //     logger.warn(`Failed to classify template or block summary at ${height}`, logger.tags.goggles);
    //   }

    //   // timing & logging
    //   if (unclassifiedBlocks[height] || unclassifiedTemplates[height]) {
    //     indexedThisRun++;
    //     indexedTotal++;
    //   }
    //   const elapsedSeconds = (Date.now() - timer) / 1000;
    //   if (elapsedSeconds > 5) {
    //     const perSecond = indexedThisRun / elapsedSeconds;
    //     logger.debug(`Classified #${height}: ${indexedTotal} / ${numToIndex} blocks (${perSecond.toFixed(1)}/s)`);
    //     timer = Date.now();
    //     indexedThisRun = 0;
    //   }
    // }

    // this.classifyingBlocks = false;
  }

  /**
   * [INDEXING] Index missing coinbase addresses for all blocks
   */
  public async $indexCoinbaseAddresses(): Promise<void> {
    try {
      // Get all indexed block hash
      const unindexedBlocks = await blocksRepository.$getBlocksWithoutCoinbaseAddresses();

      if (!unindexedBlocks?.length) {
        return;
      }

      logger.info(`Indexing missing coinbase addresses for ${unindexedBlocks.length} blocks`);

      // Logging
      let count = 0;
      let countThisRun = 0;
      let timer = Date.now() / 1000;
      const startedAt = Date.now() / 1000;
      for (const { height, hash } of unindexedBlocks) {
        // Logging
        const elapsedSeconds = Date.now() / 1000 - timer;
        if (elapsedSeconds > 5) {
          const runningFor = Date.now() / 1000 - startedAt;
          const blockPerSeconds = countThisRun / elapsedSeconds;
          const progress = Math.round((count / unindexedBlocks.length) * 10000) / 100;
          logger.debug(
            `Indexing coinbase addresses for #${height} | ~${blockPerSeconds.toFixed(2)} blocks/sec | total: ${count}/${
              unindexedBlocks.length
            } (${progress}%) | elapsed: ${runningFor.toFixed(2)} seconds`
          );
          timer = Date.now() / 1000;
          countThisRun = 0;
        }

        const coinbaseTx = await bitcoinApi.$getCoinbaseTx(hash);
        const addresses = new Set<string>(
          coinbaseTx.vout.map((v) => v.scriptpubkey_address).filter((a) => a) as string[]
        );
        await blocksRepository.$saveCoinbaseAddresses(hash, [...addresses]);

        // Logging
        count++;
        countThisRun++;
      }
      logger.notice(`coinbase addresses indexing completed: indexed ${count} blocks`);
    } catch (e) {
      logger.err(
        `coinbase addresses indexing failed. Trying again in 10 seconds. Reason: ${e instanceof Error ? e.message : e}`
      );
      throw e;
    }
  }

  /**
   * [INDEXING] Index all blocks metadata for the mining dashboard
   */
  public async $generateBlockDatabase(): Promise<boolean> {
    try {
      const blockchainInfo = await bitcoinClient.getBlockchainInfo();
      let currentBlockHeight = blockchainInfo.blocks;

      let indexingBlockAmount = Math.min(config.EXPLORER.INDEXING_BLOCKS_AMOUNT, blockchainInfo.blocks);
      if (indexingBlockAmount <= -1) {
        indexingBlockAmount = currentBlockHeight + 1;
      }

      const lastBlockToIndex = Math.max(0, currentBlockHeight - indexingBlockAmount + 1);

      logger.debug(`Indexing blocks from #${currentBlockHeight} to #${lastBlockToIndex}`, logger.tags.mining);
      loadingIndicators.setProgress('block-indexing', 0);

      const chunkSize = 10000;
      let totalIndexed = await blocksRepository.$blockCountBetweenHeight(currentBlockHeight, lastBlockToIndex);
      let indexedThisRun = 0;
      let newlyIndexed = 0;
      const startedAt = Date.now() / 1000;
      let timer = Date.now() / 1000;

      while (currentBlockHeight >= lastBlockToIndex) {
        const endBlock = Math.max(0, lastBlockToIndex, currentBlockHeight - chunkSize + 1);

        const missingBlockHeights: number[] = await blocksRepository.$getMissingBlocksBetweenHeights(
          currentBlockHeight,
          endBlock
        );
        if (missingBlockHeights.length <= 0) {
          currentBlockHeight -= chunkSize;
          continue;
        }

        logger.info(
          `Indexing ${missingBlockHeights.length} blocks from #${currentBlockHeight} to #${endBlock}`,
          logger.tags.mining
        );

        for (const blockHeight of missingBlockHeights) {
          if (blockHeight < lastBlockToIndex) {
            break;
          }
          ++indexedThisRun;
          ++totalIndexed;
          const elapsedSeconds = Date.now() / 1000 - timer;
          if (elapsedSeconds > 5 || blockHeight === lastBlockToIndex) {
            const runningFor = Date.now() / 1000 - startedAt;
            const blockPerSeconds = indexedThisRun / elapsedSeconds;
            const progress = Math.round((totalIndexed / indexingBlockAmount) * 10000) / 100;
            logger.debug(
              `Indexing block #${blockHeight} | ~${blockPerSeconds.toFixed(
                2
              )} blocks/sec | total: ${totalIndexed}/${indexingBlockAmount} (${progress.toFixed(
                2
              )}%) | elapsed: ${runningFor.toFixed(2)} seconds`,
              logger.tags.mining
            );
            timer = Date.now() / 1000;
            indexedThisRun = 0;
            loadingIndicators.setProgress('block-indexing', progress, false);
          }
          const blockHash = await bitcoinApi.$getBlockHash(blockHeight);
          const block: IPublicApi.Block = await bitcoinApi.$getBlock(blockHash);
          const transactions = await this.$getTransactionsExtended(
            blockHash,
            block.height,
            block.timestamp,
            !block.stale,
            null,
            true,
            block.stale
          );
          const blockExtended = await this.$getBlockExtended(block, transactions);

          newlyIndexed++;
          await blocksRepository.$saveBlockInDatabase(blockExtended);
        }

        currentBlockHeight -= chunkSize;
      }
      if (newlyIndexed > 0) {
        logger.notice(`Block indexing completed: indexed ${newlyIndexed} blocks`, logger.tags.mining);
      } else {
        logger.debug(`Block indexing completed: indexed ${newlyIndexed} blocks`, logger.tags.mining);
      }
      loadingIndicators.setProgress('block-indexing', 100);
    } catch (e) {
      logger.err(
        'Block indexing failed. Trying again in 10 seconds. Reason: ' + (e instanceof Error ? e.message : e),
        logger.tags.mining
      );
      loadingIndicators.setProgress('block-indexing', 100);
      throw e;
    }

    return await BlocksRepository.$validateChain();
  }

  public async $updateBlocks(): Promise<number> {
    // warn if this run stalls the main loop for more than 2 minutes
    const timer = this.startTimer();

    diskCache.lock();

    let fastForwarded = false;
    let handledBlocks = 0;
    const blockHeightTip = await bitcoinCoreApi.$getBlockHeightTip();
    this.updateTimerProgress(timer, 'got block height tip');

    if (this.blocks.length === 0) {
      this.currentBlockHeight = Math.max(blockHeightTip - config.EXPLORER.INITIAL_BLOCKS_AMOUNT, -1);
    } else {
      this.currentBlockHeight = this.blocks[this.blocks.length - 1].height;
    }

    if (blockHeightTip - this.currentBlockHeight > config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 2) {
      logger.info(
        `${blockHeightTip - this.currentBlockHeight} blocks since tip. Fast forwarding to the ${
          config.EXPLORER.INITIAL_BLOCKS_AMOUNT
        } recent blocks`
      );
      this.currentBlockHeight = blockHeightTip - config.EXPLORER.INITIAL_BLOCKS_AMOUNT;
      fastForwarded = true;
      logger.info(`Re-indexing skipped blocks and corresponding hashrates data`);
      indexer.reindex(); // Make sure to index the skipped blocks #1619
    }

    // Initialize currentBits for historical difficulty indexing
    if (!this.currentBits) {
      const blockchainInfo = await bitcoinClient.getBlockchainInfo();
      this.updateTimerProgress(timer, 'got blockchain info for initial bits');
      if (blockchainInfo.blocks === blockchainInfo.headers) {
        const heightDiff = blockHeightTip % 2016;
        const blockHash = await bitcoinApi.$getBlockHash(blockHeightTip - heightDiff);
        this.updateTimerProgress(timer, 'got block hash for initial bits');
        const block: IPublicApi.Block = await bitcoinApi.$getBlock(blockHash);
        this.updateTimerProgress(timer, 'got block for initial bits');
        this.currentBits = block.bits;
        logger.debug(`Initial currentBits set for historical indexing.`);
      } else {
        logger.debug(
          `Blockchain headers (${blockchainInfo.headers}) and blocks (${blockchainInfo.blocks}) not in sync. Waiting...`
        );
      }
    }

    while (this.currentBlockHeight < blockHeightTip) {
      if (this.currentBlockHeight === 0) {
        this.currentBlockHeight = blockHeightTip;
      } else {
        this.currentBlockHeight++;
        logger.debug(`New block found (#${this.currentBlockHeight})!`);
      }

      this.updateTimerProgress(timer, `getting block data for ${this.currentBlockHeight}`);
      const blockHash = await bitcoinCoreApi.$getBlockHash(this.currentBlockHeight);
      const verboseBlock = await bitcoinClient.getBlock(blockHash, 2);

      const block = BitcoinApi.convertBlock(verboseBlock);

      const txIds: string[] = verboseBlock.tx.map((tx) => tx.txid);
      const transactions = (await this.$getTransactionsExtended(
        blockHash,
        block.height,
        block.timestamp,
        false,
        txIds,
        false,
        true
      )) as VerboseMempoolTransactionExtended[];

      // fill in missing transaction fee data from verboseBlock
      for (let i = 0; i < transactions.length; i++) {
        if (!transactions[i].fee && transactions[i].txid === verboseBlock.tx[i].txid) {
          transactions[i].fee = verboseBlock.tx[i].fee * 100_000_000 || 0;
        }
      }

      const blockExtended: BlockExtended = await this.$getBlockExtended(block, transactions);
      const blockSummary: BlockSummary = this.summarizeBlockTransactions(block.id, block.height, transactions);
      this.updateTimerProgress(timer, `got block data for ${this.currentBlockHeight}`);

      if (Common.indexingEnabled()) {
        if (!fastForwarded) {
          await this.$handleReorgs(blockExtended, timer);
        }

        await blocksRepository.$saveBlockInDatabase(blockExtended);
        this.updateTimerProgress(timer, `saved ${this.currentBlockHeight} to database`);

        if (!fastForwarded) {
          let lastestPriceId;
          try {
            lastestPriceId = await PricesRepository.$getLatestPriceId();
            this.updateTimerProgress(timer, `got latest price id ${this.currentBlockHeight}`);
          } catch (e) {
            logger.debug('failed to fetch latest price id from db: ' + (e instanceof Error ? e.message : e));
          }
          if (priceUpdater.historyInserted === true && lastestPriceId !== null) {
            await blocksRepository.$saveBlockPrices([
              {
                height: blockExtended.height,
                priceId: lastestPriceId,
              },
            ]);
            this.updateTimerProgress(timer, `saved prices for ${this.currentBlockHeight}`);
          } else {
            logger.debug(
              `Cannot save block price for ${blockExtended.height} because the price updater hasnt completed yet. Trying again in 10 seconds.`,
              logger.tags.mining
            );
            indexer.scheduleSingleTask('blocksPrices', 10000);
          }

          // Save blocks summary for visualization if it's enabled
          if (Common.blocksSummariesIndexingEnabled() === true) {
            await this.$getStrippedBlockTransactions(blockExtended.id, true, false);
            this.updateTimerProgress(timer, `saved block summary for ${this.currentBlockHeight}`);
          }
        }
      }

      // start async callbacks
      this.updateTimerProgress(timer, `starting async callbacks for ${this.currentBlockHeight}`);
      const callbackPromises = this.newAsyncBlockCallbacks.map((cb) => cb(blockExtended, txIds, transactions));

      if (block.height % 2016 === 0) {
        if (Common.indexingEnabled()) {
          const adjustment =
            Math.round(
              // calcBitsDifference returns +- percentage, +100 returns to positive, /100 returns to ratio.
              // Instead of actually doing /100, just reduce the multiplier.
              (calcBitsDifference(this.currentBits, block.bits) + 100) * 10000
            ) / 1000000; // Remove float point noise

          await DifficultyAdjustmentsRepository.$saveAdjustments({
            time: block.timestamp,
            height: block.height,
            difficulty: block.difficulty,
            adjustment,
          });
          this.updateTimerProgress(timer, `saved difficulty adjustment for ${this.currentBlockHeight}`);
        }

        this.currentBits = block.bits;
      }

      // skip updating the orphan block cache if we've fallen behind the chain tip
      if (this.currentBlockHeight >= blockHeightTip - 2) {
        this.updateTimerProgress(timer, `getting orphaned blocks for ${this.currentBlockHeight}`);
        await chainTips.updateOrphanedBlocks();
      }

      // wait for pending async callbacks to finish
      this.updateTimerProgress(timer, `waiting for async callbacks to complete for ${this.currentBlockHeight}`);
      await Promise.all(callbackPromises);
      this.updateTimerProgress(timer, `async callbacks completed for ${this.currentBlockHeight}`);

      this.blocks.push(blockExtended);
      if (this.blocks.length > config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 4) {
        this.blocks = this.blocks.slice(-config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 4);
      }
      this.blockSummaries.push(blockSummary);
      if (this.blockSummaries.length > config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 4) {
        this.blockSummaries = this.blockSummaries.slice(-config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 4);
      }

      if (this.newBlockCallbacks.length) {
        this.newBlockCallbacks.forEach((cb) => cb(blockExtended, txIds, transactions));
      }
      if (
        config.EXPLORER.CACHE_ENABLED &&
        !memPool.hasPriority() &&
        block.height % config.EXPLORER.DISK_CACHE_BLOCK_INTERVAL === 0
      ) {
        diskCache.$saveCacheToDisk();
      }

      // Update Valkey cache
      if (config.VALKEY.ENABLED) {
        await valkeyCache.$updateBlocks(this.blocks);
        await valkeyCache.$updateBlockSummaries(this.blockSummaries);
        await valkeyCache.$removeTransactions(txIds);
      }

      handledBlocks++;
    }

    diskCache.unlock();

    this.clearTimer(timer);

    return handledBlocks;
  }

  private startTimer() {
    const state: any = {
      start: Date.now(),
      progress: 'begin $updateBlocks',
      timer: null,
    };
    state.timer = setTimeout(() => {
      logger.err(`$updateBlocks stalled at "${state.progress}"`);
    }, this.mainLoopTimeout);
    return state;
  }

  private updateTimerProgress(state, msg): void {
    state.progress = msg;
  }

  private clearTimer(state): void {
    if (state.timer) {
      clearTimeout(state.timer);
    }
  }

  public async $indexBlockByHeight(height: number, skipDb = false): Promise<BlockExtended> {
    if (Common.indexingEnabled() && !skipDb) {
      const dbBlock = await blocksRepository.$getBlockByHeight(height);
      if (dbBlock !== null) {
        return dbBlock;
      }
    }
    // not already indexed
    const hash = await bitcoinApi.$getBlockHash(height);
    return this.$indexBlock(hash);
  }

  private async $handleReorgs(blockExtended: BlockExtended, timer: any): Promise<void> {
    let forkTail = blockExtended;
    let currentlyIndexed = await blocksRepository.$getBlockByHeight(forkTail.height - 1);
    this.updateTimerProgress(timer, `got block by height at previous tip ${forkTail.height - 1}`);

    // previous blockhash is not what we expected: there has been a reorg
    if (currentlyIndexed !== null && forkTail.previousblockhash !== currentlyIndexed.id) {
      logger.warn(
        `Chain divergence detected at block ${blockExtended.height}, re-indexing most recent data`,
        logger.tags.mining
      );
      this.updateTimerProgress(timer, `reconnecting diverged chain from ${this.currentBlockHeight}`);
      const newBlocks: BlockExtended[] = [];
      // walk back along the chain until we reach the fork point
      while (currentlyIndexed !== null && forkTail.previousblockhash !== currentlyIndexed.id) {
        const newBlock = await this.$indexBlock(forkTail.previousblockhash);
        await blocksRepository.$setCanonicalBlockAtHeight(newBlock.id, newBlock.height);
        newBlocks.push(newBlock);
        this.updateTimerProgress(timer, `reindexed block at ${newBlock.height} (${newBlock.id})`);
        await this.$getStrippedBlockTransactions(newBlock.id, true, true);
        this.updateTimerProgress(timer, `reindexed block summary`);

        forkTail = newBlock;
        currentlyIndexed = await blocksRepository.$getBlockByHeight(forkTail.height - 1);
        this.updateTimerProgress(timer, `got block by height for ${forkTail.height - 1}`);
      }

      // rebuild the block cache
      let currentBlock = forkTail;
      const cachedBlocksByHash = {};
      for (const cached of this.blocks) {
        cachedBlocksByHash[cached.id] = cached;
      }
      while (currentBlock.height > 0 && newBlocks.length < config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 4) {
        const newBlock =
          cachedBlocksByHash[currentBlock.previousblockhash] ||
          (await blocksRepository.$getBlockByHash(currentBlock.previousblockhash));
        if (newBlock) {
          newBlocks.push(newBlock);
          currentBlock = newBlock;
        } else {
          break;
        }
      }
      this.updateTimerProgress(timer, `rebuilt block cache`);

      // force re-indexing of block-related data
      await HashratesRepository.$deleteHashratesFromTimestamp(forkTail.timestamp - 604800);
      await DifficultyAdjustmentsRepository.$deleteAdjustementsFromHeight(forkTail.height);
      chainTips.clearOrphanCacheAboveHeight(forkTail.height);
      this.updateTimerProgress(timer, `deleted stale block data`);

      this.blocks = newBlocks.reverse();
      if (this.blocks.length > config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 4) {
        this.blocks = this.blocks.slice(-config.EXPLORER.INITIAL_BLOCKS_AMOUNT * 4);
      }
      this.updateTimerProgress(timer, `connected new best chain from ${forkTail.height} to ${this.currentBlockHeight}`);

      await mining.$indexDifficultyAdjustments();
      this.updateTimerProgress(timer, `reindexed difficulty adjustments`);
      logger.info(
        `Re-indexed ${
          this.currentBlockHeight - forkTail.height
        } blocks and summaries. Also re-indexed the last difficulty adjustments. Will re-index latest hashrates in a few seconds.`,
        logger.tags.mining
      );
      indexer.reindex();

      websocketHandler.handleReorg();
    }
  }

  /**
   * Index a block if it's missing from the database. Returns the block after indexing
   */
  public async $indexBlock(hash: string, block?: IPublicApi.Block, skipDb = false): Promise<BlockExtended> {
    if (Common.indexingEnabled() && !skipDb) {
      const dbBlock = await blocksRepository.$getBlockByHash(hash);
      if (dbBlock !== null) {
        return dbBlock;
      }
    }

    if (!block) {
      // dont' bother trying to fetch orphan blocks from esplora
      block = await (chainTips.isOrphaned(hash) ? bitcoinCoreApi.$getBlock(hash) : bitcoinApi.$getBlock(hash));
    }

    const transactions = await this.$getTransactionsExtended(
      hash,
      block.height,
      block.timestamp,
      !block.stale,
      null,
      false,
      false,
      block.stale
    );
    const blockExtended = await this.$getBlockExtended(block, transactions);
    if (block.stale) {
      blockExtended.canonical = await bitcoinApi.$getBlockHash(block.height);
    }

    if (Common.indexingEnabled()) {
      await blocksRepository.$saveBlockInDatabase(blockExtended);
    }

    return blockExtended;
  }

  /**
   * Get one block by its hash
   */
  public async $getBlock(hash: string, skipMemoryCache = false): Promise<BlockExtended | IPublicApi.Block> {
    // Check the memory cache
    if (!skipMemoryCache) {
      const blockByHash = this.getBlocks().find((b) => b.id === hash);
      if (blockByHash) {
        return blockByHash;
      }
    }

    // Not Bitcoin network, return the block as it from the bitcoin backend
    if (['mainnet', 'testnet4', 'chipnet', 'scalenet'].includes(config.EXPLORER.NETWORK) === false) {
      return await bitcoinCoreApi.$getBlock(hash);
    }

    // Bitcoin network, add our custom data on top
    return await this.$indexBlock(hash);
  }

  public async $getStrippedBlockTransactions(
    hash: string,
    skipMemoryCache = false,
    skipDBLookup = false,
    blockHeight?: number
  ): Promise<TransactionClassified[]> {
    if (skipMemoryCache === false) {
      // Check the memory cache
      const cachedSummary = this.getBlockSummaries().find((b) => b.id === hash);
      if (cachedSummary?.transactions?.length) {
        return cachedSummary.transactions;
      }
    }

    // Check if it's indexed in db
    if (skipDBLookup === false && Common.blocksSummariesIndexingEnabled() === true) {
      const indexedSummary = await BlocksSummariesRepository.$getByBlockId(hash);
      if (indexedSummary !== undefined && indexedSummary?.transactions?.length) {
        return indexedSummary.transactions;
      }
    }

    let height = blockHeight;
    let summaryVersion = 0;
    const txs = (await bitcoinApi.$getTxsForBlock(hash, true)).map((tx) => transactionUtils.extendTransaction(tx));
    const summary = this.summarizeBlockTransactions(hash, height || 0, txs);
    summaryVersion = 1;

    if (height == null) {
      // If the block is orphaned, use the height from the chaintips cache
      const orphanedBlock = chainTips.getOrphanedBlock(hash);
      if (orphanedBlock) {
        height = orphanedBlock.height;
      } else {
        const block = await bitcoinApi.$getBlock(hash);
        height = block.height;
      }
    }

    // Index the response if needed
    if (Common.blocksSummariesIndexingEnabled() === true) {
      await BlocksSummariesRepository.$saveTransactions(height, hash, summary.transactions, summaryVersion);
    }

    return summary.transactions;
  }

  public async $getSingleTxFromSummary(hash: string, txid: string): Promise<TransactionClassified | null> {
    const txs = await this.$getStrippedBlockTransactions(hash);
    return txs.find((tx) => tx.txid === txid) || null;
  }

  /**
   * Get 15 blocks
   *
   * Internally this function uses two methods to get the blocks, and
   * the method is automatically selected:
   *  - Using previous block hash links
   *  - Using block height
   *
   * @param fromHeight
   * @param limit
   * @returns
   */
  public async $getBlocks(fromHeight?: number, limit = 15): Promise<BlockExtended[]> {
    let currentHeight = fromHeight !== undefined ? fromHeight : this.currentBlockHeight;
    if (currentHeight > this.currentBlockHeight) {
      limit -= currentHeight - this.currentBlockHeight;
      currentHeight = this.currentBlockHeight;
    }
    const returnBlocks: BlockExtended[] = [];

    if (currentHeight < 0) {
      return returnBlocks;
    }

    for (let i = 0; i < limit && currentHeight >= 0; i++) {
      let block = this.getBlocks().find((b) => b.height === currentHeight);
      if (block) {
        // Using the memory cache (find by height)
        returnBlocks.push(block);
      } else {
        // Using indexing (find by height, index on the fly, save in database)
        block = await this.$indexBlockByHeight(currentHeight);
        returnBlocks.push(block);
      }
      currentHeight--;
    }

    return returnBlocks;
  }

  /**
   * Used for bulk block data query
   *
   * @param fromHeight
   * @param toHeight
   */
  public async $getBlocksBetweenHeight(fromHeight: number, toHeight: number): Promise<any> {
    if (!Common.indexingEnabled()) {
      return [];
    }

    const blocks: any[] = [];

    while (fromHeight <= toHeight) {
      let block: BlockExtended | null = await blocksRepository.$getBlockByHeight(fromHeight);
      if (!block) {
        await this.$indexBlockByHeight(fromHeight);
        block = await blocksRepository.$getBlockByHeight(fromHeight);
        if (!block) {
          continue;
        }
      }

      // Cleanup fields before sending the response
      const cleanBlock: any = {
        height: block.height ?? null,
        hash: block.id ?? null,
        timestamp: block.timestamp ?? null,
        median_timestamp: block.mediantime ?? null,
        previous_block_hash: block.previousblockhash ?? null,
        difficulty: block.difficulty ?? null,
        header: block.extras.header ?? null,
        version: block.version ?? null,
        bits: block.bits ?? null,
        nonce: block.nonce ?? null,
        size: block.size ?? null,
        tx_count: block.tx_count ?? null,
        merkle_root: block.merkle_root ?? null,
        reward: block.extras.reward ?? null,
        total_fee_amt: block.extras.totalFees ?? null,
        avg_fee_amt: block.extras.avgFee ?? null,
        median_fee_amt: block.extras.medianFeeAmt ?? null,
        fee_amt_percentiles: block.extras.feePercentiles ?? null,
        avg_fee_rate: block.extras.avgFeeRate ?? null,
        median_fee_rate: block.extras.medianFee ?? null,
        fee_rate_percentiles: block.extras.feeRange ?? null,
        total_inputs: block.extras.totalInputs ?? null,
        total_input_amt: block.extras.totalInputAmt ?? null,
        total_outputs: block.extras.totalOutputs ?? null,
        total_output_amt: block.extras.totalOutputAmt ?? null,
        avg_tx_size: block.extras.avgTxSize ?? null,
        utxoset_change: block.extras.utxoSetChange ?? null,
        utxoset_size: block.extras.utxoSetSize ?? null,
        coinbase_raw: block.extras.coinbaseRaw ?? null,
        coinbase_address: block.extras.coinbaseAddress ?? null,
        coinbase_addresses: block.extras.coinbaseAddresses ?? null,
        coinbase_signature: block.extras.coinbaseSignature ?? null,
        coinbase_signature_ascii: block.extras.coinbaseSignatureAscii ?? null,
        pool_slug: block.extras.pool.slug ?? null,
        pool_id: block.extras.pool.id ?? null,
        block_size: block.abla_state?.block_size ?? null,
        block_size_limit: block.abla_state?.block_size_limit ?? null,
        next_block_size_limit: block.abla_state?.next_block_size_limit ?? null,
      };

      if (Common.blocksSummariesIndexingEnabled() && cleanBlock.fee_amt_percentiles === null) {
        cleanBlock.fee_amt_percentiles = await BlocksSummariesRepository.$getFeePercentilesByBlockId(cleanBlock.hash);
        if (cleanBlock.fee_amt_percentiles === null) {
          const summaryVersion = 0;
          // Call BCHN RPC
          const block = await bitcoinClient.getBlock(cleanBlock.hash, 2);
          const summary = this.summarizeBlock(block);

          await BlocksSummariesRepository.$saveTransactions(
            cleanBlock.height,
            cleanBlock.hash,
            summary.transactions,
            summaryVersion
          );
          cleanBlock.fee_amt_percentiles = await BlocksSummariesRepository.$getFeePercentilesByBlockId(cleanBlock.hash);
        }
        if (cleanBlock.fee_amt_percentiles !== null) {
          cleanBlock.median_fee_amt = cleanBlock.fee_amt_percentiles[3];
          await blocksRepository.$updateFeeAmounts(
            cleanBlock.hash,
            cleanBlock.fee_amt_percentiles,
            cleanBlock.median_fee_amt
          );
        }
      }

      cleanBlock.fee_amt_percentiles = {
        min: cleanBlock.fee_amt_percentiles[0],
        perc_10: cleanBlock.fee_amt_percentiles[1],
        perc_25: cleanBlock.fee_amt_percentiles[2],
        perc_50: cleanBlock.fee_amt_percentiles[3],
        perc_75: cleanBlock.fee_amt_percentiles[4],
        perc_90: cleanBlock.fee_amt_percentiles[5],
        max: cleanBlock.fee_amt_percentiles[6],
      };
      cleanBlock.fee_rate_percentiles = {
        min: cleanBlock.fee_rate_percentiles[0],
        perc_10: cleanBlock.fee_rate_percentiles[1],
        perc_25: cleanBlock.fee_rate_percentiles[2],
        perc_50: cleanBlock.fee_rate_percentiles[3],
        perc_75: cleanBlock.fee_rate_percentiles[4],
        perc_90: cleanBlock.fee_rate_percentiles[5],
        max: cleanBlock.fee_rate_percentiles[6],
      };

      // Re-org can happen after indexing so we need to always get the
      // latest state from BCHN
      cleanBlock.orphans = chainTips.getOrphanedBlocksAtHeight(cleanBlock.height);

      blocks.push(cleanBlock);
      fromHeight++;
    }

    return blocks;
  }

  public async $getBlockAuditSummary(hash: string): Promise<BlockAudit | null> {
    if (
      ['mainnet', 'testnet4', 'chipnet', 'scalenet'].includes(config.EXPLORER.NETWORK) &&
      Common.auditIndexingEnabled()
    ) {
      return BlocksAuditsRepository.$getBlockAudit(hash);
    } else {
      return null;
    }
  }

  public async $getBlockTxAuditSummary(hash: string, txid: string): Promise<TransactionAudit | null> {
    if (
      ['mainnet', 'testnet4', 'chipnet', 'scalenet'].includes(config.EXPLORER.NETWORK) &&
      Common.auditIndexingEnabled()
    ) {
      return BlocksAuditsRepository.$getBlockTxAudit(hash, txid);
    } else {
      return null;
    }
  }

  public getCurrentBlockHeight(): number {
    return this.currentBlockHeight;
  }

  public async $getBlockDefinitionHashes(): Promise<string[] | null> {
    try {
      const [rows]: any = await database.query(`SELECT DISTINCT(definition_hash) FROM blocks WHERE stale = 0`);
      if (rows && Array.isArray(rows)) {
        return rows.map((r) => r.definition_hash);
      } else {
        logger.debug(`Unable to retrieve list of blocks.definition_hash from db (no result)`);
        return null;
      }
    } catch (e) {
      logger.debug(`Unable to retrieve list of blocks.definition_hash from db (exception: ${e})`);
      return null;
    }
  }

  public async $getBlocksByDefinitionHash(definitionHash: string): Promise<string[] | null> {
    try {
      const [rows]: any = await database.query(`SELECT hash FROM blocks WHERE definition_hash = ? AND stale = 0`, [
        definitionHash,
      ]);
      if (rows && Array.isArray(rows)) {
        return rows.map((r) => r.hash);
      } else {
        logger.debug(`Unable to retrieve list of blocks for definition hash ${definitionHash} from db (no result)`);
        return null;
      }
    } catch (e) {
      logger.debug(`Unable to retrieve list of blocks for definition hash ${definitionHash} from db (exception: ${e})`);
      return null;
    }
  }
}

export default new Blocks();
