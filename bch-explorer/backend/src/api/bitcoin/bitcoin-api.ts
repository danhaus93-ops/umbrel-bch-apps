import { AbstractBitcoinApi } from './bitcoin-api-abstract-factory';
import { IBitcoinApi, SubmitPackageResult, TestMempoolAcceptResult } from './bitcoin-api.interface';
import { IPublicApi } from './public-api.interface';
import blocks from '../blocks';
import mempool from '../mempool';
import { VerboseTransactionExtended } from '../../mempool.interfaces';
import transactionUtils from '../transaction-utils';
import { Common } from '../common';

class BitcoinApi implements AbstractBitcoinApi {
  private rawMempoolCache: IBitcoinApi.RawMempool | null = null;
  protected bitcoindClient: any;

  constructor(bitcoinClient: any) {
    this.bitcoindClient = bitcoinClient;
  }

  static convertBlock(block: IBitcoinApi.Block): IPublicApi.Block {
    const returnBlock = {
      id: block.hash,
      height: block.height,
      version: block.version,
      timestamp: block.time,
      bits: parseInt(block.bits, 16),
      nonce: block.nonce,
      difficulty: block.difficulty,
      merkle_root: block.merkleroot,
      tx_count: block.nTx,
      size: block.size,
      previousblockhash: block.previousblockhash,
      mediantime: block.mediantime,
      stale: block.confirmations === -1,
    };
    // ABLA state is optional
    const ablaState = block.ablastate;
    if (ablaState) {
      returnBlock['abla_state'] = {
        block_size: ablaState.blocksize,
        block_size_limit: ablaState.blocksizelimit,
        next_block_size_limit: ablaState.nextblocksizelimit,
      };
    }

    return returnBlock;
  }

  $getRawTransaction(
    txId: string,
    skipConversion = false,
    addPrevout = false,
    lazyPrevouts = false
  ): Promise<IPublicApi.VerboseTransaction | IBitcoinApi.VerboseTransaction> {
    // If the transaction is in the mempool we already converted and fetched the fee. Only prevouts are missing
    const txInMempool = mempool.getMempool()[txId];
    if (txInMempool && addPrevout) {
      return this.$addPrevouts(txInMempool);
    }

    // This is using the convertTransaction with requires verbosity 2 + patterns, ignore blockhash argument (use an empty string)
    return this.bitcoindClient
      .getRawTransaction(txId, 2, '', true)
      .then((transaction: IBitcoinApi.VerboseTransaction) => {
        if (skipConversion) {
          transaction.vout.forEach((vout) => {
            vout.value = Math.round(vout.value * 100000000);
          });
          return transaction;
        }
        return this.$convertTransaction(transaction, addPrevout, lazyPrevouts);
      })
      .catch((e: Error) => {
        if (e.message.startsWith('The genesis block coinbase')) {
          return this.$returnCoinbaseTransaction();
        }
        throw e;
      });
  }

  async $getRawTransactions(txids: string[]): Promise<IPublicApi.VerboseTransaction[]> {
    const txs: IPublicApi.VerboseTransaction[] = [];
    for (const txid of txids) {
      try {
        const tx = (await this.$getRawTransaction(txid, false, true)) as IPublicApi.VerboseTransaction;
        txs.push(tx);
      } catch (err) {
        // skip failures
      }
    }
    return txs;
  }

  $getMempoolTransactions(txids: string[]): Promise<IPublicApi.Transaction[]> {
    throw new Error('Method getMempoolTransactions not supported by the Bitcoin RPC API.');
  }

  $getAllMempoolTransactions(lastTxid?: string, max_txs?: number): Promise<IPublicApi.Transaction[]> {
    throw new Error('Method getAllMempoolTransactions not supported by the Bitcoin RPC API.');
  }

  async $getTransactionHex(txId: string): Promise<string> {
    const txInMempool = mempool.getMempool()[txId];
    if (txInMempool && txInMempool.hex) {
      return txInMempool.hex;
    }

    return this.bitcoindClient.getRawTransaction(txId, true).then((transaction: IBitcoinApi.VerboseTransaction) => {
      return transaction.hex;
    });
  }

  $getTransactionMerkleProof(txId: string): Promise<IPublicApi.MerkleProof> {
    throw new Error('Method getTransactionMerkleProof not supported by the Bitcoin RPC API.');
  }

