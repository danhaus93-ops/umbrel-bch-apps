/**
 * Spec schema: https://cashtokens.org/bcmr-v2.schema.json
 *
 * We are only using the ChainSnapshot part of the schema.
 */

// URI mapping type for identity-related URIs
export interface URIs {
  [key: string]: string;
}

// Extensions type for additional metadata
export interface Extensions {
  [key: string]:
    | string
    | { [key: string]: string }
    | { [key: string]: { [key: string]: string } };
}

// Sources array interface
export interface SourceItem {
  bcmr: string;
  name: string;
  timestamp?: string;
  trust?: 'absent' | 'marginal' | 'good' | 'high' | 'ultimate';
}

export type Sources = SourceItem[];

// Genesis information interface
export interface Genesis {
  ft_minted?: string;
  is_nft: boolean;
  txid: string;
}

// Token information for chain's native currency
export interface ChainToken {
  symbol: string;
  decimals?: number;
  category?: string;
}

// ChainSnapshot interface based on the BCMR v2 schema
export interface BcmrMetadata {
  name: string;
  description?: string;
  extensions?: Extensions;
  genesis?: Genesis; // Used by Flowee
  sources?: Sources; // Used by Flowee
  status?: 'active' | 'burned' | 'inactive';
  token: ChainToken;
  uris?: URIs;
  is_nft?: boolean; // Only used by Paytaca API
  nft_type?: string; // Only used by Paytaca API
  trust?: 'absent' | 'marginal' | 'good' | 'high' | 'ultimate'; // Used by Flowee
}
