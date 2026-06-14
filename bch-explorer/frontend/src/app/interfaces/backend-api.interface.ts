import { Price } from '@app/services/price.service';

export interface Transaction {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  fee: number;
  vin: Vin[];
  vout: Vout[];
  status: Status;

  // Custom properties
  firstSeen?: number;
  feePerSize?: number;
  ancestors?: Ancestor[];
  descendants?: Ancestor[];
  feeDelta?: number;
  deleteAfter?: number;
  _unblinded?: any;
  _deduced?: boolean;
  _outspends?: Outspend[];
  price?: Price;
  sigops?: number;
  flags?: bigint;
  largeInput?: boolean;
  largeOutput?: boolean;
}

// TODO: Verbose Transactions still needs to be implemented,
// but we at least have the interface definitions in place.
export interface VerboseTransaction {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  fee: number;
  sigops?: number;
  vin: VerboseVin[];
  vout: VerboseVout[];
  status: Status;
  hex?: string;
}

interface Ancestor {
  txid: string;
  size: number;
  fee: number;
}

export interface Recent {
  txid: string;
  fee: number;
  size: number;
  value: number;
  rate: number;
  time: number;
}

export interface Vin {
  txid: string;
  vout: number;
  value: number | null;
  is_coinbase: boolean;
  scriptsig: string; // in hex
  scriptsig_asm: string; // in asm
  inner_redeemscript_asm: string;
  scriptsig_byte_code: string[]; // script data in hex
  scriptpubkey_byte_code_pattern: string; // in hex
  token_category?: string;
  token_amount?: string;
  token_nft_capability?: string;
  token_nft_commitment?: string; // in hex
  sequence: any;
  prevout: Vout | null;
  // Custom
  lazy?: boolean;
}

export interface Vout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  token_category?: string;
  token_amount?: string;
  token_nft_capability?: string;
  token_nft_commitment?: string; // in hex
  value: number;
}

export interface VerboseVin {
  txid: string;
  vout: number;
  value: number | null;
  is_coinbase: boolean;
  scriptsig: string; // in hex
  scriptsig_asm: string; // in asm
  inner_redeemscript_asm: string;
  scriptsig_byte_code_pattern: string; // in hex
  scriptsig_byte_code: string[]; // script data in hex
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_byte_code_pattern: string; // in hex
  scriptpubkey_byte_code: string[]; // script data in hex
  scriptpubkey_address?: string;
  token_category?: string;
  token_amount?: string;
  token_nft_capability?: string;
  token_nft_commitment?: string; // in hex
  sequence: any;
  prevout: Vout | null;
  // Custom
  lazy?: boolean;
}

export interface VerboseVout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  scriptpubkey_byte_code_pattern: string; // in hex
  scriptpubkey_byte_code: string[]; // script data in hex
  token_category?: string;
  token_amount?: string;
  token_nft_capability?: string;
  token_nft_commitment?: string; // in hex
  value: number;
}

export interface Status {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface BlockAblaState {
  block_size: number;
  block_size_limit: number;
  next_block_size_limit: number;
}

export interface Block {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  mediantime: number;
  bits: number;
  nonce: number;
  difficulty: number;
  merkle_root: string;
  tx_count: number;
  size: number;
  previousblockhash: string;
  stale?: boolean;
  canonical?: string;
  abla_state?: BlockAblaState;
}

export interface Address {
  electrum?: boolean;
  address: string;
  chain_stats: ChainStats;
  mempool_stats: MempoolStats;
  is_pubkey?: boolean;
}

export interface ScriptHash {
  electrum?: boolean;
  scripthash: string;
  chain_stats: ChainStats;
  mempool_stats: MempoolStats;
}

export interface AddressOrScriptHash {
  electrum?: boolean;
  address?: string;
  scripthash?: string;
  chain_stats: ChainStats;
  mempool_stats: MempoolStats;
}

export interface AddressTxSummary {
  txid: string;
  value: number;
  height: number;
  time: number;
  price?: number;
  tx_position?: number;
}

export interface ChainStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface MempoolStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface Outspend {
  spent: boolean;
  status?: Status;
}

export interface DetailedOutspend {
  spent: boolean;
  txid?: string;
  vin?: number;
  status?: Status;
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: Status;
}
