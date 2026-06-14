import config from '../../config';
import { ElectrumClient } from '@bitcoincash/electrum-client';
import { ElectrumConfig, PersistencePolicy } from '@bitcoincash/electrum-client/dist/types';
import { AbstractBitcoinApi } from './bitcoin-api-abstract-factory';
import { IPublicApi } from './public-api.interface';
import { IElectrumApi } from './electrum-api.interface';
import BitcoinApi from './bitcoin-api';
import logger from '../../logger';
import crypto from 'crypto-js';
import loadingIndicators from '../loading-indicators';
import memoryCache from '../memory-cache';

class BitcoindElectrsApi extends BitcoinApi implements AbstractBitcoinApi {
  private electrumClient: ElectrumClient;

  constructor(bitcoinClient: any) {
    super(bitcoinClient);

    const electrumConfig: ElectrumConfig = { client: 'BCH-Explorer-v3', version: '1.6.0' };
    const electrumPersistencePolicy: PersistencePolicy = {
      retryPeriod: 1000,
      maxRetry: Number.MAX_SAFE_INTEGER,
      callback: null,
    };

    const electrumCallbacks = {
      onConnect: (client, versionInfo) => {
        logger.info(
          `Connected to Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT} (${JSON.stringify(
            versionInfo
          )})`
        );
      },
      onClose: (client) => {
        logger.info(`Disconnected from Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT}`);
      },
      onError: (err) => {
        logger.err(`Electrum error: ${JSON.stringify(err)}`);
      },
      onLog: (str) => {
        logger.debug(str);
      },
    };

    this.electrumClient = new ElectrumClient(
      config.ELECTRUM.PORT,
      config.ELECTRUM.HOST,
      config.ELECTRUM.TLS_ENABLED ? 'tls' : 'tcp',
      electrumCallbacks
    );

    this.electrumClient
      .initElectrum(electrumConfig, electrumPersistencePolicy)
      .then(() => {})
      .catch((err) => {
        logger.err(`Error connecting to Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT}`);
      });
  }

  async $getAddress(address: string): Promise<IPublicApi.Address> {
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin Cash address');
    }

