export namespace IPublicApi {
  export interface Transaction {
    txid: string;
    version: number;
    locktime: number;
    size: number;
    fee: number;
    sigops?: number;
    vin: Vin[];
    vout: Vout[];
    status: Status;
    // TODO: Also add blockhash, confirmations, time and blocktime.. No need for this status object
    hex?: string;
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
    // TODO: Also add blockhash, confirmations, time and blocktime.. No need for this status object
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
    token_nft_capability?: string; // "none", "mutable", "minting"
    token_nft_commitment?: string; // in hex
    sequence: any;
    prevout: Vout | null;
    // Custom
    lazy?: boolean;
  }

  export interface Vout {
    scriptpubkey: string; // in hex
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    token_category?: string;
    token_amount?: string;
    token_nft_capability?: string; // "none", "mutable", "minting"
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
    scriptpubkey: string; // in hex
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_byte_code_pattern: string; // in hex
    scriptpubkey_byte_code: string[]; // script data in hex
    scriptpubkey_address?: string;
    token_category?: string;
    token_amount?: string;
    token_nft_capability?: string; // "none", "mutable", "minting"
    token_nft_commitment?: string; // in hex
    sequence: any;
    prevout: VerboseVout | null;
    // Custom
    lazy?: boolean;
  }

  export interface VerboseVout {
    scriptpubkey: string; // in hex
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    scriptpubkey_byte_code_pattern: string; // in hex
    scriptpubkey_byte_code: string[]; // script data in hex
    token_category?: string;
    token_amount?: string;
    token_nft_capability?: string; // "none", "mutable", "minting"
    token_nft_commitment?: string; // in hex
    value: number;
  }

  export interface Status {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  }

  export interface AblaState {
    block_size: number;
    block_size_limit: number;
    next_block_size_limit: number;
  }

  export interface Block {
    id: string;
    height: number;
    version: number;
    timestamp: number;
    bits: number;
    nonce: number;
    difficulty: number;
    merkle_root: string;
    tx_count: number;
    size: number;
    previousblockhash: string;
    mediantime: number;
    stale: boolean;
    abla_state?: AblaState;
  }

  export interface Address {
    address: string;
    chain_stats: ChainStats;
    mempool_stats: MempoolStats;
    electrum?: boolean;
  }

  export interface ScriptHash {
    scripthash: string;
    chain_stats: ChainStats;
    mempool_stats: MempoolStats;
    electrum?: boolean;
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

  export interface AddressTxSummary {
    txid: string;
    value: number;
    height: number;
    time: number;
    tx_position?: number;
  }

  export interface MerkleProof {
    merkle: string[];
    block_height: number;
    pos: number;
  }

  export interface UTXO {
    txid: string;
    vout: number;
    status: {
      confirmed: boolean;
      block_height?: number;
      block_hash?: string;
      block_time?: number;
    };
    value: number;
  }
}