  $getBlockHeightTip(): Promise<number> {
    return this.bitcoindClient.getBlockCount();
  }

  $getBlockHashTip(): Promise<string> {
    return this.bitcoindClient.getBestBlockHash();
  }

  $getTxIdsForBlock(hash: string): Promise<string[]> {
    return this.bitcoindClient.getBlock(hash, 1).then((rpcBlock: IBitcoinApi.Block) => rpcBlock.tx);
  }

  async $getTxsForBlock(hash: string): Promise<IPublicApi.VerboseTransaction[]> {
    // This is using the convertTransaction with requires verbosity 2 + patterns
    const verboseBlock: IBitcoinApi.VerboseBlock = await this.bitcoindClient.getBlock(hash, 2, true);
    const transactions: IPublicApi.VerboseTransaction[] = [];
    for (const tx of verboseBlock.tx) {
      const converted = await this.$convertTransaction(tx, true, false, verboseBlock.confirmations === -1);
      converted.status = {
        confirmed: true,
        block_height: verboseBlock.height,
        block_hash: hash,
        block_time: verboseBlock.time,
      };
      transactions.push(converted);
    }
    return transactions;
  }

  $getRawBlock(hash: string): Promise<Buffer> {
    return this.bitcoindClient.getBlock(hash, 0).then((raw: string) => Buffer.from(raw, 'hex'));
  }

  $getBlockHash(height: number): Promise<string> {
    return this.bitcoindClient.getBlockHash(height);
  }

  $getBlockHeader(hash: string): Promise<string> {
    return this.bitcoindClient.getBlockHeader(hash, false);
  }

  async $getBlock(hash: string): Promise<IPublicApi.Block> {
    const foundBlock = blocks.getBlocks().find((block) => block.id === hash);
    if (foundBlock) {
      return foundBlock;
    }

    return this.bitcoindClient.getBlock(hash).then((block: IBitcoinApi.Block) => BitcoinApi.convertBlock(block));
  }

  $getAddress(address: string): Promise<IPublicApi.Address> {
    throw new Error('Method getAddress not supported by the Bitcoin RPC API.');
  }

  $getAddressTransactions(address: string, lastSeenTxId: string): Promise<IPublicApi.VerboseTransaction[]> {
    throw new Error('Method getAddressTransactions not supported by the Bitcoin RPC API.');
  }

  $getAddressMempoolTransactions(address: string): Promise<IPublicApi.VerboseTransaction[]> {
    throw new Error('Method getAddressMempoolTransactions not supported by the Bitcoin RPC API.');
  }

  $getAddressUtxos(address: string): Promise<IPublicApi.UTXO[]> {
    throw new Error('Method getAddressUtxos not supported by the Bitcoin RPC API.');
  }

  $getScriptHash(scripthash: string): Promise<IPublicApi.ScriptHash> {
    throw new Error('Method getScriptHash not supported by the Bitcoin RPC API.');
  }

  $getScriptHashTransactions(scripthash: string, lastSeenTxId: string): Promise<IPublicApi.VerboseTransaction[]> {
    throw new Error('Method getScriptHashTransactions not supported by the Bitcoin RPC API.');
  }

  $getScriptHashUtxos(scripthash: string): Promise<IPublicApi.UTXO[]> {
    throw new Error('Method getScriptHashUtxos not supported by the Bitcoin RPC API.');
  }

  $getScriptHashMempoolTransactions(scripthash: string): Promise<IPublicApi.VerboseTransaction[]> {
    throw new Error('Method getScriptHashMempoolTransactions not supported by the Bitcoin RPC API.');
  }

  $getOutspend(txId: string, vout: number): Promise<IPublicApi.DetailedOutspend> {
    throw new Error('Method getScriptHashMempoolTransactions not supported by the Bitcoin RPC API.');
  }

  $getRawMempool(): Promise<IPublicApi.Transaction['txid'][]> {
    return this.bitcoindClient.getRawMemPool();
  }

