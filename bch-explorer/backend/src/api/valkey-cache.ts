import { createClient } from 'redis';
import memPool from './mempool';
import blocks from './blocks';
import logger from '../logger';
import config from '../config';
import { BlockExtended, BlockSummary, VerboseMempoolTransactionExtended } from '../mempool.interfaces';
import transactionUtils from './transaction-utils';

enum NetworkDB {
  mainnet = 0,
  testnet4,
  chipnet,
  scalenet,
}

class ValkeyCache {
  private client;
  private connected = false;
  private schemaVersion = 1;
  private valkeyConfig: any;

  private pauseFlush = false;
  private cacheQueue: VerboseMempoolTransactionExtended[] = [];
  private removeQueue: string[] = [];
  private txFlushLimit = 10000;
  private ignoreBlocksCache = false;

  constructor() {
    if (config.VALKEY.ENABLED) {
      this.valkeyConfig = {
        socket: {
          path: config.VALKEY.UNIX_SOCKET_PATH,
        },
        database: NetworkDB[config.EXPLORER.NETWORK],
      };
      this.$ensureConnected();
      setInterval(() => {
        this.$ensureConnected();
      }, 10000);
    }
  }

  private async $ensureConnected(): Promise<boolean> {
    if (!this.connected && config.VALKEY.ENABLED) {
      try {
        this.client = createClient(this.valkeyConfig);
        this.client.on('error', async (e) => {
          logger.err(`Error in Valkey client: ${e instanceof Error ? e.message : e}`);
          this.connected = false;
          await this.client.disconnect();
        });
        await this.client.connect().then(async () => {
          try {
            const version = await this.client.get('schema_version');
            this.connected = true;
            if (version !== this.schemaVersion) {
              // schema changed
              // perform migrations or flush DB if necessary
              logger.info(`Valkey schema version changed from ${version} to ${this.schemaVersion}`);
              await this.client.set('schema_version', this.schemaVersion);
            }
            logger.info(`Valkey client connected`);
            return true;
          } catch (e) {
            this.connected = false;
            logger.warn('Failed to connect to Valkey');
            return false;
          }
        });
        await this.$onConnected();
        return true;
      } catch (e) {
        logger.warn('Error connecting to Valkey: ' + (e instanceof Error ? e.message : e));
        return false;
      }
    } else {
      try {
        // test connection
        await this.client.get('schema_version');
        return true;
      } catch (e) {
        logger.warn('Lost connection to Valkey: ' + (e instanceof Error ? e.message : e));
        logger.warn('Attempting to reconnect in 10 seconds');
        this.connected = false;
        return false;
      }
    }
  }

  private async $onConnected(): Promise<void> {
    await this.$flushTransactions();
    await this.$removeTransactions([]);
  }

  async $updateBlocks(blocks: BlockExtended[]): Promise<void> {
    if (!config.VALKEY.ENABLED) {
      return;
    }
    if (!this.connected) {
      logger.warn(`Failed to update blocks in Valkey cache: Valkey is not connected`);
      return;
    }
    try {
      await this.client.set('blocks', JSON.stringify(blocks));
      logger.debug(`Saved latest blocks to Valkey cache`);
    } catch (e) {
      logger.warn(`Failed to update blocks in Valkey cache: ${e instanceof Error ? e.message : e}`);
    }
  }

  async $updateBlockSummaries(summaries: BlockSummary[]): Promise<void> {
    if (!config.VALKEY.ENABLED) {
      return;
    }
    if (!this.connected) {
      logger.warn(`Failed to update block summaries in Valkey cache: Valkey is not connected`);
      return;
    }
    try {
      await this.client.set('block-summaries', JSON.stringify(summaries));
      logger.debug(`Saved latest block summaries to Valkey cache`);
    } catch (e) {
      logger.warn(`Failed to update block summaries in Valkey cache: ${e instanceof Error ? e.message : e}`);
    }
  }

