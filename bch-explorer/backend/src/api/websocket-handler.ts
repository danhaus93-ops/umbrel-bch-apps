import logger from '../logger';
import * as WebSocket from 'ws';
import {
  BlockExtended,
  VerboseTransactionExtended,
  VerboseMempoolTransactionExtended,
  WebsocketResponse,
  OptimizedStatistic,
  ILoadingIndicators,
  GbtCandidates,
  TxTrackingInfo,
  MempoolDelta,
  MempoolDeltaTxids,
} from '../mempool.interfaces';
import blocks from './blocks';
import memPool from './mempool';
import backendInfo from './backend-info';
import mempoolBlocks from './mempool-blocks';
import { Common } from './common';
import loadingIndicators from './loading-indicators';
import config from '../config';
import transactionUtils from './transaction-utils';
import difficultyAdjustment from './difficulty-adjustment';
import feeApi from './fee-api';
import BlocksRepository from '../repositories/BlocksRepository';
import BlocksAuditsRepository from '../repositories/BlocksAuditsRepository';
import BlocksSummariesRepository from '../repositories/BlocksSummariesRepository';
import Audit from './audit';
import priceUpdater from '../tasks/price-updater';
import { ApiPrice } from '../repositories/PricesRepository';
import statistics from './statistics/statistics';
import bitcoinApi from './bitcoin/bitcoin-api-factory';
import walletApi from './services/wallets';

interface AddressTransactions {
  mempool: VerboseMempoolTransactionExtended[];
  confirmed: VerboseMempoolTransactionExtended[];
  removed: VerboseMempoolTransactionExtended[];
}
import bitcoinSecondClient from './bitcoin/bitcoin-second-client';
import { getRecentFirstSeen } from '../utils/file-read';
import stratumApi, { StratumJob } from './services/stratum';

// valid 'want' subscriptions
const wantable = ['blocks', 'mempool-blocks', 'live-2h-chart', 'stats', 'tomahawk'];

class WebsocketHandler {
  private webSocketServers: WebSocket.Server[] = [];
  private extraInitProperties = {};

  private numClients = 0;
  private numConnected = 0;
  private numDisconnected = 0;

  private socketData: { [key: string]: string } = {};
  private serializedInitData = '{}';
  private mempoolSequence = 0;

  private MAX_BUFFERED_AMOUNT = 15_000_000; // Max. 15 MB buffered amount
  public MAX_MESSAGE_SIZE = 100_000; // Max. 100 KB message size
  private MAX_TRACKED_TXS = 500; // Max. 500 tracked transactions
  private MSG_RATE_LIMIT = 200; // Max. 200 messages per 10 seconds
  private MSG_RATE_WINDOW = 10_000; // 10 seconds

  addWebsocketServer(wss: WebSocket.Server) {
    this.webSocketServers.push(wss);
  }

  setExtraInitData(property: string, value: any) {
    this.extraInitProperties[property] = value;
    this.updateSocketDataFields(this.extraInitProperties);
  }

  private updateSocketDataFields(data: { [property: string]: any }): void {
    for (const property of Object.keys(data)) {
      if (data[property]) {
        this.socketData[property] = JSON.stringify(data[property]);
      } else {
        delete this.socketData[property];
      }
    }
    this.serializedInitData =
      '{' +
      Object.keys(this.socketData)
        .map((key) => `"${key}": ${this.socketData[key]}`)
        .join(', ') +
      '}';
  }

  private updateSocketData(): void {
    const _blocks = blocks.getBlocks().slice(-config.EXPLORER.INITIAL_BLOCKS_AMOUNT);
    const da = difficultyAdjustment.getDifficultyAdjustment();
    this.updateSocketDataFields({
      backend: config.EXPLORER.BACKEND,
      mempoolInfo: memPool.getMempoolInfo(),
      bytesPerSecond: memPool.getBytesPerSecond(),
      blocks: _blocks,
      conversions: priceUpdater.getLatestPrices(),
      'mempool-blocks': mempoolBlocks.getMempoolBlocks(),
      transactions: memPool.getLatestTransactions(),
      backendInfo: backendInfo.getBackendInfo(),
      loadingIndicators: loadingIndicators.getLoadingIndicators(),
      da: da ?? undefined,
      fees: feeApi.getPreciseRecommendedFee(),
    });
  }

  public getSerializedInitData(): string {
    return this.serializedInitData;
  }