  $getAddressPrefix(prefix: string): string[] {
    const found: { [address: string]: string } = {};
    const mp = mempool.getMempool();
    for (const tx in mp) {
      for (const vout of mp[tx].vout) {
        if (vout.scriptpubkey_address?.indexOf(prefix) === 0) {
          found[vout.scriptpubkey_address] = '';
          if (Object.keys(found).length >= 10) {
            return Object.keys(found);
          }
        }
      }
      for (const vin of mp[tx].vin) {
        if (vin.prevout?.scriptpubkey_address?.indexOf(prefix) === 0) {
          found[vin.prevout?.scriptpubkey_address] = '';
          if (Object.keys(found).length >= 10) {
            return Object.keys(found);
          }
        }
      }
    }
    return Object.keys(found);
  }

  $sendRawTransaction(rawTransaction: string): Promise<string> {
    return this.bitcoindClient.sendRawTransaction(rawTransaction);
  }

  async $testMempoolAccept(rawTransactions: string[], allowhighfees = false): Promise<TestMempoolAcceptResult[]> {
    if (rawTransactions.length) {
      return this.bitcoindClient.testMempoolAccept(rawTransactions, allowhighfees);
    } else {
      return [];
    }
  }

  // BCHN doesn't have this
  $submitPackage(rawTransactions: string[], allowhighfees = false): Promise<SubmitPackageResult> {
    return this.bitcoindClient.submitPackage(rawTransactions, allowhighfees);
  }

  async $getOutspends(txId: string): Promise<IPublicApi.Outspend[]> {
    const outSpends: IPublicApi.Outspend[] = [];
    const tx = (await this.$getRawTransaction(txId, false, false)) as IPublicApi.Transaction;
    for (let i = 0; i < tx.vout.length; i++) {
      if (tx.status && tx.status.block_height === 0) {
        outSpends.push({
          spent: false,
        });
      } else {
        const txOut = await this.bitcoindClient.getTxOut(txId, i);
        outSpends.push({
          spent: txOut === null,
        });
      }
    }
    return outSpends;
  }

  async $getBatchedOutspends(txId: string[]): Promise<IPublicApi.Outspend[][]> {
    const outspends: IPublicApi.Outspend[][] = [];
    for (const tx of txId) {
      const outspend = await this.$getOutspends(tx);
      outspends.push(outspend);
    }
    return outspends;
  }

  async $getBatchedOutspendsInternal(txId: string[]): Promise<IPublicApi.Outspend[][]> {
    return this.$getBatchedOutspends(txId);
  }

  async $getOutSpendsByOutpoint(outpoints: { txid: string; vout: number }[]): Promise<IPublicApi.Outspend[]> {
    const outspends: IPublicApi.Outspend[] = [];
    for (const outpoint of outpoints) {
      const outspend = await this.$getOutspend(outpoint.txid, outpoint.vout);
      outspends.push(outspend);
    }
    return outspends;
  }

  async $getCoinbaseTx(blockhash: string): Promise<IPublicApi.VerboseTransaction> {
    const txids = await this.$getTxIdsForBlock(blockhash);
    return this.$getRawTransaction(txids[0]) as Promise<IPublicApi.VerboseTransaction>;
  }

  async $getAddressTransactionSummary(address: string): Promise<IPublicApi.AddressTxSummary[]> {
    throw new Error('Method getAddressTransactionSummary not supported by the Bitcoin RPC API.');
  }

  $getEstimatedHashrate(blockHeight: number): Promise<number> {
    // 120 is the default block span in Core
    return this.bitcoindClient.getNetworkHashPs(120, blockHeight);
  }