  async $addTransaction(tx: VerboseMempoolTransactionExtended): Promise<void> {
    if (!config.VALKEY.ENABLED) {
      return;
    }
    this.cacheQueue.push(tx);
    if (this.cacheQueue.length >= this.txFlushLimit) {
      if (!this.pauseFlush) {
        await this.$flushTransactions();
      }
    }
  }

  async $flushTransactions(): Promise<void> {
    if (!config.VALKEY.ENABLED) {
      return;
    }
    if (!this.cacheQueue.length) {
      return;
    }
    if (!this.connected) {
      logger.warn(`Failed to add ${this.cacheQueue.length} transactions to Valkey cache: Valkey not connected`);
      return;
    }

    this.pauseFlush = false;

    const toAdd = this.cacheQueue.slice(0, this.txFlushLimit);
    try {
      const msetData = toAdd.map((tx) => {
        const minified: any = structuredClone(tx);
        delete minified.hex;
        for (const vin of minified.vin) {
          delete vin.inner_redeemscript_asm;
          delete vin.scriptsig_asm;
        }
        for (const vout of minified.vout) {
          delete vout.scriptpubkey_asm;
        }
        return [`mempool:tx:${tx.txid}`, JSON.stringify(minified)];
      });
      await this.client.MSET(msetData);
      // successful, remove transactions from cache queue
      this.cacheQueue = this.cacheQueue.slice(toAdd.length);
      logger.debug(`Saved ${toAdd.length} transactions to Valkey cache, ${this.cacheQueue.length} left in queue`);
    } catch (e) {
      logger.warn(`Failed to add ${toAdd.length} transactions to Valkey cache: ${e instanceof Error ? e.message : e}`);
      this.pauseFlush = true;
    }
  }

  async $removeTransactions(transactions: string[]): Promise<void> {
    if (!config.VALKEY.ENABLED) {
      return;
    }
    const toRemove = this.removeQueue.concat(transactions);
    this.removeQueue = [];
    let failed: string[] = [];
    let numRemoved = 0;
    if (this.connected) {
      const sliceLength = config.VALKEY.BATCH_QUERY_BASE_SIZE;
      for (let i = 0; i < Math.ceil(toRemove.length / sliceLength); i++) {
        const slice = toRemove.slice(i * sliceLength, (i + 1) * sliceLength);
        try {
          await this.client.unlink(slice.map((txid) => `mempool:tx:${txid}`));
          numRemoved += sliceLength;
          logger.debug(`Deleted ${slice.length} transactions from the Valkey cache`);
        } catch (e) {
          logger.warn(
            `Failed to remove ${slice.length} transactions from Valkey cache: ${e instanceof Error ? e.message : e}`
          );
          failed = failed.concat(slice);
        }
      }
      // concat instead of replace, in case more txs have been added in the meantime
      this.removeQueue = this.removeQueue.concat(failed);
    } else {
      this.removeQueue = this.removeQueue.concat(toRemove);
    }
  }

