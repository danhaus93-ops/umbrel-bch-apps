import config from '../config';
import logger from '../logger';
import { VerboseMempoolTransactionExtended, MempoolBlockWithTransactions } from '../mempool.interfaces';

const PROPAGATION_MARGIN = 180; // in seconds, time since a transaction is first seen after which it is assumed to have propagated to all miners

export interface AuditResult {
  unseen: string[];
  censored: string[];
  added: string[];
  fresh: string[];
  sigop: string[];
  matchRate: number;
  similarity: number;
}

class Audit {
  auditBlock(
    height: number,
    transactions: VerboseMempoolTransactionExtended[],
    projectedBlocks: MempoolBlockWithTransactions[],
    mempool: { [txId: string]: VerboseMempoolTransactionExtended }
  ): AuditResult {
    if (!projectedBlocks?.[0]?.transactionIds || !mempool) {
      return {
        unseen: [],
        censored: [],
        added: [],
        fresh: [],
        sigop: [],
        matchRate: 1,
        similarity: 1,
      };
    }

    const matches: string[] = []; // present in both mined block and template
    const added: string[] = []; // present in mined block, not in template
    const unseen: string[] = []; // present in the mined block, not in our mempool
    const fresh: string[] = []; // missing, but firstSeen within PROPAGATION_MARGIN
    const isCensored = {}; // missing, without excuse
    const isDisplaced = {};
    let displacedSize = 0;
    let matchedSize = 0;
    let projectedSize = 0;

    const inBlock = {};
    const inTemplate = {};

    const now = Math.round(Date.now() / 1000);
    for (const tx of transactions) {
      inBlock[tx.txid] = tx;
    }
    // coinbase is always expected
    if (transactions[0]) {
      inTemplate[transactions[0].txid] = true;
    }
    // look for transactions that were expected in the template, but missing from the mined block
    for (const txid of projectedBlocks[0].transactionIds) {
      if (!inBlock[txid]) {
        // conflict with any transaction in the mined block
        if (mempool[txid]?.firstSeen && now - (mempool[txid]?.firstSeen || 0) <= PROPAGATION_MARGIN) {
          // tx is recent, may have reached the miner too late for inclusion
          fresh.push(txid);
        } else if (mempool[txid].feePerSize >= 1) {
          // transactions paying < 1 sat/vbyte are never considered censored
          isCensored[txid] = true;
        }
        displacedSize += mempool[txid]?.size || 0;
      } else {
        matchedSize += mempool[txid]?.size || 0;
      }
      projectedSize += mempool[txid]?.size || 0;
      inTemplate[txid] = true;
    }

    if (transactions[0]) {
      displacedSize += 1000 - transactions[0].size;
      projectedSize += transactions[0].size;
      matchedSize += transactions[0].size;
    }

    // we can expect an honest miner to include 'displaced' transactions in place of recent arrivals and censored txs
    // these displaced transactions should occupy the first N bytes of the next projected block
    let displacedSizeRemaining = displacedSize + 1000;
    let index = 0;
    let lastFeeRate = Infinity;
    let failures = 0;
    let blockIndex = 1;
    while (projectedBlocks[blockIndex] && failures < 500) {
      const txid = projectedBlocks[blockIndex].transactionIds[index];
      const tx = mempool[txid];
      if (tx) {
        const fits = tx.size - displacedSizeRemaining < 1000;
        // 0.005 margin of error for any remaining fee rate rounding issues
        const feeMatches = tx.feePerSize >= lastFeeRate - 0.005;
        if (fits || feeMatches) {
          isDisplaced[txid] = true;
          if (fits) {
            lastFeeRate = Math.min(lastFeeRate, (tx.feePerSize * tx.size) / Math.ceil(tx.size));
          }
          if (tx.firstSeen == null || now - (tx?.firstSeen || 0) > PROPAGATION_MARGIN) {
            displacedSizeRemaining -= tx.size;
          }
          failures = 0;
        } else {
          failures++;
        }
      } else {
        logger.warn('projected transaction missing from mempool cache');
      }
      index++;
      if (index >= projectedBlocks[blockIndex].transactionIds.length) {
        index = 0;
        blockIndex++;
      }
    }

    // mark unexpected transactions in the mined block as 'added'
    let overflowSize = 0;
    let totalSize = 0;
    for (const tx of transactions) {
      if (inTemplate[tx.txid]) {
        matches.push(tx.txid);
      } else {
        if (mempool[tx.txid]) {
          if (isDisplaced[tx.txid]) {
            added.push(tx.txid);
          }
        } else {
          unseen.push(tx.txid);
        }
        overflowSize += tx.size;
      }
      totalSize += tx.size;
    }

    // transactions missing from near the end of our template are probably not being censored
    let overflowSizeRemaining = overflowSize - (config.EXPLORER.MIN_BLOCK_SIZE_UNITS - totalSize);
    let maxOverflowRate = 0;
    let rateThreshold = 0;
    index = projectedBlocks[0].transactionIds.length - 1;
    while (index >= 0) {
      const txid = projectedBlocks[0].transactionIds[index];
      const tx = mempool[txid];
      if (tx) {
        if (overflowSizeRemaining > 0) {
          if (isCensored[txid]) {
            delete isCensored[txid];
          }
          if (tx.feePerSize > maxOverflowRate) {
            maxOverflowRate = tx.feePerSize;
            rateThreshold = Math.ceil(maxOverflowRate * 100) / 100 + 0.005;
          }
        } else if (tx.feePerSize <= rateThreshold) {
          // tolerance of 0.01 sat/vb + rounding
          if (isCensored[txid]) {
            delete isCensored[txid];
          }
        }
        overflowSizeRemaining -= mempool[txid]?.size || 0;
      } else {
        logger.warn('projected transaction missing from mempool cache');
      }
      index--;
    }

    const numCensored = Object.keys(isCensored).length;
    const numMatches = matches.length - 1; // adjust for coinbase tx
    let matchRate = 0;
    if (numMatches <= 0 && numCensored <= 0) {
      matchRate = 1;
    } else if (numMatches > 0) {
      matchRate = numMatches / (numMatches + numCensored);
    }
    const similarity = projectedSize ? matchedSize / projectedSize : 1;

    return {
      unseen,
      censored: Object.keys(isCensored),
      added,
      fresh,
      sigop: [],
      matchRate,
      similarity,
    };
  }
}

export default new Audit();
