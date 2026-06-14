export interface Filter {
  key: string;
  label: string;
  flag: bigint;
  toggle?: string;
  group?: string;
  important?: boolean;
  tooltip?: boolean;
  txPage?: boolean;
}

export type FilterMode = 'and' | 'or' | 'nor';

export type GradientMode = 'fee' | 'age';

export interface ActiveFilter {
  mode: FilterMode;
  filters: string[];
  gradient: GradientMode;
}

// binary flags for transaction classification
export const TransactionFlags = {
  // features
  v1: 0b00000100n,
  v2: 0b00001000n,
  // v3: 0b00010000n, // Currently BCH has not yet transaction v3
  nonstandard: 0b00100000n,
  // address types
  p2pk: 0b00000001_00000000n,
  p2ms: 0b00000010_00000000n,
  p2pkh: 0b00000100_00000000n,
  p2sh: 0b00001000_00000000n,
  p2s: 0b00010000_00000000n, // pay-to-script (new since May 2026 upgrade)
  // behavior, BCH doesn't have behaviors
  // data
  op_return: 0b00000001_00000000_00000000_00000000n,
  fake_pubkey: 0b00000010_00000000_00000000_00000000n,
  inscription: 0b00000100_00000000_00000000_00000000n, // related to witness, not used by BCH
  fake_scripthash: 0b00001000_00000000_00000000_00000000n,
  annex: 0b00010000_00000000_00000000_00000000n, // related to witness, not used by BCH
  // heuristics
  coinjoin: 0b00000001_00000000_00000000_00000000_00000000n,
  consolidation: 0b00000010_00000000_00000000_00000000_00000000n,
  batch_payout: 0b00000100_00000000_00000000_00000000_00000000n,
  // sighash
  sighash_all: 0b00000001_00000000_00000000_00000000_00000000_00000000n,
  sighash_none: 0b00000010_00000000_00000000_00000000_00000000_00000000n,
  sighash_single: 0b00000100_00000000_00000000_00000000_00000000_00000000n,
  sighash_utxos: 0b00001000_00000000_00000000_00000000_00000000_00000000n,
  sighash_acp: 0b00010000_00000000_00000000_00000000_00000000_00000000n, // Also known as "anyone can pay"
};

export function toFlags(filters: string[]): bigint {
  let flag = 0n;
  for (const filter of filters) {
    flag |= TransactionFlags[filter];
  }
  return flag;
}

export function toFilters(flags: bigint): Filter[] {
  const filters = [];
  for (const filter of Object.values(TransactionFilters).filter(
    (f) => f !== undefined
  )) {
    if (flags & filter.flag) {
      filters.push(filter);
    }
  }
  return filters;
}