    try {
      const balance = await this.$getScriptHashBalance(addressInfo.scriptPubKey);
      const history = await this.$getScriptHashHistory(addressInfo.scriptPubKey);

      const unconfirmed = history.filter((h) => h.fee).length;

      return {
        address: addressInfo.address,
        chain_stats: {
          funded_txo_count: 0,
          funded_txo_sum: balance.confirmed ? balance.confirmed : 0,
          spent_txo_count: 0,
          spent_txo_sum: balance.confirmed < 0 ? balance.confirmed : 0,
          tx_count: history.length - unconfirmed,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: balance.unconfirmed > 0 ? balance.unconfirmed : 0,
          spent_txo_count: 0,
          spent_txo_sum: balance.unconfirmed < 0 ? -balance.unconfirmed : 0,
          tx_count: unconfirmed,
        },
        electrum: true,
      };
    } catch (e: any) {
      throw new Error(typeof e === 'string' ? e : (e && e.message) || e);
    }
  }

  async $getAddressTransactions(address: string, lastSeenTxId: string): Promise<IPublicApi.VerboseTransaction[]> {
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin Cash address');
    }

    try {
      loadingIndicators.setProgress('address-' + address, 0);

      const transactions: IPublicApi.VerboseTransaction[] = [];
      const history = await this.$getScriptHashHistory(addressInfo.scriptPubKey);
      history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      if (lastSeenTxId) {
        const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
        if (pos) {
          startingIndex = pos + 1;
        }
      }
      const endIndex = Math.min(startingIndex + 10, history.length);

      for (let i = startingIndex; i < endIndex; i++) {
        const tx = (await this.$getRawTransaction(history[i].tx_hash, false, true)) as IPublicApi.VerboseTransaction;
        transactions.push(tx);
        loadingIndicators.setProgress('address-' + address, ((i + 1) / endIndex) * 100);
      }

      return transactions;
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + address, 100);
      throw new Error(typeof e === 'string' ? e : (e && e.message) || e);
    }
  }

  async $getAddressMempoolTransactions(address: string): Promise<IPublicApi.VerboseTransaction[]> {
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin Cash address');
    }
    const scripthash = this.encodeScriptHash(addressInfo.scriptPubKey);

    try {
      loadingIndicators.setProgress('address-' + address, 0);

      const transactions: IPublicApi.VerboseTransaction[] = [];
      let utxos = memoryCache.get<IElectrumApi.ScriptHashMempool[]>('Scripthash_getMempool', scripthash);
      if (!utxos) {
        utxos = await this.$getScriptHashMempool(scripthash);
        memoryCache.set('Scripthash_getMempool', scripthash, utxos, 2);
      }
      if (!utxos) {
        throw new Error('failed to get scripthash mempool');
      }
      utxos.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      const endIndex = Math.min(startingIndex + 10, utxos.length);

      for (let i = startingIndex; i < endIndex; i++) {
        const tx = (await this.$getRawTransaction(utxos[i].tx_hash, false, true)) as IPublicApi.VerboseTransaction;
        transactions.push(tx);
        loadingIndicators.setProgress('address-' + address, ((i + 1) / endIndex) * 100);
      }

      return transactions;
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + address, 100);
      throw new Error(typeof e === 'string' ? e : (e && e.message) || e);
    }
  }

  async $getScriptHash(scripthash: string): Promise<IPublicApi.ScriptHash> {
    try {
      const balance = await this.electrumClient.blockchainScripthash_getBalance(scripthash);
      let history = memoryCache.get<IElectrumApi.ScriptHashHistory[]>('Scripthash_getHistory', scripthash);
      if (!history) {
        history = await this.electrumClient.blockchainScripthash_getHistory(scripthash);
        memoryCache.set('Scripthash_getHistory', scripthash, history, 2);
      }

      const unconfirmed = history ? history.filter((h) => h.fee).length : 0;

      return {
        scripthash: scripthash,
        chain_stats: {
          funded_txo_count: 0,
          funded_txo_sum: balance.confirmed ? balance.confirmed : 0,
          spent_txo_count: 0,
          spent_txo_sum: balance.confirmed < 0 ? balance.confirmed : 0,
          tx_count: (history?.length || 0) - unconfirmed,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: balance.unconfirmed > 0 ? balance.unconfirmed : 0,
          spent_txo_count: 0,
          spent_txo_sum: balance.unconfirmed < 0 ? -balance.unconfirmed : 0,
          tx_count: unconfirmed,
        },
        electrum: true,
      };
    } catch (e: any) {
      throw new Error(typeof e === 'string' ? e : (e && e.message) || e);
    }
  }

  async $getAddressUtxos(address: string): Promise<IPublicApi.UTXO[]> {
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin Cash address');
    }
    const scripthash = this.encodeScriptHash(addressInfo.scriptPubKey);
    return this.$getScriptHashUtxos(scripthash);
  }

  async $getScriptHashTransactions(
    scripthash: string,
    lastSeenTxId?: string
  ): Promise<IPublicApi.VerboseTransaction[]> {
    try {
      loadingIndicators.setProgress('address-' + scripthash, 0);

      const transactions: IPublicApi.VerboseTransaction[] = [];
      let history = memoryCache.get<IElectrumApi.ScriptHashHistory[]>('Scripthash_getHistory', scripthash);
      if (!history) {
        history = await this.electrumClient.blockchainScripthash_getHistory(scripthash);
        memoryCache.set('Scripthash_getHistory', scripthash, history, 2);
      }
      if (!history) {
        throw new Error('failed to get scripthash history');
      }
      history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      if (lastSeenTxId) {
        const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
        if (pos) {
          startingIndex = pos + 1;
        }
      }
      const endIndex = Math.min(startingIndex + 10, history.length);

      for (let i = startingIndex; i < endIndex; i++) {
        const tx = (await this.$getRawTransaction(history[i].tx_hash, false, true)) as IPublicApi.VerboseTransaction;
        transactions.push(tx);
        loadingIndicators.setProgress('address-' + scripthash, ((i + 1) / endIndex) * 100);
      }

      return transactions;
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + scripthash, 100);
      throw new Error(typeof e === 'string' ? e : (e && e.message) || e);
    }
  }

  async $getScriptHashUtxos(scripthash: string): Promise<IPublicApi.UTXO[]> {
    const utxos = await this.$getScriptHashUnspent(scripthash);
    const result: IPublicApi.UTXO[] = [];
    for (const utxo of utxos) {
      if (utxo.height === 0) {
        //Unconfirmed
        result.push({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          status: {
            confirmed: false,
          },
          value: utxo.value,
        });
      } else {
        //Confirmed
        const blockHash = await this.$getBlockHash(utxo.height);
        const block = await this.$getBlock(blockHash);
        result.push({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          status: {
            confirmed: true,
            block_height: utxo.height,
            block_hash: blockHash,
            block_time: block.timestamp,
          },
          value: utxo.value,
        });
      }
    }
    return result;
  }

  async $getScriptHashMempoolTransactions(scripthash: string): Promise<IPublicApi.VerboseTransaction[]> {
    try {
      loadingIndicators.setProgress('address-' + scripthash, 0);

      const transactions: IPublicApi.VerboseTransaction[] = [];
      let utxos = memoryCache.get<IElectrumApi.ScriptHashMempool[]>('Scripthash_getMempool', scripthash);
      if (!utxos) {
        utxos = await this.$getScriptHashMempool(scripthash);
        memoryCache.set('Scripthash_getMempool', scripthash, utxos, 2);
      }
      if (!utxos) {
        throw new Error('failed to get scripthash mempool');
      }
      utxos.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      const endIndex = Math.min(startingIndex + 10, utxos.length);

      for (let i = startingIndex; i < endIndex; i++) {
        const tx = (await this.$getRawTransaction(utxos[i].tx_hash, false, true)) as IPublicApi.VerboseTransaction;
        transactions.push(tx);
        loadingIndicators.setProgress('address-' + scripthash, ((i + 1) / endIndex) * 100);
      }

      return transactions;
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + scripthash, 100);
      throw new Error(typeof e === 'string' ? e : (e && e.message) || e);
    }
  }

  async $getOutspend(txId: string, vout: number): Promise<IPublicApi.DetailedOutspend> {
    const tx = (await this.$getRawTransaction(txId, false, false)) as IPublicApi.Transaction;
    const blockHeight = tx.status.block_height;
    const txOut = await this.bitcoindClient.getTxOut(txId, vout);
    const isSpent = txOut === null; // True if the output is spent (txout is null)
    const lookBackHeight = 500;

    // Helper function to find the spender transaction from history candidates
    const findSpenderFromHistory = async (
      candidates: IElectrumApi.ScriptHashHistory[]
    ): Promise<{ txId: string; vin: number } | undefined> => {
      // Limit the max lookups starting from the first one (oldest)
      const maxAttempts = Math.min(candidates.length, 3000);
      for (let j = 0; j < maxAttempts; j++) {
        const candidate = candidates[j];
        // Get raw tx
        const spenderTx = await this.electrumClient.blockchainTransaction_get(candidate.tx_hash, true);
        if (spenderTx && spenderTx.vin) {
          // TODO: Check also if the vout matches the input tx "vout" with this possible spender vin.vout number.
          // Currently however we do only submit the txid to the backend (and not yet the vout).

          // Try to find the vin index
          const vinIndex = spenderTx.vin.findIndex((vin) => vin.txid === txId);
          if (vinIndex !== -1) {
            return { txId: candidate.tx_hash, vin: vinIndex };
          }
        }
      }
      return undefined;
    };

    let spenderInfo: { txId: string; vin: number } | undefined;

    // Only look up history if the output is spent (txOut is null)
    if (blockHeight && isSpent) {
      // Retrieve the history from the current block height + 1 (so the next or higher, including mempool)
      const fromHeight = blockHeight - lookBackHeight < 0 ? 0 : blockHeight - lookBackHeight;
      const history = await this.$getScriptHashHistory(tx.vout[vout].scriptpubkey, fromHeight);
      // Filter out possible our own txid
      const filteredHistory = history.filter((h) => h.tx_hash !== txId);
      if (filteredHistory.length > 0) {
        spenderInfo = await findSpenderFromHistory(filteredHistory);
      }
    } else if (!blockHeight && isSpent) {
      // If blockHeight is null and txOut is null, it means the spent tx is in the mempool
      const history = await this.$getScriptHashHistory(tx.vout[vout].scriptpubkey);
      // only get height -1, using history.filer
      const mempoolTx = history.filter((h) => h.height === -1);
      // filter out its own txid
      const filteredMempoolTx = mempoolTx.filter((h) => h.tx_hash !== txId);
      if (filteredMempoolTx.length > 0) {
        spenderInfo = await findSpenderFromHistory(filteredMempoolTx);
      }
    }

    // Return spent boolean, include txid and vin if available
    return {
      spent: isSpent,
      ...(spenderInfo && { txid: spenderInfo.txId, vin: spenderInfo.vin }),
    };
  }

  private $getScriptHashUnspent(scriptHash: string): Promise<IElectrumApi.ScriptHashUtxos[]> {
    return this.electrumClient.blockchainScripthash_listunspent(scriptHash);
  }

  private $getScriptHashMempool(scriptHash: string): Promise<IElectrumApi.ScriptHashMempool[]> {
    return this.electrumClient.blockchainScripthash_getMempool(scriptHash);
  }

  async $getTransactionMerkleProof(txId: string): Promise<IPublicApi.MerkleProof> {
    const tx = (await this.$getRawTransaction(txId)) as IPublicApi.VerboseTransaction;
    if (tx.status.block_height) {
      return this.electrumClient.blockchainTransaction_getMerkle(txId, tx.status.block_height);
    } else {
      throw new Error('Transaction is not confirmed / could not find block height.');
    }
  }

  private $getScriptHashBalance(scriptHash: string): Promise<IElectrumApi.ScriptHashBalance> {
    return this.electrumClient.blockchainScripthash_getBalance(this.encodeScriptHash(scriptHash));
  }

  private $getScriptHashHistory(
    scriptHash: string,
    fromHeight?: number,
    toHeight?: number
  ): Promise<IElectrumApi.ScriptHashHistory[]> {
    // Use dedicated cache key for height-filtered queries
    const cacheKey =
      fromHeight !== undefined || toHeight !== undefined
        ? `Scripthash_getHistory_heights_${fromHeight || '0'}_${toHeight || '-1'}`
        : 'Scripthash_getHistory';

    const fromCache = memoryCache.get<IElectrumApi.ScriptHashHistory[]>(cacheKey, scriptHash);
    if (fromCache) {
      return Promise.resolve(fromCache);
    }

    // If height parameters are provided, use custom request method
    if (fromHeight !== undefined || toHeight !== undefined) {
      const params: any[] = [this.encodeScriptHash(scriptHash)];

      if (fromHeight !== undefined) {
        params.push(fromHeight);
      }

      if (toHeight !== undefined) {
        // Ensure toHeight is at least fromHeight if both are provided
        const adjustedToHeight = fromHeight !== undefined && toHeight < fromHeight ? fromHeight : toHeight;
        params.push(adjustedToHeight);
      }

      // TODO: Extend blockchainScripthash_getHistory method in your new @bitcoincash/electrum-client package
      return this.electrumClient.request('blockchain.scripthash.get_history', params).then((history) => {
        memoryCache.set(cacheKey, scriptHash, history, 2);
        return history;
      });
    }

    // Use standard method for non-height-filtered queries
    return this.electrumClient.blockchainScripthash_getHistory(this.encodeScriptHash(scriptHash)).then((history) => {
      memoryCache.set(cacheKey, scriptHash, history, 2);
      return history;
    });
  }

  private encodeScriptHash(scriptPubKey: string): string {
    const addrScripthash = crypto.enc.Hex.stringify(crypto.SHA256(crypto.enc.Hex.parse(scriptPubKey)));
    return addrScripthash!.match(/.{2}/g)!.reverse().join('');
  }
}

export default BitcoindElectrsApi;