  setupConnectionHandling() {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    for (const server of this.webSocketServers) {
      server.on('connection', (client: WebSocket, req) => {
        this.numConnected++;
        client['remoteAddress'] = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        client['msgTimestamps'] = [];
        client.on('error', (e) => {
          logger.info(
            `websocket client error from ${client['remoteAddress']}: ` + (e instanceof Error ? e.message : e)
          );
          client.close();
        });
        client.on('close', () => {
          this.numDisconnected++;
        });
        client.on('message', async (message) => {
          try {
            const msgLength = Buffer.isBuffer(message)
              ? message.byteLength
              : message instanceof ArrayBuffer
                ? message.byteLength
                : message.reduce((sum, buf) => sum + buf.byteLength, 0);
            if (msgLength > this.MAX_MESSAGE_SIZE) {
              logger.debug(`Dropping oversized websocket message from ${client['remoteAddress']}: ${msgLength} bytes`);
              client.terminate();
              return;
            }

            const now = Date.now();
            const timestamps: number[] = client['msgTimestamps'];
            timestamps.push(now);
            while (timestamps.length && timestamps[0] <= now - this.MSG_RATE_WINDOW) {
              timestamps.shift();
            }
            if (timestamps.length > this.MSG_RATE_LIMIT) {
              logger.debug(`Rate limiting websocket client ${client['remoteAddress']}`);
              client.close();
              return;
            }

            const parsedMessage: WebsocketResponse = JSON.parse(message as any);
            const response = {};

            const wantNow = {};
            if (parsedMessage && parsedMessage.action === 'want' && Array.isArray(parsedMessage.data)) {
              for (const sub of wantable) {
                const key = `want-${sub}`;
                const wants = parsedMessage.data.includes(sub);
                if (wants && !client[key]) {
                  wantNow[key] = true;
                }
                client[key] = wants;
              }
              client['wants'] = true;
            }

            // send initial data when a client first starts a subscription
            if (wantNow['want-blocks'] || (parsedMessage && parsedMessage['refresh-blocks'])) {
              response['blocks'] = this.socketData['blocks'];
            }

            if (wantNow['want-mempool-blocks']) {
              response['mempool-blocks'] = this.socketData['mempool-blocks'];
            }

            if (wantNow['want-stats']) {
              response['mempoolInfo'] = this.socketData['mempoolInfo'];
              response['bytesPerSecond'] = this.socketData['bytesPerSecond'];
              response['fees'] = this.socketData['fees'];
              response['da'] = this.socketData['da'];
            }

            if (wantNow['want-tomahawk']) {
              response['tomahawk'] = JSON.stringify(bitcoinApi.getHealthStatus());
            }

            if (parsedMessage && parsedMessage['track-tx']) {
              if (/^[a-fA-F0-9]{64}$/.test(parsedMessage['track-tx'])) {
                client['track-tx'] = parsedMessage['track-tx'];
                const trackTxid = client['track-tx'];
                // Client is telling the transaction wasn't found
                if (parsedMessage['watch-mempool']) {
                  // It might have appeared before we had the time to start watching for it
                  const tx = memPool.getMempool()[trackTxid];
                  if (tx) {
                    // tx.prevout is missing from transactions when in bitcoind mode
                    try {
                      const fullTx = await transactionUtils.$getMempoolTransactionExtended(tx.txid, true);
                      response['tx'] = JSON.stringify(fullTx);
                    } catch (e) {
                      logger.debug('Error finding transaction: ' + (e instanceof Error ? e.message : e));
                    }
                  } else {
                    try {
                      const fullTx = await transactionUtils.$getMempoolTransactionExtended(client['track-tx'], true);
                      response['tx'] = JSON.stringify(fullTx);
                    } catch (e) {
                      logger.debug('Error finding transaction. ' + (e instanceof Error ? e.message : e));
                      client['track-mempool-tx'] = parsedMessage['track-tx'];
                    }
                  }
                }
                const tx = memPool.getMempool()[trackTxid];
                if (tx && tx.position) {
                  const position: {
                    block: number;
                    size: number;
                  } = {
                    ...tx.position,
                  };
                  response['txPosition'] = JSON.stringify({
                    txid: trackTxid,
                    position,
                  });
                }
              } else {
                client['track-tx'] = null;
              }
            }

            if (parsedMessage && parsedMessage['track-txs']) {
              const txids: string[] = [];
              if (Array.isArray(parsedMessage['track-txs'])) {
                if (parsedMessage['track-txs'].length > this.MAX_TRACKED_TXS) {
                  response['track-txs-error'] =
                    `"too many txids requested, this connection supports tracking a maximum of ${this.MAX_TRACKED_TXS} transactions"`;
                  this.send(client, this.serializeResponse(response));
                  client['track-txs'] = null;
                  client.close();
                  return;
                }
                for (const txid of parsedMessage['track-txs']) {
                  if (/^[a-fA-F0-9]{64}$/.test(txid)) {
                    txids.push(txid);
                  }
                }
              } else {
                response['track-txs-error'] = `"incorrect track-txs format"`;
                this.send(client, this.serializeResponse(response));
                client['track-txs'] = null;
                client.close();
                return;
              }

              const txs: { [txid: string]: TxTrackingInfo } = {};
              for (const txid of txids) {
                const txInfo: TxTrackingInfo = {};
                const tx = memPool.getMempool()[txid];
                if (tx) {
                  if (tx.position) {
                    txInfo.position = {
                      ...tx.position,
                    };
                  }
                  txInfo.confirmed = false;
                  txs[txid] = txInfo;
                }
              }

              if (txids.length) {
                client['track-txs'] = txids;
                client['track-txs-updates'] = 0;
              } else {
                client['track-txs'] = null;
                client['track-txs-updates'] = 0;
              }

              if (Object.keys(txs).length) {
                client['track-txs-updates'] = (client['track-txs-updates'] || 0) + Object.keys(txs).length;
                response['tracked-txs'] = JSON.stringify(txs);
              }
            }

            if (parsedMessage && parsedMessage['track-address']) {
              const validAddress = this.testAddress(parsedMessage['track-address']);
              if (validAddress) {
                client['track-address'] = validAddress;
              } else {
                client['track-address'] = null;
              }
            }

            if (parsedMessage && parsedMessage['track-addresses'] && Array.isArray(parsedMessage['track-addresses'])) {
              const addressMap: { [address: string]: string } = {};
              for (const address of parsedMessage['track-addresses']) {
                const validAddress = this.testAddress(address);
                if (validAddress) {
                  addressMap[address] = validAddress;
                }
              }
              if (Object.keys(addressMap).length > config.EXPLORER.MAX_TRACKED_ADDRESSES) {
                response['track-addresses-error'] =
                  `"too many addresses requested, this connection supports tracking a maximum of ${config.EXPLORER.MAX_TRACKED_ADDRESSES} addresses"`;
                client['track-addresses'] = null;
                client['track-addresses-updates'] = 0;
              } else if (Object.keys(addressMap).length > 0) {
                client['track-addresses'] = addressMap;
                client['track-addresses-updates'] = 0;
              } else {
                client['track-addresses'] = null;
                client['track-addresses-updates'] = 0;
              }
            }

            if (
              parsedMessage &&
              parsedMessage['track-scriptpubkeys'] &&
              Array.isArray(parsedMessage['track-scriptpubkeys'])
            ) {
              const spks: string[] = [];
              for (const spk of parsedMessage['track-scriptpubkeys']) {
                if (/^[a-fA-F0-9]+$/.test(spk)) {
                  spks.push(spk.toLowerCase());
                }
              }
              if (spks.length > config.EXPLORER.MAX_TRACKED_ADDRESSES) {
                response['track-scriptpubkeys-error'] =
                  `"too many scriptpubkeys requested, this connection supports tracking a maximum of ${config.EXPLORER.MAX_TRACKED_ADDRESSES} scriptpubkeys"`;
                client['track-scriptpubkeys'] = null;
              } else if (spks.length) {
                client['track-scriptpubkeys'] = spks;
              } else {
                client['track-scriptpubkeys'] = null;
              }
            }

            if (parsedMessage && parsedMessage['track-wallet']) {
              if (parsedMessage['track-wallet'] === 'stop') {
                client['track-wallet'] = null;
              } else if (
                typeof parsedMessage['track-wallet'] === 'string' &&
                walletApi.getWallets().includes(parsedMessage['track-wallet'])
              ) {
                client['track-wallet'] = parsedMessage['track-wallet'];
              } else {
                client['track-wallet'] = null;
              }
            }

            if (parsedMessage && parsedMessage['track-mempool-block'] !== undefined) {
              if (Number.isInteger(parsedMessage['track-mempool-block']) && parsedMessage['track-mempool-block'] >= 0) {
                const index = parsedMessage['track-mempool-block'];
                client['track-mempool-block'] = index;
                const mBlocksWithTransactions = mempoolBlocks.getMempoolBlocksWithTransactions();
                response['projected-block-transactions'] = JSON.stringify({
                  index: index,
                  sequence: this.mempoolSequence,
                  blockTransactions: (mBlocksWithTransactions[index]?.transactions || []).map(mempoolBlocks.compressTx),
                });
              } else {
                client['track-mempool-block'] = null;
              }
            }

            // Disable rbf and accelerations by default (BCH won't use it)
            client['track-rbf'] = false;
            client['track-rbf-summary'] = false;
            client['track-accelerations'] = false;

            if (parsedMessage.action === 'init') {
              if (
                !this.socketData['blocks']?.length ||
                !this.socketData['da'] ||
                !this.socketData['backendInfo'] ||
                !this.socketData['conversions']
              ) {
                this.updateSocketData();
              }
              if (!this.socketData['blocks']?.length) {
                return;
              }
              this.send(client, this.serializedInitData);
            }

            if (parsedMessage.action === 'ping') {
              response['pong'] = JSON.stringify(true);
            }

            if (typeof parsedMessage['track-donation'] === 'string' && parsedMessage['track-donation'].length === 22) {
              client['track-donation'] = parsedMessage['track-donation'];
            }

            if (parsedMessage['track-mempool-txids'] === true) {
              client['track-mempool-txids'] = true;
            } else if (parsedMessage['track-mempool-txids'] === false) {
              delete client['track-mempool-txids'];
            }

            if (parsedMessage['track-mempool'] === true) {
              client['track-mempool'] = true;
            } else if (parsedMessage['track-mempool'] === false) {
              delete client['track-mempool'];
            }

            if (parsedMessage && parsedMessage['track-stratum']) {
              if (parsedMessage['track-stratum'] === 'all' || typeof parsedMessage['track-stratum'] === 'number') {
                const sub = parsedMessage['track-stratum'];
                client['track-stratum'] = sub;
                response['stratumJobs'] = this.socketData['stratumJobs'];
              } else {
                client['track-stratum'] = false;
              }
            }

            if (Object.keys(response).length) {
              this.send(client, this.serializeResponse(response));
            }
          } catch (e) {
            logger.debug(
              `Error parsing websocket message from ${client['remoteAddress']}: ` + (e instanceof Error ? e.message : e)
            );
            client.close();
          }
        });
      });
    }
  }