export const TransactionFilters: { [key: string]: Filter } = {
  /* features, BCH by default has no RBF, so no need to have an option to switch between rbf/no_rbf */
  v1: {
    key: 'v1',
    label: 'Version 1',
    flag: TransactionFlags.v1,
    toggle: 'version',
    tooltip: true,
    txPage: false,
  },
  v2: {
    key: 'v2',
    label: 'Version 2',
    flag: TransactionFlags.v2,
    toggle: 'version',
    tooltip: true,
    txPage: false,
  },
  /*v3: {
    key: 'v3',
    label: 'Version 3',
    flag: TransactionFlags.v3,
    toggle: 'version',
    tooltip: true,
    txPage: false,
  },*/
  nonstandard: {
    key: 'nonstandard',
    label: 'Non-Standard',
    flag: TransactionFlags.nonstandard,
    important: true,
    tooltip: true,
    txPage: true,
  },
  /* address types */
  p2pk: {
    key: 'p2pk',
    label: 'P2PK',
    flag: TransactionFlags.p2pk,
    important: true,
    tooltip: true,
    txPage: true,
  },
  p2ms: {
    key: 'p2ms',
    label: 'Bare multisig',
    flag: TransactionFlags.p2ms,
    important: true,
    tooltip: true,
    txPage: true,
  },
  p2pkh: {
    key: 'p2pkh',
    label: 'P2PKH',
    flag: TransactionFlags.p2pkh,
    important: true,
    tooltip: false,
  },
  p2sh: {
    key: 'p2sh',
    label: 'P2SH',
    flag: TransactionFlags.p2sh,
    important: true,
    tooltip: false,
  },
  p2s: {
    key: 'p2s',
    label: 'P2S',
    flag: TransactionFlags.p2s,
    important: true,
    tooltip: false,
  },
  /* behavior (in BTC this would be cpfp, cpfp_hold, replacement, acceleration, with their appropriate flags) */
  /* BCH doesn't have all of these */
  /* data */
  op_return: {
    key: 'op_return',
    label: 'OP_RETURN',
    flag: TransactionFlags.op_return,
    important: true,
    tooltip: true,
    txPage: true,
  },
  fake_pubkey: {
    key: 'fake_pubkey',
    label: 'Fake pubkey',
    flag: TransactionFlags.fake_pubkey,
    tooltip: true,
    txPage: true,
  },
  fake_scripthash: {
    key: 'fake_scripthash',
    label: 'Fake scripthash',
    flag: TransactionFlags.fake_scripthash,
    tooltip: true,
    txPage: true,
  },
  /* heuristics */
  coinjoin: {
    key: 'coinjoin',
    label: $localize`Coinjoin`,
    flag: TransactionFlags.coinjoin,
    important: true,
    tooltip: true,
    txPage: true,
  },
  consolidation: {
    key: 'consolidation',
    label: $localize`Consolidation`,
    flag: TransactionFlags.consolidation,
    tooltip: true,
    txPage: true,
  },
  batch_payout: {
    key: 'batch_payout',
    label: $localize`Batch payment`,
    flag: TransactionFlags.batch_payout,
    tooltip: true,
    txPage: true,
  },
  /* sighash */
  sighash_all: {
    key: 'sighash_all',
    label: 'sighash_all',
    flag: TransactionFlags.sighash_all,
  },
  sighash_none: {
    key: 'sighash_none',
    label: 'sighash_none',
    flag: TransactionFlags.sighash_none,
    tooltip: true,
  },
  sighash_single: {
    key: 'sighash_single',
    label: 'sighash_single',
    flag: TransactionFlags.sighash_single,
    tooltip: true,
  },
  sighash_utxos: {
    key: 'sighash_utxos',
    label: 'sighash_utxos',
    flag: TransactionFlags.sighash_utxos,
  },
  sighash_acp: {
    key: 'sighash_acp',
    label: 'sighash_anyonecanpay',
    flag: TransactionFlags.sighash_acp,
    tooltip: true,
  },
};

export const FilterGroups: { label: string; filters: Filter[] }[] = [
  {
    label: $localize`:@@885666551418fd59011ceb09d5c481095940193b:Features`,
    filters: ['v1', 'v2', 'nonstandard'], // 'v3',
  },
  {
    label: $localize`Address Types`,
    filters: ['p2pk', 'p2ms', 'p2pkh', 'p2sh', 'p2s'],
  },
  // {
  //   label: $localize`Behavior`,
  //   filters: [], // Like replacement or acceleration, but BCH doesn't have those.
  // },
  {
    label: $localize`Data`,
    filters: ['op_return', 'fake_pubkey', 'fake_scripthash'],
  },
  {
    label: $localize`Heuristics`,
    filters: ['coinjoin', 'consolidation', 'batch_payout'],
  },
  {
    label: $localize`Sighash Flags`,
    filters: [
      'sighash_all',
      'sighash_none',
      'sighash_single',
      'sighash_utxos',
      'sighash_acp',
    ],
  },
].map((group) => ({
  label: group.label,
  filters: group.filters
    .map((filter) => TransactionFilters[filter] || null)
    .filter((f) => f != null),
}));