  protected async $convertTransaction(
    transaction: IBitcoinApi.VerboseTransaction,
    addPrevout: boolean,
    lazyPrevouts = false,
    allowMissingPrevouts = false
  ): Promise<IPublicApi.VerboseTransaction> {
    let publicTransaction: IPublicApi.VerboseTransaction = {
      txid: transaction.txid,
      version: transaction.version,
      locktime: transaction.locktime,
      size: transaction.size,
      fee: 0,
      vin: [],
      vout: [],
      status: { confirmed: false },
    };

    publicTransaction.vin = transaction.vin.map(
      (vin): IPublicApi.VerboseVin => ({
        txid: vin.txid || '',
        vout: vin.vout || 0,
        value: vin.value ? Math.round(vin.value * 100000000) : null,
        is_coinbase: !!vin.coinbase,
        prevout: null,
        scriptsig: (vin.scriptSig && vin.scriptSig.hex) || vin.coinbase || '',
        scriptsig_asm: vin.scriptSig
          ? transactionUtils.convertScriptSigAsm(vin.scriptSig.hex)
          : vin.coinbase
            ? transactionUtils.convertScriptSigAsm(vin.coinbase)
            : '',
        inner_redeemscript_asm: vin.scriptSig?.redeemScript ? vin.scriptSig.redeemScript.asm : '',
        scriptsig_byte_code_pattern: vin.scriptSig?.byteCodePattern?.pattern || '',
        scriptsig_byte_code: vin.scriptSig?.byteCodePattern?.data || [],
        scriptpubkey: (vin.scriptPubKey && vin.scriptPubKey.hex) || '',
        scriptpubkey_address: vin.scriptPubKey && vin.scriptPubKey.address ? vin.scriptPubKey.address : '',
        scriptpubkey_asm: vin.scriptPubKey?.asm ? transactionUtils.convertScriptSigAsm(vin.scriptPubKey.hex) : '', // TODO: Why would you call convertScriptSigAsm, if you already have the asm?
        scriptpubkey_type: vin.scriptPubKey ? this.translateScriptPubKeyType(vin.scriptPubKey.type) : '',
        scriptpubkey_byte_code_pattern: vin.scriptPubKey?.byteCodePattern?.pattern || '',
        scriptpubkey_byte_code: vin.scriptPubKey?.byteCodePattern?.data || [],
        sequence: vin.sequence,
        ...(vin.tokenData?.category !== undefined && { token_category: vin.tokenData.category }),
        ...(vin.tokenData?.amount !== undefined && { token_amount: vin.tokenData.amount }),
        ...(vin.tokenData?.nft?.capability !== undefined && { token_nft_capability: vin.tokenData.nft.capability }),
        ...(vin.tokenData?.nft?.commitment !== undefined && { token_nft_commitment: vin.tokenData.nft.commitment }),
      })
    );

    publicTransaction.vout = transaction.vout.map(
      (vout): IPublicApi.VerboseVout => ({
        value: Math.round(vout.value * 100000000),
        scriptpubkey: vout.scriptPubKey.hex,
        scriptpubkey_address: vout.scriptPubKey && vout.scriptPubKey.addresses ? vout.scriptPubKey.addresses[0] : '',
        scriptpubkey_asm: vout.scriptPubKey.asm ? transactionUtils.convertScriptSigAsm(vout.scriptPubKey.hex) : '', // TODO: Why would you call convertScriptSigAsm, if you already have the asm?
        scriptpubkey_type: this.translateScriptPubKeyType(vout.scriptPubKey.type),
        scriptpubkey_byte_code_pattern: vout.scriptPubKey?.byteCodePattern?.pattern || '',
        scriptpubkey_byte_code: vout.scriptPubKey?.byteCodePattern?.data || [],
        ...(vout.tokenData?.category !== undefined && { token_category: vout.tokenData.category }),
        ...(vout.tokenData?.amount !== undefined && { token_amount: vout.tokenData.amount }),
        ...(vout.tokenData?.nft?.capability !== undefined && { token_nft_capability: vout.tokenData.nft.capability }),
        ...(vout.tokenData?.nft?.commitment !== undefined && { token_nft_commitment: vout.tokenData.nft.commitment }),
      })
    );

    if (transaction.confirmations) {
      publicTransaction.status = {
        confirmed: true,
        block_height: blocks.getCurrentBlockHeight() - transaction.confirmations + 1,
        block_hash: transaction.blockhash,
        block_time: transaction.blocktime,
      };
    }

    if (addPrevout) {
      try {
        publicTransaction = await this.$calculateFeeFromInputs(publicTransaction, false, lazyPrevouts);
      } catch (e) {
        if (!allowMissingPrevouts) {
          throw e;
        }
      }
    } else if (!transaction.confirmations) {
      publicTransaction = await this.$appendMempoolFeeData(publicTransaction);
    }

    return publicTransaction;
  }