  handleNewDonation(id: string) {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }
        if (client['track-donation'] === id) {
          this.send(client, JSON.stringify({ donationConfirmed: true }));
        }
      });
    }
  }

  handleLoadingChanged(indicators: ILoadingIndicators) {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    this.updateSocketDataFields({ loadingIndicators: indicators });

    const response = JSON.stringify({ loadingIndicators: indicators });
    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }
        this.send(client, response);
      });
    }
  }

  handleNewConversionRates(conversionRates: ApiPrice) {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    this.updateSocketDataFields({ conversions: conversionRates });

    const response = JSON.stringify({ conversions: conversionRates });
    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }
        this.send(client, response);
      });
    }
  }

  handleNewStatistic(stats: OptimizedStatistic) {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    this.printLogs();

    const response = JSON.stringify({
      'live-2h-chart': stats,
    });

    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }

        if (!client['want-live-2h-chart']) {
          return;
        }

        this.send(client, response);
      });
    }
  }

  handleReorg(): void {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    const da = difficultyAdjustment.getDifficultyAdjustment();

    // update init data
    this.updateSocketDataFields({
      blocks: blocks.getBlocks(),
      da: da ?? undefined,
    });

    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }

        const response = {};

        if (client['want-blocks']) {
          response['blocks'] = this.socketData['blocks'];
        }
        if (client['want-stats']) {
          response['da'] = this.socketData['da'];
        }

        if (Object.keys(response).length) {
          this.send(client, this.serializeResponse(response));
        }
      });
    }
  }

  /**
   *
   * @param newMempool
   * @param mempoolSize
   * @param newTransactions  array of transactions added this mempool update.
   * @param recentlyDeletedTransactions array of arrays of transactions removed in the last N mempool updates, most recent first.
   * @param accelerationDelta
   * @param candidates
   */
  async $handleMempoolChange(
    newMempool: { [txid: string]: VerboseMempoolTransactionExtended },
    mempoolSize: number,
    newTransactions: VerboseMempoolTransactionExtended[],
    recentlyDeletedTransactions: VerboseMempoolTransactionExtended[][],
    candidates?: GbtCandidates
  ): Promise<void> {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    this.printLogs();

    const deletedTransactions = recentlyDeletedTransactions.length ? recentlyDeletedTransactions[0] : [];

    const transactionIds =
      memPool.limitGBT && candidates ? Object.keys(candidates?.txs || {}) : Object.keys(newMempool);
    let added = newTransactions;
    let removed = deletedTransactions;
    if (memPool.limitGBT) {
      added = candidates?.added || [];
      removed = candidates?.removed || [];
    }

    if (config.EXPLORER.RUST_GBT) {
      await mempoolBlocks.$rustUpdateBlockTemplates(transactionIds, newMempool, added, removed, candidates);
    } else {
      await mempoolBlocks.$updateBlockTemplates(transactionIds, newMempool, added, removed, candidates, true);
    }

    const mBlocks = mempoolBlocks.getMempoolBlocks();
    const mBlockDeltas = mempoolBlocks.getMempoolBlockDeltas();
    const mempoolInfo = memPool.getMempoolInfo();
    const bytesPerSecond = memPool.getBytesPerSecond();
    const da = difficultyAdjustment.getDifficultyAdjustment();
    memPool.removeFromSpendMap(deletedTransactions);
    memPool.addToSpendMap(newTransactions);
    const recommendedFees = feeApi.getPreciseRecommendedFee();

    const latestTransactions = memPool.getLatestTransactions();

    if (memPool.isInSync()) {
      this.mempoolSequence++;
    }
    const mempoolDeltaTxids: MempoolDeltaTxids = {
      sequence: this.mempoolSequence,
      added: newTransactions.map((tx) => tx.txid),
      removed: deletedTransactions.map((tx) => tx.txid),
      mined: [],
    };
    const mempoolDelta: MempoolDelta = {
      sequence: this.mempoolSequence,
      added: newTransactions,
      removed: deletedTransactions.map((tx) => tx.txid),
      mined: [],
    };

    // update init data
    const socketDataFields = {
      mempoolInfo: mempoolInfo,
      bytesPerSecond: bytesPerSecond,
      'mempool-blocks': mBlocks,
      transactions: latestTransactions,
      loadingIndicators: loadingIndicators.getLoadingIndicators(),
      da: da ?? undefined,
      fees: recommendedFees,
    };
    this.updateSocketDataFields(socketDataFields);

    // cache serialized objects to avoid stringify-ing the same thing for every client
    const responseCache = { ...this.socketData };
    function getCachedResponse(key: string, data): string {
      if (!responseCache[key]) {
        responseCache[key] = JSON.stringify(data);
      }
      return responseCache[key];
    }

    // pre-compute new tracked outspends
    const outspendCache: {
      [txid: string]: { [vout: number]: { vin: number; txid: string } };
    } = {};
    const trackedTxs = new Set<string>();
    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client['track-tx']) {
          trackedTxs.add(client['track-tx']);
        }
        if (client['track-txs']) {
          for (const txid of client['track-txs']) {
            trackedTxs.add(txid);
          }
        }
      });
    }
    if (trackedTxs.size > 0) {
      for (const tx of newTransactions) {
        for (let i = 0; i < tx.vin.length; i++) {
          const vin = tx.vin[i];
          if (trackedTxs.has(vin.txid)) {
            if (!outspendCache[vin.txid]) {
              outspendCache[vin.txid] = {
                [vin.vout]: { vin: i, txid: tx.txid },
              };
            } else {
              outspendCache[vin.txid][vin.vout] = { vin: i, txid: tx.txid };
            }
          }
        }
      }
    }

    // pre-compute address transactions
    const addressCache = this.makeAddressCache(newTransactions);
    const removedAddressCache = this.makeAddressCache(deletedTransactions);

    for (const server of this.webSocketServers) {
      server.clients.forEach(async (client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }

        const response = {};

        if (client['want-stats']) {
          response['mempoolInfo'] = getCachedResponse('mempoolInfo', mempoolInfo);
          response['bytesPerSecond'] = getCachedResponse('bytesPerSecond', bytesPerSecond);
          response['transactions'] = getCachedResponse('transactions', latestTransactions);
          if (da) {
            response['da'] = getCachedResponse('da', da);
          }
          response['fees'] = getCachedResponse('fees', recommendedFees);
        }

        if (client['want-mempool-blocks']) {
          response['mempool-blocks'] = getCachedResponse('mempool-blocks', mBlocks);
        }

        if (client['want-tomahawk']) {
          response['tomahawk'] = getCachedResponse('tomahawk', bitcoinApi.getHealthStatus());
        }

        if (client['track-mempool-tx']) {
          const tx = newTransactions.find((t) => t.txid === client['track-mempool-tx']);
          if (tx) {
            try {
              const fullTx = await transactionUtils.$getMempoolTransactionExtended(tx.txid, true);
              response['tx'] = JSON.stringify(fullTx);
            } catch (e) {
              logger.debug('Error finding transaction in mempool: ' + (e instanceof Error ? e.message : e));
            }
            client['track-mempool-tx'] = null;
          }
        }

        if (client['track-address']) {
          const newTransactions = Array.from(addressCache[client['track-address']]?.values() || []);
          const removedTransactions = Array.from(removedAddressCache[client['track-address']]?.values() || []);
          // txs may be missing prevouts,
          // so fetch the full transactions now
          const fullTransactions = await this.getFullTransactions(newTransactions);

          if (removedTransactions.length) {
            response['address-removed-transactions'] = JSON.stringify(removedTransactions);
          }
          if (fullTransactions.length) {
            response['address-transactions'] = JSON.stringify(fullTransactions);
          }
        }

        if (client['track-addresses']) {
          const addressMap: { [address: string]: AddressTransactions } = {};
          for (const [address, key] of Object.entries(client['track-addresses'] || {})) {
            const newTransactions = Array.from(addressCache[key as string]?.values() || []);
            const removedTransactions = Array.from(removedAddressCache[key as string]?.values() || []);
            // txs may be missing prevouts,
            // so fetch the full transactions now
            const fullTransactions = await this.getFullTransactions(newTransactions);
            if (fullTransactions?.length) {
              addressMap[address] = {
                mempool: fullTransactions,
                confirmed: [],
                removed: removedTransactions,
              };
            }
          }

          if (Object.keys(addressMap).length > 0) {
            client['track-addresses-updates'] =
              (client['track-addresses-updates'] || 0) + this.countAddressTransactions(addressMap);
            response['multi-address-transactions'] = JSON.stringify(addressMap);
          }
        }

        if (client['track-scriptpubkeys']) {
          const spkMap: { [spk: string]: AddressTransactions } = {};
          for (const spk of client['track-scriptpubkeys'] || []) {
            const newTransactions = Array.from(addressCache[spk as string]?.values() || []);
            const removedTransactions = Array.from(removedAddressCache[spk as string]?.values() || []);
            // txs may be missing prevouts,
            // so fetch the full transactions now
            const fullTransactions = await this.getFullTransactions(newTransactions);
            if (fullTransactions?.length) {
              spkMap[spk] = {
                mempool: fullTransactions,
                confirmed: [],
                removed: removedTransactions,
              };
            }
          }

          if (Object.keys(spkMap).length > 0) {
            response['multi-scriptpubkey-transactions'] = JSON.stringify(spkMap);
          }
        }

        if (client['track-tx']) {
          const trackTxid = client['track-tx'];
          const outspends = outspendCache[trackTxid];

          if (outspends && Object.keys(outspends).length) {
            response['utxoSpent'] = JSON.stringify(outspends);
          }

          const mempoolTx = newMempool[trackTxid];
          if (mempoolTx && mempoolTx.position) {
            const positionData = {
              txid: trackTxid,
              position: {
                ...mempoolTx.position,
                feeDelta: mempoolTx.feeDelta || undefined,
              },
            };
            response['txPosition'] = JSON.stringify(positionData);
          }
        }

        if (client['track-txs']) {
          const txids = client['track-txs'];
          const txs: { [txid: string]: TxTrackingInfo } = {};
          for (const txid of txids) {
            const txInfo: TxTrackingInfo = {};
            let txHasInfo = false;
            const outspends = outspendCache[txid];
            if (outspends && Object.keys(outspends).length) {
              txInfo.utxoSpent = outspends;
              txHasInfo = true;
            }
            const mempoolTx = newMempool[txid];
            if (mempoolTx && mempoolTx.position) {
              txInfo.position = {
                ...mempoolTx.position,
                feeDelta: mempoolTx.feeDelta || undefined,
              };
              txHasInfo = true;
            }
            if (txHasInfo) {
              txs[txid] = txInfo;
            }
          }
          if (Object.keys(txs).length) {
            client['track-txs-updates'] = (client['track-txs-updates'] || 0) + Object.keys(txs).length;
            response['tracked-txs'] = JSON.stringify(txs);
          }
        }

        if (client['track-mempool-block'] >= 0 && memPool.isInSync()) {
          const index = client['track-mempool-block'];
          if (mBlockDeltas[index]) {
            response['projected-block-transactions'] = getCachedResponse(`projected-block-transactions-${index}`, {
              index: index,
              sequence: this.mempoolSequence,
              delta: mBlockDeltas[index],
            });
          }
        }

        if (client['track-mempool-txids']) {
          response['mempool-txids'] = getCachedResponse('mempool-txids', mempoolDeltaTxids);
        }

        if (client['track-mempool']) {
          response['mempool-transactions'] = getCachedResponse('mempool-transactions', mempoolDelta);
        }

        if (Object.keys(response).length) {
          this.send(client, this.serializeResponse(response));
        }
      });
    }
  }

  async handleNewBlock(
    block: BlockExtended,
    txIds: string[],
    transactions: VerboseMempoolTransactionExtended[]
  ): Promise<void> {
    if (!this.webSocketServers.length) {
      throw new Error('No WebSocket.Server have been set');
    }

    const blockTransactions = structuredClone(transactions);

    this.printLogs();
    if (config.STATISTICS.ENABLED && config.DATABASE.ENABLED) {
      await statistics.runStatistics();
    }

    const _memPool = memPool.getMempool();
    const candidateTxs = memPool.getMempoolCandidates();
    let candidates: GbtCandidates | undefined =
      memPool.limitGBT && candidateTxs ? { txs: candidateTxs, added: [], removed: [] } : undefined;
    let transactionIds: string[] = memPool.limitGBT ? Object.keys(candidates?.txs || {}) : Object.keys(_memPool);

    memPool.removeFromSpendMap(transactions);

    if (config.EXPLORER.AUDIT && memPool.isInSync()) {
      let projectedBlocks;
      const auditMempool = _memPool;

      if (config.EXPLORER.RUST_GBT) {
        const added = memPool.limitGBT ? candidates?.added || [] : [];
        const removed = memPool.limitGBT ? candidates?.removed || [] : [];
        projectedBlocks = await mempoolBlocks.$rustUpdateBlockTemplates(
          transactionIds,
          auditMempool,
          added,
          removed,
          candidates
        );
      } else {
        projectedBlocks = await mempoolBlocks.$makeBlockTemplates(transactionIds, auditMempool, candidates, false);
      }

      if (Common.indexingEnabled()) {
        const auditResult = Audit.auditBlock(block.height, blockTransactions, projectedBlocks, auditMempool);
        const matchRatePercentage = Math.round(auditResult.matchRate * 100 * 100) / 100;

        const stripped = projectedBlocks[0]?.transactions ? projectedBlocks[0].transactions : [];

        let totalFees = 0;
        let totalSize = 0;
        for (const tx of stripped) {
          totalFees += tx.fee;
          totalSize += tx.size;
        }

        BlocksSummariesRepository.$saveTemplate({
          height: block.height,
          template: {
            id: block.id,
            transactions: stripped,
          },
          version: 1,
        });

        BlocksAuditsRepository.$saveAudit({
          version: 1,
          time: block.timestamp,
          height: block.height,
          hash: block.id,
          unseenTxs: auditResult.unseen,
          addedTxs: auditResult.added,
          missingTxs: auditResult.censored,
          freshTxs: auditResult.fresh,
          sigopTxs: auditResult.sigop,
          matchRate: matchRatePercentage,
          expectedFees: totalFees,
          expectedSize: totalSize,
        });

        if (block.extras) {
          block.extras.matchRate = matchRatePercentage;
          block.extras.expectedFees = totalFees;
          block.extras.expectedSize = totalSize;
          block.extras.similarity = auditResult.similarity;
        }
      }
    } else if (block.extras) {
      const mBlocks = mempoolBlocks.getMempoolBlocksWithTransactions();
      if (mBlocks?.length && mBlocks[0].transactions) {
        block.extras.similarity = Common.getSimilarity(mBlocks[0], transactions);
      }
    }

    if (config.CORE_RPC.DEBUG_LOG_PATH && block.extras) {
      const firstSeen = getRecentFirstSeen(block.id);
      if (firstSeen) {
        if (config.DATABASE.ENABLED) {
          BlocksRepository.$saveFirstSeenTime(block.id, firstSeen);
        }
        block.extras.firstSeen = firstSeen;
      }
    }

    const confirmedTxids: { [txid: string]: boolean } = {};

    // Update mempool to remove transactions included in the new block
    for (const txId of txIds) {
      delete _memPool[txId];
      confirmedTxids[txId] = true;
    }

    if (memPool.limitGBT) {
      const minFeeMempool = memPool.limitGBT ? await bitcoinSecondClient.getRawMemPool() : null;
      const minFeeTip = memPool.limitGBT ? await bitcoinSecondClient.getBlockCount() : -1;
      candidates = memPool.getNextCandidates(minFeeMempool, minFeeTip, transactions);
      transactionIds = Object.keys(candidates?.txs || {});
    } else {
      candidates = undefined;
      transactionIds = Object.keys(memPool.getMempool());
    }

    if (config.EXPLORER.RUST_GBT) {
      const added = memPool.limitGBT ? candidates?.added || [] : [];
      const removed = memPool.limitGBT ? candidates?.removed || [] : transactions;
      await mempoolBlocks.$rustUpdateBlockTemplates(transactionIds, _memPool, added, removed, candidates);
    } else {
      await mempoolBlocks.$makeBlockTemplates(transactionIds, _memPool, candidates, true);
    }
    const mBlocks = mempoolBlocks.getMempoolBlocks();
    const mBlockDeltas = mempoolBlocks.getMempoolBlockDeltas();

    const da = difficultyAdjustment.getDifficultyAdjustment();
    const fees = feeApi.getPreciseRecommendedFee();
    const mempoolInfo = memPool.getMempoolInfo();

    // pre-compute address transactions
    const addressCache = this.makeAddressCache(transactions);

    // update init data
    this.updateSocketDataFields({
      mempoolInfo: mempoolInfo,
      blocks: [...blocks.getBlocks(), block].slice(-config.EXPLORER.INITIAL_BLOCKS_AMOUNT),
      'mempool-blocks': mBlocks,
      loadingIndicators: loadingIndicators.getLoadingIndicators(),
      da: da ?? undefined,
      fees: fees,
    });

    const mBlocksWithTransactions = mempoolBlocks.getMempoolBlocksWithTransactions();

    if (memPool.isInSync()) {
      this.mempoolSequence++;
    }

    const mempoolDeltaTxids: MempoolDeltaTxids = {
      sequence: this.mempoolSequence,
      added: [],
      removed: [],
      mined: transactions.map((tx) => tx.txid),
    };
    const mempoolDelta: MempoolDelta = {
      sequence: this.mempoolSequence,
      added: [],
      removed: [],
      mined: transactions.map((tx) => tx.txid),
    };

    // check for wallet transactions
    const walletTransactions = config.WALLETS.ENABLED ? walletApi.processBlock(block, transactions) : [];

    const responseCache = { ...this.socketData };
    function getCachedResponse(key, data): string {
      if (!responseCache[key]) {
        responseCache[key] = JSON.stringify(data);
      }
      return responseCache[key];
    }

    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }

        const response = {};

        if (client['want-blocks']) {
          response['block'] = getCachedResponse('block', block);
        }

        if (client['want-stats']) {
          response['mempoolInfo'] = getCachedResponse('mempoolInfo', mempoolInfo);
          response['bytesPerSecond'] = getCachedResponse('bytesPerSecond', memPool.getBytesPerSecond());
          response['fees'] = getCachedResponse('fees', fees);

          if (da) {
            response['da'] = getCachedResponse('da', da);
          }
        }

        if (mBlocks && client['want-mempool-blocks']) {
          response['mempool-blocks'] = getCachedResponse('mempool-blocks', mBlocks);
        }

        if (client['want-tomahawk']) {
          response['tomahawk'] = getCachedResponse('tomahawk', bitcoinApi.getHealthStatus());
        }

        if (client['track-tx']) {
          const trackTxid = client['track-tx'];
          if (trackTxid && confirmedTxids[trackTxid]) {
            response['txConfirmed'] = JSON.stringify(trackTxid);
          } else {
            const mempoolTx = _memPool[trackTxid];
            if (mempoolTx && mempoolTx.position) {
              response['txPosition'] = JSON.stringify({
                txid: trackTxid,
                position: {
                  ...mempoolTx.position,
                  feeDelta: mempoolTx.feeDelta || undefined,
                },
              });
            }
          }
        }

        if (client['track-txs']) {
          const txs: { [txid: string]: TxTrackingInfo } = {};
          for (const txid of client['track-txs']) {
            if (confirmedTxids[txid]) {
              txs[txid] = { confirmed: true };
            } else {
              const mempoolTx = _memPool[txid];
              if (mempoolTx && mempoolTx.position) {
                txs[txid] = {
                  position: {
                    ...mempoolTx.position,
                  },
                  feeDelta: mempoolTx.feeDelta || undefined,
                };
              }
            }
          }
          if (Object.keys(txs).length) {
            client['track-txs-updates'] = (client['track-txs-updates'] || 0) + Object.keys(txs).length;
            response['tracked-txs'] = JSON.stringify(txs);
          }
        }

        if (client['track-address']) {
          const foundTransactions: VerboseTransactionExtended[] = Array.from(
            addressCache[client['track-address']]?.values() || []
          );

          if (foundTransactions.length) {
            foundTransactions.forEach((tx) => {
              tx.status = {
                confirmed: true,
                block_height: block.height,
                block_hash: block.id,
                block_time: block.timestamp,
              };
            });

            response['block-transactions'] = JSON.stringify(foundTransactions);
          }
        }

        if (client['track-addresses']) {
          const addressMap: { [address: string]: AddressTransactions } = {};
          for (const [address, key] of Object.entries(client['track-addresses'] || {})) {
            const fullTransactions = Array.from(addressCache[key as string]?.values() || []);
            if (fullTransactions?.length) {
              addressMap[address] = {
                mempool: [],
                confirmed: fullTransactions,
                removed: [],
              };
            }
          }

          if (Object.keys(addressMap).length > 0) {
            client['track-addresses-updates'] =
              (client['track-addresses-updates'] || 0) + this.countAddressTransactions(addressMap);
            response['multi-address-transactions'] = JSON.stringify(addressMap);
          }
        }

        if (client['track-scriptpubkeys']) {
          const spkMap: { [spk: string]: AddressTransactions } = {};
          for (const spk of client['track-scriptpubkeys'] || []) {
            const fullTransactions = Array.from(addressCache[spk as string]?.values() || []);
            if (fullTransactions?.length) {
              spkMap[spk] = {
                mempool: [],
                confirmed: fullTransactions,
                removed: [],
              };
            }
          }

          if (Object.keys(spkMap).length > 0) {
            response['multi-scriptpubkey-transactions'] = JSON.stringify(spkMap);
          }
        }

        if (client['track-mempool-block'] >= 0 && memPool.isInSync()) {
          const index = client['track-mempool-block'];

          if (mBlockDeltas && mBlockDeltas[index] && mBlocksWithTransactions[index]?.transactions?.length) {
            if (mBlockDeltas[index].added.length > mBlocksWithTransactions[index]?.transactions.length / 2) {
              response['projected-block-transactions'] = getCachedResponse(
                `projected-block-transactions-full-${index}`,
                {
                  index: index,
                  sequence: this.mempoolSequence,
                  blockTransactions: mBlocksWithTransactions[index].transactions.map(mempoolBlocks.compressTx),
                }
              );
            } else {
              response['projected-block-transactions'] = getCachedResponse(
                `projected-block-transactions-delta-${index}`,
                {
                  index: index,
                  sequence: this.mempoolSequence,
                  delta: mBlockDeltas[index],
                }
              );
            }
          }
        }

        if (client['track-mempool-txids']) {
          response['mempool-txids'] = getCachedResponse('mempool-txids', mempoolDeltaTxids);
        }

        if (client['track-mempool']) {
          response['mempool-transactions'] = getCachedResponse('mempool-transactions', mempoolDelta);
        }

        if (client['track-wallet']) {
          const trackedWallet = client['track-wallet'];
          response['wallet-transactions'] = getCachedResponse(
            `wallet-transactions-${trackedWallet}`,
            walletTransactions[trackedWallet] ?? {}
          );
        }

        if (Object.keys(response).length) {
          this.send(client, this.serializeResponse(response));
        }
      });
    }

    if (config.STATISTICS.ENABLED && config.DATABASE.ENABLED) {
      await statistics.runStatistics();
    }
  }

  public handleNewStratumJob(job: StratumJob): void {
    this.updateSocketDataFields({ stratumJobs: stratumApi.getJobs() });

    for (const server of this.webSocketServers) {
      server.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }
        if (client['track-stratum'] && (client['track-stratum'] === 'all' || client['track-stratum'] === job.pool)) {
          this.send(
            client,
            JSON.stringify({
              stratumJob: job,
            })
          );
        }
      });
    }
  }

  // sends data to a client, but checks if the client has not exceeded the buffered amount
  private send(client: WebSocket.WebSocket, data: string): void {
    if (client.bufferedAmount > this.MAX_BUFFERED_AMOUNT) {
      client.terminate();
      return;
    }
    client.send(data);
  }

  // takes a dictionary of JSON serialized values
  // and zips it together into a valid JSON object
  private serializeResponse(response): string {
    return (
      '{' +
      Object.keys(response)
        .filter((key) => response[key])
        .map((key) => `"${key}": ${response[key]}`)
        .join(', ') +
      '}'
    );
  }

  // checks if an address conforms to a valid format
  // returns the canonical form:
  //  - lowercase for bech32(m)
  //  - lowercase scriptpubkey for P2PK
  // or false if invalid
  private testAddress(address): string | false {
    if (
      /^([a-km-zA-HJ-NP-Z1-9]{26,35}|[a-km-zA-HJ-NP-Z1-9]{80}|[a-z]{2,5}1[ac-hj-np-z02-9]{8,100}|[A-Z]{2,5}1[AC-HJ-NP-Z02-9]{8,100}|04[a-fA-F0-9]{128}|(02|03)[a-fA-F0-9]{64})$/.test(
        address
      )
    ) {
      if (/^[A-Z]{2,5}1[AC-HJ-NP-Z02-9]{8,100}|04[a-fA-F0-9]{128}|(02|03)[a-fA-F0-9]{64}$/.test(address)) {
        address = address.toLowerCase();
      }
      if (/^04[a-fA-F0-9]{128}$/.test(address)) {
        return '41' + address + 'ac';
      } else if (/^(02|03)[a-fA-F0-9]{64}$/.test(address)) {
        return '21' + address + 'ac';
      } else {
        return address;
      }
    } else {
      return false;
    }
  }

  private makeAddressCache(transactions: VerboseMempoolTransactionExtended[]): {
    [address: string]: Set<VerboseMempoolTransactionExtended>;
  } {
    const addressCache: { [address: string]: Set<VerboseMempoolTransactionExtended> } = {};
    for (const tx of transactions) {
      for (const vin of tx.vin) {
        if (vin?.prevout?.scriptpubkey_address) {
          if (!addressCache[vin.prevout.scriptpubkey_address]) {
            addressCache[vin.prevout.scriptpubkey_address] = new Set();
          }
          addressCache[vin.prevout.scriptpubkey_address].add(tx);
        }
        if (vin?.prevout?.scriptpubkey) {
          if (!addressCache[vin.prevout.scriptpubkey]) {
            addressCache[vin.prevout.scriptpubkey] = new Set();
          }
          addressCache[vin.prevout.scriptpubkey].add(tx);
        }
      }
      for (const vout of tx.vout) {
        if (vout?.scriptpubkey_address) {
          if (!addressCache[vout?.scriptpubkey_address]) {
            addressCache[vout?.scriptpubkey_address] = new Set();
          }
          addressCache[vout?.scriptpubkey_address].add(tx);
        }
        if (vout?.scriptpubkey) {
          if (!addressCache[vout.scriptpubkey]) {
            addressCache[vout.scriptpubkey] = new Set();
          }
          addressCache[vout.scriptpubkey].add(tx);
        }
      }
    }
    return addressCache;
  }

  private async getFullTransactions(
    transactions: VerboseMempoolTransactionExtended[]
  ): Promise<VerboseMempoolTransactionExtended[]> {
    for (let i = 0; i < transactions.length; i++) {
      try {
        transactions[i] = await transactionUtils.$getMempoolTransactionExtended(transactions[i].txid, true);
      } catch (e) {
        logger.debug('Error finding transaction in mempool: ' + (e instanceof Error ? e.message : e));
      }
    }
    return transactions;
  }

  private printLogs(): void {
    if (this.webSocketServers.length) {
      let numTxSubs = 0;
      let numTxsSubs = 0;
      let numAddressSubs = 0;
      let numAddressesSubs = 0;
      let numProjectedSubs = 0;
      let trackedTxsTotal = 0;
      let trackedAddressesTotal = 0;
      let trackedTxsMax = 0;
      let trackedAddressesMax = 0;
      let trackTxsTrackedTotal = 0;
      let trackTxsTrackedMax = 0;
      let trackAddressesTrackedTotal = 0;
      let trackAddressesTrackedMax = 0;
      let trackTxsUpdatesTotal = 0;
      let trackTxsUpdatesMax = 0;
      let trackAddressesUpdatesTotal = 0;
      let trackAddressesUpdatesMax = 0;

      for (const server of this.webSocketServers) {
        server.clients.forEach((client) => {
          let trackedTxCount = 0;
          let trackedAddressCount = 0;

          if (client['track-tx']) {
            numTxSubs++;
            trackedTxCount += 1;
          }
          if (client['track-txs']) {
            numTxsSubs++;
            trackedTxCount += client['track-txs'].length;
          }
          if (client['track-address']) {
            numAddressSubs++;
            trackedAddressCount += 1;
          }
          if (client['track-addresses']) {
            numAddressesSubs++;
            const addressCount = Object.keys(client['track-addresses']).length;
            trackedAddressCount += addressCount;
            trackAddressesTrackedTotal += addressCount;
            trackAddressesTrackedMax = Math.max(trackAddressesTrackedMax, addressCount);
            const updates = client['track-addresses-updates'] || 0;
            trackAddressesUpdatesTotal += updates;
            trackAddressesUpdatesMax = Math.max(trackAddressesUpdatesMax, updates);
            client['track-addresses-updates'] = 0;
          }
          if (client['track-mempool-block'] != null && client['track-mempool-block'] >= 0) {
            numProjectedSubs++;
          }
          if (client['track-txs']) {
            const txCount = client['track-txs'].length;
            trackTxsTrackedTotal += txCount;
            trackTxsTrackedMax = Math.max(trackTxsTrackedMax, txCount);
            const updates = client['track-txs-updates'] || 0;
            trackTxsUpdatesTotal += updates;
            trackTxsUpdatesMax = Math.max(trackTxsUpdatesMax, updates);
            client['track-txs-updates'] = 0;
          }

          trackedTxsTotal += trackedTxCount;
          trackedAddressesTotal += trackedAddressCount;
          trackedTxsMax = Math.max(trackedTxsMax, trackedTxCount);
          trackedAddressesMax = Math.max(trackedAddressesMax, trackedAddressCount);
        });
      }

      let count = 0;
      for (const server of this.webSocketServers) {
        count += server.clients?.size || 0;
      }
      const diff = count - this.numClients;
      this.numClients = count;
      const trackedTxsAvg = count > 0 ? trackedTxsTotal / count : 0;
      const trackedAddressesAvg = count > 0 ? trackedAddressesTotal / count : 0;
      const trackTxsTrackedAvg = numTxsSubs > 0 ? trackTxsTrackedTotal / numTxsSubs : 0;
      const trackAddressesTrackedAvg = numAddressesSubs > 0 ? trackAddressesTrackedTotal / numAddressesSubs : 0;
      const trackTxsUpdatesAvg = numTxsSubs > 0 ? trackTxsUpdatesTotal / numTxsSubs : 0;
      const trackAddressesUpdatesAvg = numAddressesSubs > 0 ? trackAddressesUpdatesTotal / numAddressesSubs : 0;
      logger.debug(
        `${count} websocket clients | ${this.numConnected} connected | ${this.numDisconnected} disconnected | (${diff >= 0 ? '+' : ''}${diff}) | tracked txs: total=${trackedTxsTotal}, avg=${trackedTxsAvg.toFixed(2)}, max=${trackedTxsMax} | tracked addresses: total=${trackedAddressesTotal}, avg=${trackedAddressesAvg.toFixed(2)}, max=${trackedAddressesMax} | ws-subscriptions: tx=${numTxSubs},txs=${numTxsSubs},address=${numAddressSubs},addresses=${numAddressesSubs},txs-tracked-avg=${trackTxsTrackedAvg.toFixed(2)},txs-tracked-max=${trackTxsTrackedMax},addresses-tracked-avg=${trackAddressesTrackedAvg.toFixed(2)},addresses-tracked-max=${trackAddressesTrackedMax},txs-updates-avg=${trackTxsUpdatesAvg.toFixed(2)},txs-updates-max=${trackTxsUpdatesMax},addresses-updates-avg=${trackAddressesUpdatesAvg.toFixed(2)},addresses-updates-max=${trackAddressesUpdatesMax}`
      );
      logger.debug(
        `websocket subscriptions: track-tx: ${numTxSubs}, track-txs: ${numTxsSubs}, track-address: ${numAddressSubs}, track-addresses: ${numAddressesSubs}, track-mempool-block: ${numProjectedSubs}`
      );
      this.numConnected = 0;
      this.numDisconnected = 0;
    }
  }

  private countAddressTransactions(addressMap: { [address: string]: AddressTransactions }): number {
    return Object.values(addressMap).reduce(
      (total, transactions) =>
        total + transactions.mempool.length + transactions.confirmed.length + transactions.removed.length,
      0
    );
  }
}

export default new WebsocketHandler();