  async $getBlocks(): Promise<BlockExtended[]> {
    if (!config.VALKEY.ENABLED) {
      return [];
    }
    if (!this.connected) {
      logger.warn(`Failed to retrieve blocks from Valkey cache: Valkey is not connected`);
      return [];
    }
    try {
      const json = await this.client.get('blocks');
      return JSON.parse(json);
    } catch (e) {
      logger.warn(`Failed to retrieve blocks from Valkey cache: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  async $getBlockSummaries(): Promise<BlockSummary[]> {
    if (!config.VALKEY.ENABLED) {
      return [];
    }
    if (!this.connected) {
      logger.warn(`Failed to retrieve blocks from Valkey cache: Valkey is not connected`);
      return [];
    }
    try {
      const json = await this.client.get('block-summaries');
      return JSON.parse(json);
    } catch (e) {
      logger.warn(`Failed to retrieve blocks from Valkey cache: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  async $getMempool(): Promise<{ [txid: string]: VerboseMempoolTransactionExtended }> {
    if (!config.VALKEY.ENABLED) {
      return {};
    }
    if (!this.connected) {
      logger.warn(`Failed to retrieve mempool from Valkey cache: Valkey is not connected`);
      return {};
    }
    const start = Date.now();
    const mempool = {};
    try {
      const mempoolList = await this.scanKeys<VerboseMempoolTransactionExtended>('mempool:tx:*');
      for (const tx of mempoolList) {
        mempool[tx.key] = tx.value;
      }
      logger.info(`Loaded mempool from Valkey cache in ${Date.now() - start} ms`);
      return mempool || {};
    } catch (e) {
      logger.warn(`Failed to retrieve mempool from Valkey cache: ${e instanceof Error ? e.message : e}`);
    }
    return {};
  }

  async $loadCache(): Promise<void> {
    if (!config.VALKEY.ENABLED) {
      return;
    }
    logger.info('Restoring mempool and blocks data from Valkey cache');

    // Load mempool
    const loadedMempool = await this.$getMempool();
    this.inflateLoadedTxs(loadedMempool);

    // Load & set block data
    if (!this.ignoreBlocksCache) {
      const loadedBlocks = await this.$getBlocks();
      const loadedBlockSummaries = await this.$getBlockSummaries();
      blocks.setBlocks(loadedBlocks || []);
      blocks.setBlockSummaries(loadedBlockSummaries || []);
    }
    // Set other data
    await memPool.$setMempool(loadedMempool);
  }

  private inflateLoadedTxs(mempool: { [txid: string]: VerboseMempoolTransactionExtended }): void {
    for (const tx of Object.values(mempool)) {
      for (const vin of tx.vin) {
        if (vin.scriptsig) {
          vin.scriptsig_asm = transactionUtils.convertScriptSigAsm(vin.scriptsig);
          transactionUtils.addInnerScriptsToVin(vin);
        }
      }
      for (const vout of tx.vout) {
        if (vout.scriptpubkey) {
          vout.scriptpubkey_asm = transactionUtils.convertScriptSigAsm(vout.scriptpubkey);
        }
      }
    }
  }

  private async scanKeys<T>(pattern): Promise<{ key: string; value: T }[]> {
    logger.info(`loading Valkey entries for ${pattern}`);
    let keys: string[] = [];
    const result: { key: string; value: T }[] = [];
    const patternLength = pattern.length - 1;
    let count = 0;
    const processValues = async (keys): Promise<void> => {
      const values = await this.client.MGET(keys);
      for (let i = 0; i < values.length; i++) {
        if (values[i]) {
          result.push({
            key: keys[i].slice(patternLength),
            value: JSON.parse(values[i]),
          });
          count++;
        }
      }
      logger.info(`loaded ${count} entries from Valkey cache`);
    };
    // Run in batches
    for await (const key of this.client.scanIterator({
      MATCH: pattern,
      COUNT: 100,
    })) {
      const batch = Array.isArray(key) ? key : [key];
      keys.push(...batch);
      if (keys.length >= 10000) {
        await processValues(keys);
        keys = [];
      }
    }
    if (keys.length) {
      await processValues(keys);
    }
    return result;
  }

  public setIgnoreBlocksCache(): void {
    this.ignoreBlocksCache = true;
  }

  /**
   * Get arbitrary cache value by key
   */
  public async $getCache(key: string): Promise<string | null> {
    if (!config.VALKEY.ENABLED) {
      return null;
    }
    if (!this.connected) {
      logger.warn(`Failed to retrieve cache from Valkey: Valkey is not connected`);
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (e) {
      logger.warn(`Failed to retrieve cache from Valkey: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /**
   * Set arbitrary cache value by key with optional expiry
   */
  public async $setCache(key: string, value: string, expirySeconds?: number): Promise<void> {
    if (!config.VALKEY.ENABLED) {
      return;
    }
    if (!this.connected) {
      logger.warn(`Failed to set cache in Valkey: Valkey is not connected`);
      return;
    }
    try {
      if (expirySeconds) {
        await this.client.set(key, value, { EX: expirySeconds });
      } else {
        await this.client.set(key, value);
      }
    } catch (e) {
      logger.warn(`Failed to set cache in Valkey: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export default new ValkeyCache();
