import { SubmitPackageResult, TestMempoolAcceptResult } from './bitcoin-api.interface';
import { IPublicApi } from './public-api.interface';
import { IBitcoinApi } from './bitcoin-api.interface';

export interface AbstractBitcoinApi {
  $getRawMempool(): Promise<IPublicApi.Transaction['txid'][]>;
  $getRawTransaction(
    txId: string,
    skipConversion?: boolean,
    addPrevout?: boolean,
    lazyPrevouts?: boolean
  ): Promise<IPublicApi.VerboseTransaction | IBitcoinApi.VerboseTransaction>;
  $getRawTransactions(txids: string[]): Promise<IPublicApi.VerboseTransaction[]>;
  $getMempoolTransactions(txids: string[]): Promise<IPublicApi.Transaction[]>;
  $getAllMempoolTransactions(lastTxid?: string, max_txs?: number);
  $getTransactionHex(txId: string): Promise<string>;
  $getTransactionMerkleProof(txId: string): Promise<IPublicApi.MerkleProof>;
  $getBlockHeightTip(): Promise<number>;
  $getBlockHashTip(): Promise<string>;
  $getTxIdsForBlock(hash: string, fallbackToCore?: boolean): Promise<string[]>;
  $getTxsForBlock(hash: string, fallbackToCore?: boolean): Promise<IPublicApi.VerboseTransaction[]>;
  $getBlockHash(height: number): Promise<string>;
  $getBlockHeader(hash: string): Promise<string>;
  $getBlock(hash: string): Promise<IPublicApi.Block>;
  $getRawBlock(hash: string): Promise<Buffer>;
  $getAddress(address: string): Promise<IPublicApi.Address>;
  $getAddressTransactions(address: string, lastSeenTxId: string): Promise<IPublicApi.VerboseTransaction[]>;
  $getAddressMempoolTransactions(address: string): Promise<IPublicApi.VerboseTransaction[]>;
  $getAddressUtxos(address: string): Promise<IPublicApi.UTXO[]>;
  $getAddressPrefix(prefix: string): string[];
  $getScriptHash(scripthash: string): Promise<IPublicApi.ScriptHash>;
  $getScriptHashTransactions(address: string, lastSeenTxId: string): Promise<IPublicApi.VerboseTransaction[]>;
  $getScriptHashUtxos(scripthash: string): Promise<IPublicApi.UTXO[]>;
  $getScriptHashMempoolTransactions(scripthash: string): Promise<IPublicApi.VerboseTransaction[]>;
  $sendRawTransaction(rawTransaction: string): Promise<string>;
  $testMempoolAccept(rawTransactions: string[], allowhighfees?: boolean): Promise<TestMempoolAcceptResult[]>;
  $submitPackage(rawTransactions: string[], allowhighfees?: boolean): Promise<SubmitPackageResult>;
  $getOutspend(txId: string, vout: number): Promise<IPublicApi.DetailedOutspend>;
  $getOutspends(txId: string): Promise<IPublicApi.Outspend[]>;
  $getBatchedOutspends(txId: string[]): Promise<IPublicApi.Outspend[][]>;
  $getBatchedOutspendsInternal(txId: string[]): Promise<IPublicApi.Outspend[][]>;
  $getOutSpendsByOutpoint(outpoints: { txid: string; vout: number }[]): Promise<IPublicApi.Outspend[]>;
  $getCoinbaseTx(blockhash: string): Promise<IPublicApi.VerboseTransaction>;
  $getAddressTransactionSummary(address: string): Promise<IPublicApi.AddressTxSummary[]>;

  startHealthChecks(): void;
  getHealthStatus(): HealthCheckHost[];
}
export interface BitcoinRpcCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  timeout: number;
  cookie?: string;
}

export interface HealthCheckHost {
  host: string;
  active: boolean;
  rtt: number;
  latestHeight: number;
  socket: boolean;
  outOfSync: boolean;
  unreachable: boolean;
  checked: boolean;
  lastChecked: number;
}