  private translateScriptPubKeyType(outputType: string): string {
    const map = {
      pubkey: 'p2pk',
      pubkeyhash: 'p2pkh',
      scripthash: 'p2sh',
      script: 'p2s', // pay-to-script (new since May 2026 upgrade)
      nonstandard: 'nonstandard',
      multisig: 'multisig',
      anchor: 'anchor',
      nulldata: 'op_return',
    };

    if (map[outputType]) {
      return map[outputType];
    } else {
      return 'unknown';
    }
  }

  private async $appendMempoolFeeData(
    transaction: IPublicApi.VerboseTransaction
  ): Promise<IPublicApi.VerboseTransaction> {
    if (transaction.fee) {
      return transaction;
    }
    let mempoolEntry: IBitcoinApi.MempoolEntry;
    if (!mempool.isInSync() && !this.rawMempoolCache) {
      this.rawMempoolCache = await this.$getRawMempoolVerbose();
    }
    if (this.rawMempoolCache && this.rawMempoolCache[transaction.txid]) {
      mempoolEntry = this.rawMempoolCache[transaction.txid];
    } else {
      mempoolEntry = await this.$getMempoolEntry(transaction.txid);
    }
    transaction.fee = Math.round(mempoolEntry.fees.base * 100000000);
    return transaction;
  }

  protected async $addPrevouts(transaction: VerboseTransactionExtended): Promise<VerboseTransactionExtended> {
    let addedPrevouts = false;
    for (const vin of transaction.vin) {
      if (vin.prevout) {
        continue;
      }
      const innerTx = (await this.$getRawTransaction(vin.txid, false, false)) as IPublicApi.VerboseTransaction;
      vin.prevout = innerTx.vout[vin.vout];
      transactionUtils.addInnerScriptsToVin(vin);
      addedPrevouts = true;
    }
    if (addedPrevouts) {
      // re-calculate transaction flags now that we have full prevout data
      transaction.flags = undefined; // clear existing flags to force full classification
      transaction.flags = Common.getTransactionFlags(
        transaction,
        transaction.status?.block_height ?? blocks.getCurrentBlockHeight()
      );
    }
    return transaction;
  }

  protected $returnCoinbaseTransaction(): Promise<IPublicApi.VerboseTransaction> {
    return this.bitcoindClient.getBlockHash(0).then((hash: string) =>
      // This is using the convertTransaction with requires verbosity 2 + patterns
      this.bitcoindClient.getBlock(hash, 2, true).then((block: IBitcoinApi.VerboseBlock) => {
        return this.$convertTransaction(
          Object.assign(block.tx[0], {
            confirmations: blocks.getCurrentBlockHeight() + 1,
            blocktime: block.time,
          }),
          false
        );
      })
    );
  }

  private $getMempoolEntry(txid: string): Promise<IBitcoinApi.MempoolEntry> {
    return this.bitcoindClient.getMempoolEntry(txid);
  }

  private $getRawMempoolVerbose(): Promise<IBitcoinApi.RawMempool> {
    return this.bitcoindClient.getRawMemPool(true);
  }

  private async $calculateFeeFromInputs(
    transaction: IPublicApi.VerboseTransaction,
    addPrevout: boolean,
    lazyPrevouts: boolean
  ): Promise<IPublicApi.VerboseTransaction> {
    if (transaction.vin[0].is_coinbase) {
      transaction.fee = 0;
      return transaction;
    }
    let totalIn = 0;

    for (let i = 0; i < transaction.vin.length; i++) {
      if (lazyPrevouts && i > 12) {
        transaction.vin[i].lazy = true;
        continue;
      }
      const innerTx = (await this.$getRawTransaction(
        transaction.vin[i].txid,
        false,
        false
      )) as IPublicApi.VerboseTransaction;
      transaction.vin[i].prevout = innerTx.vout[transaction.vin[i].vout];
      transactionUtils.addInnerScriptsToVin(transaction.vin[i]);
      totalIn += innerTx.vout[transaction.vin[i].vout].value;
    }
    if (lazyPrevouts && transaction.vin.length > 12) {
      transaction.fee = -1;
    } else {
      const totalOut = transaction.vout.reduce((p, output) => p + output.value, 0);
      transaction.fee = parseFloat((totalIn - totalOut).toFixed(8));
    }
    return transaction;
  }

  public startHealthChecks(): void {}

  public getHealthStatus() {
    return [];
  }
}

export default BitcoinApi;
