import { Request } from 'express';
import {
  FeeStats,
  MempoolBlockWithTransactions,
  VerboseTransactionExtended,
  TransactionStripped,
  WorkingFeeStats,
  TransactionClassified,
  TransactionFlags,
} from '../mempool.interfaces';
import config from '../config';
import { isIP } from 'net';
import transactionUtils from './transaction-utils';
import { isPoint } from '../utils/secp256k1';
import logger from '../logger';
import { getVarIntLength, opcodes, parseMultisigScript } from '../utils/bitcoin-script';
import { IPublicApi } from './bitcoin/public-api.interface';

// Bitcoin Cash Node default policy settings
const MAX_STANDARD_TX_SIZE = 32_000_000; // Max. tx size (actually min.) without ABLA taken into account
const MAX_BLOCK_SIGOPS_COST = 80_000;
const MAX_STANDARD_TX_SIGOPS_COST = MAX_BLOCK_SIGOPS_COST / 5;
const MAX_P2SH_SIGOPS = 15;
const MAX_STANDARD_SCRIPTSIG_SIZE = 1650;
const DUST_RELAY_TX_FEE = 3;
const DEFAULT_PERMIT_BAREMULTISIG = true;
const MAX_TX_LEGACY_SIGOPS = 20_000; // Before 2020-MAY-15 upgrade
const MAX_TX_BYTES = 1_000_000;
const MAX_SCRIPT_SIZE = 1650;
const VALID_VERSIONS = new Set([1, 2]);

export class Common {
  static median(numbers: number[]) {
    let medianNr = 0;
    const numsLen = numbers.length;
    if (numsLen % 2 === 0) {
      medianNr = (numbers[numsLen / 2 - 1] + numbers[numsLen / 2]) / 2;
    } else {
      medianNr = numbers[(numsLen - 1) / 2];
    }
    return medianNr;
  }

  static percentile(numbers: number[], percentile: number) {
    if (percentile === 50) {
      return this.median(numbers);
    }
    const index = Math.ceil(numbers.length * (100 - percentile) * 1e-2);
    if (index < 0 || index > numbers.length - 1) {
      return 0;
    }
    return numbers[index];
  }

  static getFeesInRange(transactions: VerboseTransactionExtended[], rangeLength: number) {
    const filtered: VerboseTransactionExtended[] = [];
    let lastValidRate = Infinity;
    // filter out anomalous fee rates to ensure monotonic range
    for (const tx of transactions) {
      if (tx.feePerSize <= lastValidRate) {
        filtered.push(tx);
        lastValidRate = tx.feePerSize;
      }
    }
    const arr = [filtered[filtered.length - 1].feePerSize];
    const chunk = 1 / (rangeLength - 1);
    let itemsToAdd = rangeLength - 2;

    while (itemsToAdd > 0) {
      arr.push(filtered[Math.floor(filtered.length * chunk * itemsToAdd)].feePerSize);
      itemsToAdd--;
    }

    arr.push(filtered[0].feePerSize);
    return arr;
  }

  /**
   * Validates most standardness rules
   *
   * returns true early if any standardness rule is violated, otherwise false
   * (except for non-mandatory-script-verify-flag and p2sh script evaluation rules which are *not* enforced)
   *
   * As standardness rules change, we'll need to apply the rules in force *at the time* to older blocks.
   * For now, just pull out individual rules into versioned functions where necessary.
   */
  static isNonStandard(tx: VerboseTransactionExtended, height?: number): boolean {
    // version
    if (this.isNonStandardVersion(tx, height)) {
      return true;
    }

    // tx-size
    if (tx.size > MAX_STANDARD_TX_SIZE) {
      return true;
    }

    // bad-txns-too-many-sigops
    if (tx.sigops && tx.sigops > MAX_STANDARD_TX_SIGOPS_COST) {
      return true;
    }

    // legacy sigops
    if (this.isNonStandardLegacySigops(tx, height)) {
      return true;
    }

    // input validation
    for (const vin of tx.vin) {
      if (vin.is_coinbase) {
        // standardness rules don't apply to coinbase transactions
        return false;
      }
      // scriptsig-size
      if (vin.scriptsig.length / 2 > MAX_STANDARD_SCRIPTSIG_SIZE) {
        return true;
      }
      // scriptsig-not-pushonly
      if (vin.scriptsig_asm?.length) {
        for (const op of vin.scriptsig_asm.split(' ')) {
          const opCode = parseInt(op, 16);
          if (!isNaN(opCode) && opcodes[opCode] && opcodes[opCode] > opcodes[81]) {
            return true;
          }
        }
      }
      // bad-txns-nonstandard-inputs
      if (vin.prevout?.scriptpubkey_type === 'p2sh') {
        // TODO: evaluate script (https://github.com/bitcoin/bitcoin/blob/1ac627c485a43e50a9a49baddce186ee3ad4daad/src/policy/policy.cpp#L177)
        // countScriptSigops returns the witness-scaled sigops, so divide by 4 before comparison with MAX_P2SH_SIGOPS
        const sigops = transactionUtils.countScriptSigops(vin.inner_redeemscript_asm) / 4;
        if (sigops > MAX_P2SH_SIGOPS) {
          return true;
        }
      } else if (['unknown', 'provably_unspendable', 'empty'].includes(vin.prevout?.scriptpubkey_type || '')) {
        return true;
      } else if (vin.prevout?.scriptpubkey_type === 'anchor' && this.isNonStandardAnchor(vin, height)) {
        return true;
      }
    }

    // output validation
    let opreturnCount = 0;
    let opreturnBytes = 0;
    for (const vout of tx.vout) {
      // scriptpubkey
      if (['nonstandard', 'provably_unspendable', 'empty'].includes(vout.scriptpubkey_type)) {
        // (non-standard output type)
        return true;
      } else if (vout.scriptpubkey_type === 'multisig') {
        if (!DEFAULT_PERMIT_BAREMULTISIG) {
          // bare-multisig
          return true;
        }
        const mOfN = parseMultisigScript(vout.scriptpubkey_asm);
        if (!mOfN || mOfN.n < 1 || mOfN.n > 3 || mOfN.m < 1 || mOfN.m > mOfN.n) {
          // (non-standard bare multisig threshold)
          return true;
        }
      } else if (vout.scriptpubkey_type === 'op_return') {
        opreturnCount++;
        opreturnBytes += vout.scriptpubkey.length / 2;
      }
      // dust
      // (we could probably hardcode this for the different output types...)
      if (vout.scriptpubkey_type !== 'op_return') {
        let dustSize = vout.scriptpubkey.length / 2;
        // add varint length overhead
        dustSize += getVarIntLength(dustSize);
        dustSize += 148;
        if (vout.value < DUST_RELAY_TX_FEE * dustSize) {
          // TODO: Update for BCH. BCH also doesn't have Ephemeral dust
        }
      }
    }

    // op_return
    if (opreturnCount > 0) {
      if (!this.isStandardOpReturn(opreturnBytes, opreturnCount, height)) {
        return true;
      }
    }

    // TODO: non-mandatory-script-verify-flag

    return false;
  }

  // Individual versioned standardness rules
  // TODO: Update for BCH.
  static V2_STANDARDNESS_ACTIVATION_HEIGHT = {
    testnet4: 209_919,
    chipnet: 209_919,
    scalenet: 209_919,
    '': 209_919,
  };
  static isNonStandardVersion(tx: VerboseTransactionExtended, height?: number): boolean {
    let TX_MAX_STANDARD_VERSION = 2;
    if (
      height != null &&
      this.V2_STANDARDNESS_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK] &&
      height <= this.V2_STANDARDNESS_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK]
    ) {
      TX_MAX_STANDARD_VERSION = 1;
    }

    if (tx.version > TX_MAX_STANDARD_VERSION) {
      return true;
    }
    return false;
  }

  // TODO: Update for BCH.
  static ANCHOR_STANDARDNESS_ACTIVATION_HEIGHT = {
    testnet4: 42_000,
    chipnet: 2_900_000,
    scalenet: 211_000,
    '': 863_500,
  };
  static isNonStandardAnchor(vin: IPublicApi.Vin, height?: number): boolean {
    if (
      height != null &&
      this.ANCHOR_STANDARDNESS_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK] &&
      height <= this.ANCHOR_STANDARDNESS_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK] &&
      vin.prevout?.scriptpubkey === '51024e73'
    ) {
      // anchor outputs were non-standard to spend before v28.x (scheduled for 2024/09/30 https://github.com/bitcoin/bitcoin/issues/29891)
      return true;
    }
    return false;
  }

  // OP_RETURN size & count limits were lifted in v28.3/v29.2/v30.0
  // TODO: Update for BCH.
  static OP_RETURN_STANDARDNESS_ACTIVATION_HEIGHT = {
    testnet4: 108_000,
    chipnet: 4_750_000,
    scalenet: 276_500,
    '': 921_000,
  };
  static MAX_DATACARRIER_BYTES = 83;
  static isStandardOpReturn(bytes: number, outputs: number, height?: number): boolean {
    if (
      height == null ||
      (this.OP_RETURN_STANDARDNESS_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK] &&
        height >= this.OP_RETURN_STANDARDNESS_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK]) || // limits lifted
      // OR
      (bytes <= this.MAX_DATACARRIER_BYTES && outputs <= 1) // below old limits
    ) {
      return true;
    }
    return false;
  }

  // Old SigOps limit removal (is now replaced by SigChecks)
  static LEGACY_SIGOPS_REMOVAL_ACTIVATION_HEIGHT = {
    testnet4: 63_5259,
    chipnet: 63_5259,
    scalenet: 63_5259,
    '': 63_5259,
  };
  static isNonStandardLegacySigops(tx: VerboseTransactionExtended, height?: number): boolean {
    if (
      height == null ||
      (this.LEGACY_SIGOPS_REMOVAL_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK] &&
        height <= this.LEGACY_SIGOPS_REMOVAL_ACTIVATION_HEIGHT[config.EXPLORER.NETWORK])
    ) {
      if (!transactionUtils.checkSigopsBIP54(tx, MAX_TX_LEGACY_SIGOPS)) {
        return true;
      }
    }
    return false;
  }

  static isBurnKey(pubkey: string): boolean {
    return [
      '022222222222222222222222222222222222222222222222222222222222222222',
      '033333333333333333333333333333333333333333333333333333333333333333',
      '020202020202020202020202020202020202020202020202020202020202020202',
      '030303030303030303030303030303030303030303030303030303030303030303',
    ].includes(pubkey);
  }

  static getTransactionFlags(tx: VerboseTransactionExtended, height?: number): number {
    let flags = tx.flags ? BigInt(tx.flags) : 0n;

    // Already processed static flags, no need to do it again
    if (tx.flags) {
      return Number(flags);
    }

    // Process static flags
    if (tx.version === 1) {
      flags |= TransactionFlags.v1;
    } else if (tx.version === 2) {
      flags |= TransactionFlags.v2;
    }
    // Currently not yet used in BCH
    //  else if (tx.version === 3) {
    //   flags |= TransactionFlags.v3;
    // }
    const reusedInputAddresses: { [address: string]: number } = {};
    const reusedOutputAddresses: { [address: string]: number } = {};
    const inValues: { [key: number]: number } = {};
    const outValues: { [key: number]: number } = {};
    for (const vin of tx.vin) {
      if (vin.prevout?.scriptpubkey_type) {
        // Only switch between BCH supported types
        switch (vin.prevout?.scriptpubkey_type) {
          case 'p2pk':
            flags |= TransactionFlags.p2pk;
            break;
          case 'multisig':
            flags |= TransactionFlags.p2ms;
            break;
          case 'p2pkh':
            flags |= TransactionFlags.p2pkh; // TODO: This is just only looking at the type (pubkeyhash), not the actual script
            break;
          case 'p2sh':
            flags |= TransactionFlags.p2sh;
            break;
          case 'p2s':
            flags |= TransactionFlags.p2s;
            break;
        }
      }

      // TODO: Filter on vin.scriptsig_byte_code_pattern instead of just the type.
      // - 76a95188ac === P2PKH
      // - a95187 === P2SH
      // - aa5187 === P2SH32
      // - ?????? === multisign

      // sighash flags
      // For now only look at p2pkh transactions (76a95188ac pattern)
      if (vin.scriptsig_byte_code.length > 0 && vin.scriptpubkey_byte_code_pattern === '76a95188ac') {
        flags |= this.setSighashFlags(flags, vin.scriptsig_byte_code[0]);
      }

      if (vin.prevout?.scriptpubkey_address) {
        reusedInputAddresses[vin.prevout?.scriptpubkey_address] =
          (reusedInputAddresses[vin.prevout?.scriptpubkey_address] || 0) + 1;
      }
      inValues[vin.prevout?.value || Math.random()] = (inValues[vin.prevout?.value || Math.random()] || 0) + 1;
    }
    let hasFakePubkey = false;
    for (const vout of tx.vout) {
      // Only switch between BCH supported types
      switch (vout.scriptpubkey_type) {
        case 'p2pk':
          {
            flags |= TransactionFlags.p2pk;
            // detect fake pubkey (i.e. not a valid DER point on the secp256k1 curve)
            hasFakePubkey = hasFakePubkey || !isPoint(vout.scriptpubkey?.slice(2, -2));
          }
          break;
        case 'multisig':
          {
            flags |= TransactionFlags.p2ms;
            // detect fake pubkeys (i.e. not valid DER points on the secp256k1 curve)
            const asm = vout.scriptpubkey_asm || transactionUtils.convertScriptSigAsm(vout.scriptpubkey);
            for (const key of asm?.split(' ') || []) {
              if (!hasFakePubkey && !key.startsWith('OP_')) {
                hasFakePubkey = hasFakePubkey || this.isBurnKey(key) || !isPoint(key);
              }
            }
          }
          break;
        case 'p2pkh':
          flags |= TransactionFlags.p2pkh;
          break;
        case 'p2sh':
          flags |= TransactionFlags.p2sh;
          break;
        case 'p2s':
          flags |= TransactionFlags.p2s;
          break;
        case 'op_return':
          flags |= TransactionFlags.op_return;
          break;
      }
      if (vout.scriptpubkey_address) {
        reusedOutputAddresses[vout.scriptpubkey_address] = (reusedOutputAddresses[vout.scriptpubkey_address] || 0) + 1;
      }
      outValues[vout.value || Math.random()] = (outValues[vout.value || Math.random()] || 0) + 1;
    }
    if (hasFakePubkey) {
      flags |= TransactionFlags.fake_pubkey;
    }

    // fast but bad heuristic to detect possible coinjoins
    // (at least 5 inputs and 5 outputs, less than half of which are unique amounts, with no address reuse)
    const addressReuse =
      Object.keys(reusedOutputAddresses).reduce(
        (acc, key) => Math.max(acc, (reusedInputAddresses[key] || 0) + (reusedOutputAddresses[key] || 0)),
        0
      ) > 1;
    if (
      !addressReuse &&
      tx.vin.length >= 5 &&
      tx.vout.length >= 5 &&
      Object.keys(inValues).length + Object.keys(outValues).length <= (tx.vin.length + tx.vout.length) / 2
    ) {
      flags |= TransactionFlags.coinjoin;
    }
    // more than 5:1 input:output ratio
    if (tx.vin.length / tx.vout.length >= 5) {
      flags |= TransactionFlags.consolidation;
    }
    // less than 1:5 input:output ratio
    if (tx.vin.length / tx.vout.length <= 0.2) {
      flags |= TransactionFlags.batch_payout;
    }

    if (this.isNonStandard(tx, height)) {
      flags |= TransactionFlags.nonstandard;
    }

    return Number(flags);
  }

  /**
   * Set sighash flags based on first data line (index 0) of the byteCodePattern data (hex string),
   * and then using the last 2 hex digits as the sighash byte. This is only valid for P2PKH UTXO.
   *
   * See spec: https://documentation.cash/protocol/blockchain/transaction/transaction-signing.html#bitcoin-cash-signatures
   * @param flags
   * @param byte_code_data
   * @returns
   */
  static setSighashFlags(flags: bigint, byte_code_data: string): bigint {
    const SIGHASH_ALL = 0x01;
    const SIGHASH_NONE = 0x02;
    const SIGHASH_SINGLE = 0x03;
    const SIGHASH_UTXOS = 0x20;
    const SIGHASH_ANYONECANPAY = 0x80;

    const sighashHex = byte_code_data.slice(-2); // 2 hex digits == 1 byte
    const sighash = parseInt(sighashHex, 16);

    // Extract the lower 2 bits
    const baseType = sighash & 0x03;
    switch (baseType) {
      case SIGHASH_ALL:
        flags |= TransactionFlags.sighash_all;
        break;
      case SIGHASH_NONE:
        flags |= TransactionFlags.sighash_none;
        break;
      case SIGHASH_SINGLE:
        flags |= TransactionFlags.sighash_single;
        break;
    }

    // Now we check on the modifiers (higher bits)
    if (sighash & SIGHASH_UTXOS) {
      flags |= TransactionFlags.sighash_utxos;
    }

    if (sighash & SIGHASH_ANYONECANPAY) {
      flags |= TransactionFlags.sighash_acp;
    }
    return flags;
  }

  static classifyTransaction(tx: VerboseTransactionExtended, height?: number): TransactionClassified {
    let flags = 0;
    try {
      flags = Common.getTransactionFlags(tx, height);
    } catch (e) {
      logger.warn('Failed to add classification flags to transaction: ' + (e instanceof Error ? e.message : e));
    }
    tx.flags = flags;
    return {
      ...Common.stripTransaction(tx),
      flags,
    };
  }

  static classifyTransactions(txs: VerboseTransactionExtended[], height?: number): TransactionClassified[] {
    return txs.map((tx) => Common.classifyTransaction(tx, height));
  }

  static stripTransaction(tx: VerboseTransactionExtended): TransactionStripped {
    return {
      txid: tx.txid,
      fee: tx.fee || 0,
      size: tx.size,
      value: tx.vout.reduce((acc, vout) => acc + (vout.value ? vout.value : 0), 0),
      rate: tx.feePerSize,
      time: tx.firstSeen || undefined,
    };
  }

  static stripTransactions(txs: VerboseTransactionExtended[]): TransactionStripped[] {
    return txs.map(Common.stripTransaction);
  }

  static sleep$(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }

  static shuffleArray(array: any[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // calculates the ratio of matched transactions to projected transactions by size
  static getSimilarity(
    projectedBlock: MempoolBlockWithTransactions,
    transactions: VerboseTransactionExtended[]
  ): number {
    let matchedSize = 0;
    let projectedSize = 0;
    const inBlock = {};

    for (const tx of transactions) {
      inBlock[tx.txid] = tx;
    }

    // look for transactions that were expected in the template, but missing from the mined block
    for (const tx of projectedBlock.transactions) {
      if (inBlock[tx.txid]) {
        matchedSize += tx.size;
      }
      projectedSize += tx.size;
    }

    projectedSize += transactions[0].size;
    matchedSize += transactions[0].size;

    return projectedSize ? matchedSize / projectedSize : 1;
  }

  static getSqlInterval(interval: string | null): string | null {
    switch (interval) {
      case '24h':
        return '1 DAY';
      case '3d':
        return '3 DAY';
      case '1w':
        return '1 WEEK';
      case '1m':
        return '1 MONTH';
      case '3m':
        return '3 MONTH';
      case '6m':
        return '6 MONTH';
      case '1y':
        return '1 YEAR';
      case '2y':
        return '2 YEAR';
      case '3y':
        return '3 YEAR';
      case '4y':
        return '4 YEAR';
      default:
        return null;
    }
  }

  static indexingEnabled(): boolean {
    return (
      ['mainnet', 'testnet4', 'chipnet', 'scalenet'].includes(config.EXPLORER.NETWORK) &&
      config.DATABASE.ENABLED === true &&
      config.EXPLORER.INDEXING_BLOCKS_AMOUNT !== 0
    );
  }

  static blocksSummariesIndexingEnabled(): boolean {
    return Common.indexingEnabled() && config.EXPLORER.BLOCKS_SUMMARIES_INDEXING === true;
  }

  static auditIndexingEnabled(): boolean {
    return Common.indexingEnabled() && config.EXPLORER.AUDIT === true;
  }

  static gogglesIndexingEnabled(): boolean {
    return Common.blocksSummariesIndexingEnabled() && config.EXPLORER.GOGGLES_INDEXING === true;
  }

  static setDateMidnight(date: Date): void {
    date.setUTCHours(0);
    date.setUTCMinutes(0);
    date.setUTCSeconds(0);
    date.setUTCMilliseconds(0);
  }

  static channelShortIdToIntegerId(channelId: string): string {
    if (channelId.indexOf('x') === -1) {
      // Already an integer id
      return channelId;
    }
    if (channelId.indexOf('/') !== -1) {
      // Topology import
      channelId = channelId.slice(0, -2);
    }
    const s = channelId.split('x').map((part) => BigInt(part));
    return ((s[0] << 40n) | (s[1] << 16n) | s[2]).toString();
  }

  /** Decodes a channel id returned by lnd as uint64 to a short channel id */
  static channelIntegerIdToShortId(id: string): string {
    if (id.indexOf('/') !== -1) {
      id = id.slice(0, -2);
    }

    if (id.indexOf('x') !== -1) {
      // Already a short id
      return id;
    }

    const n = BigInt(id);
    return [
      n >> 40n, // nth block
      (n >> 16n) & 0xffffffn, // nth tx of the block
      n & 0xffffn, // nth output of the tx
    ].join('x');
  }

  static utcDateToMysql(date?: number | null): string | null {
    if (date === null) {
      return null;
    }
    const d = new Date((date || 0) * 1000);
    return d.toISOString().split('T')[0] + ' ' + d.toTimeString().split(' ')[0];
  }

  static findSocketNetwork(addr: string): {
    network: string | null;
    url: string;
  } {
    if (!addr?.length) {
      return {
        network: null,
        url: '',
      };
    }

    let network: string | null = null;
    let url: string = addr;

    if (!url?.length) {
      return {
        network: null,
        url: addr,
      };
    }

    if (addr.indexOf('onion') !== -1) {
      if (url.split('.')[0].length >= 56) {
        network = 'torv3';
      } else {
        network = 'torv2';
      }
    } else if (addr.indexOf('i2p') !== -1) {
      network = 'i2p';
    } else if (addr.indexOf('ipv4') !== -1) {
      const ipv = isIP(url.split(':')[0]);
      if (ipv === 4) {
        network = 'ipv4';
      } else {
        return {
          network: null,
          url: addr,
        };
      }
    } else if (addr.indexOf('ipv6') !== -1) {
      const parts = url.split('[');
      if (parts.length < 2) {
        return {
          network: null,
          url: addr,
        };
      } else {
        url = parts[1].split(']')[0];
      }
      const ipv = isIP(url);
      if (ipv === 6) {
        const parts = addr.split(':');
        network = 'ipv6';
        url = `[${url}]:${parts[parts.length - 1]}`;
      } else {
        return {
          network: null,
          url: addr,
        };
      }
    } else {
      return {
        network: null,
        url: addr,
      };
    }

    return {
      network: network,
      url: url,
    };
  }

  static getNthPercentile(n: number, sortedDistribution: any[]): any {
    return sortedDistribution[Math.floor((sortedDistribution.length - 1) * (n / 100))];
  }

  static getTransactionFromRequest(req: Request, form: boolean): string {
    const rawTx: any = typeof req.body === 'object' && form ? (Object.values(req.body)[0] as any) : req.body;
    if (typeof rawTx !== 'string') {
      throw Object.assign(new Error('Non-string request body'), { code: -1 });
    }

    // Support both upper and lower case hex
    // Support both txHash= Form and direct API POST
    const reg = form ? /^txHash=((?:[a-fA-F0-9]{2})+)$/ : /^((?:[a-fA-F0-9]{2})+)$/;
    const matches = reg.exec(rawTx);
    if (!matches || !matches[1]) {
      throw Object.assign(new Error('Non-hex request body'), { code: -2 });
    }

    // Guaranteed to be a hex string of multiple of 2
    // Guaranteed to be lower case
    // Guaranteed to pass validation (see function below)
    return this.validateTransactionHex(matches[1].toLowerCase());
  }

  static getTransactionsFromRequest(req: Request, limit = 25): string[] {
    if (!Array.isArray(req.body) || req.body.some((hex) => typeof hex !== 'string')) {
      throw Object.assign(new Error('Invalid request body (should be an array of hexadecimal strings)'), { code: -1 });
    }

    if (limit && req.body.length > limit) {
      throw Object.assign(new Error('Exceeded maximum of 25 transactions'), {
        code: -1,
      });
    }

    const txs = req.body;

    return txs.map((rawTx) => {
      // Support both upper and lower case hex
      // Support both txHash= Form and direct API POST
      const reg = /^((?:[a-fA-F0-9]{2})+)$/;
      const matches = reg.exec(rawTx);
      if (!matches || !matches[1]) {
        throw Object.assign(new Error('Invalid hex string'), { code: -2 });
      }

      // Guaranteed to be a hex string of multiple of 2
      // Guaranteed to be lower case
      // Guaranteed to pass validation (see function below)
      return this.validateTransactionHex(matches[1].toLowerCase());
    });
  }

  private static validateTransactionHex(txHex: string): string {
    // Do not mutate txhex

    // We assume txhex to be valid hex (output of getTransactionFromRequest above)
    try {
      // --- basic hex validation ---
      if (typeof txHex !== 'string' || txHex.length === 0) {
        throw new Error('empty or non-string input');
      }

      if ((txHex.length & 1) !== 0) {
        throw new Error('hex length must be even');
      }

      if (!/^[0-9a-fA-F]+$/.test(txHex)) {
        throw new Error('non-hex characters detected');
      }

      const bin = Common.hexToBin(txHex);
      const tx = Common.decodeTransaction(bin);

      // 1. Size Check
      if (tx.size > MAX_TX_BYTES) {
        throw new Error('transaction exceeds maximum size');
      }

      // 2. Version Check
      if (!VALID_VERSIONS.has(tx.version)) {
        throw new Error(`invalid tx version: ${tx.version}`);
      }

      // 3. Input Validation
      if (tx.inputs.length === 0) {
        throw new Error('invalid input count: transaction must have at least one input');
      }

      for (const input of tx.inputs) {
        // Check ScriptSig size (BCH policy/consensus limit check)
        if (input.scriptSig.length > MAX_SCRIPT_SIZE) {
          throw new Error(`input script too large (${input.scriptSig.length} bytes)`);
        }
      }

      // 4. Output Validation
      if (tx.outputs.length === 0) {
        throw new Error('invalid output count: transaction must have at least one output');
      }

      for (const output of tx.outputs) {
        // Check LockingScript size
        if (output.lockingScript.length > MAX_SCRIPT_SIZE) {
          throw new Error(`output script too large (${output.lockingScript.length} bytes)`);
        }

        // Optional: Check for negative values (though decodeTransaction uses BigUint64)
        if (output.value < 0n) {
          throw new Error('invalid output value');
        }
      }

      // Pass through the input string untouched
      return txHex;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown parsing error';
      logger.debug(`Error validating transaction hex: ${txHex}, due to: ${msg}`);
      throw Object.assign(new Error(`Invalid transaction (${msg})`), { code: -4 });
    }
  }

  /**
   * Converts a hex string to a Uint8Array (Binary)
   */
  static hexToBin(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
      throw new Error(`Hex string must have an even length. (Length: ${hex.length})`);
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      if (Number.isNaN(byte)) {
        throw new Error(`Invalid hex character at index ${i}`);
      }
      bytes[i / 2] = byte;
    }
    return bytes;
  }

  /**
   * Decodes a raw BCH transaction.
   * BCH uses the legacy format (no witness), so size is just bin.length.
   */
  static decodeTransaction(bin: Uint8Array): DecodedBCHTransaction {
    // Basic sanity check: A 32-byte buffer is almost certainly a TXID, not a TX
    if (bin.length === 32) {
      throw new Error('Provided hex is a 32-byte TXID, not a raw transaction.');
    }

    const reader = new BufferReader(bin);

    try {
      const version = reader.readUInt32LE();

      // Inputs
      const vinCount = reader.readVarInt();
      const inputs: TransactionInput[] = [];
      for (let i = 0; i < vinCount; i++) {
        inputs.push({
          outpointHash: reader.readBytes(32),
          outpointIndex: reader.readUInt32LE(),
          scriptSig: reader.readBytes(reader.readVarInt()),
          sequence: reader.readUInt32LE(),
        });
      }

      // Outputs
      const voutCount = reader.readVarInt();
      const outputs: TransactionOutput[] = [];
      for (let i = 0; i < voutCount; i++) {
        outputs.push({
          value: reader.readUInt64LE(),
          lockingScript: reader.readBytes(reader.readVarInt()),
        });
      }

      const locktime = reader.readUInt32LE();

      // Integrity Check: BCH transactions must not have extra data (garbage) at the end.
      if (reader.remaining() !== 0) {
        throw new Error(`Trailing garbage: ${reader.remaining()} bytes left over`);
      }

      return {
        version,
        inputs,
        outputs,
        locktime,
        size: bin.length, // Physical byte size
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown parsing error';
      throw new Error(`Failed to decode BCH transaction: ${msg}`);
    }
  }
}

/**
 * Helper to handle binary reading of BCH transactions
 */
class BufferReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  remaining(): number {
    return this.buf.length - this.offset;
  }

  readUInt8(): number {
    if (this.remaining() < 1) throw new Error('truncated readUInt8');
    return this.buf[this.offset++];
  }

  readUInt32LE(): number {
    if (this.remaining() < 4) throw new Error('truncated readUInt32LE');
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readUInt64LE(): bigint {
    if (this.remaining() < 8) throw new Error('truncated readUInt64LE');
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readBytes(n: number): Uint8Array {
    if (this.remaining() < n) throw new Error('truncated readBytes');
    const bytes = this.buf.slice(this.offset, this.offset + n);
    this.offset += n;
    return bytes;
  }

  readVarInt(): number {
    const first = this.readUInt8();
    if (first < 0xfd) return first;

    let value: number | bigint;
    if (first === 0xfd) {
      if (this.remaining() < 2) throw new Error('truncated readVarInt');
      value = this.view.getUint16(this.offset, true);
      this.offset += 2;
    } else if (first === 0xfe) {
      if (this.remaining() < 4) throw new Error('truncated readVarInt');
      value = this.view.getUint32(this.offset, true);
      this.offset += 4;
    } else {
      if (this.remaining() < 8) throw new Error('truncated readVarInt');
      value = this.view.getBigUint64(this.offset, true);
      this.offset += 8;
    }
    return Number(value);
  }
}

/**
 * Transaction Interfaces
 */
export interface TransactionInput {
  outpointHash: Uint8Array;
  outpointIndex: number;
  scriptSig: Uint8Array;
  sequence: number;
}

export interface TransactionOutput {
  value: bigint;
  lockingScript: Uint8Array;
}

export interface DecodedBCHTransaction {
  version: number;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  locktime: number;
  size: number; // size in bytes
}

/**
 * Class to calculate average fee rates of a list of transactions
 * at certain weight percentiles, in a single pass
 *
 * init with:
 *   maxWeight - the total weight to measure percentiles relative to (e.g. 4MW for a single block)
 *   percentileBandWidth - how many weight units to average over for each percentile (as a % of maxWeight)
 *   percentiles - an array of weight percentiles to compute, in %
 *
 * then call .processNext(tx) for each transaction, in descending order
 *
 * retrieve the final results with .getFeeStats()
 */
export class OnlineFeeStatsCalculator {
  private maxWeight: number;
  private percentiles = [10, 25, 50, 75, 90];

  private bandWidthPercent = 2;
  private bandWidth = 0;
  private bandIndex = 0;
  private leftBound = 0;
  private rightBound = 0;
  private inBand = false;
  private totalBandFee = 0;
  private totalBandWeight = 0;
  private minBandRate = Infinity;
  private maxBandRate = 0;

  private feeRange: { avg: number; min: number; max: number }[] = [];
  private totalSize = 0;

  constructor(maxWeight: number, percentileBandWidth?: number, percentiles?: number[]) {
    this.maxWeight = maxWeight;
    if (percentiles && percentiles.length) {
      this.percentiles = percentiles;
    }
    if (percentileBandWidth != null) {
      this.bandWidthPercent = percentileBandWidth;
    }
    this.bandWidth = this.maxWeight * (this.bandWidthPercent / 100);
    // add min/max percentiles aligned to the ends of the range
    this.percentiles.unshift(this.bandWidthPercent / 2);
    this.percentiles.push(100 - this.bandWidthPercent / 2);
    this.setNextBounds();
  }

  processNext(tx: { size: number; fee: number; feePerSize?: number; rate?: number; txid: string }): void {
    let left = this.totalSize;
    const right = this.totalSize + tx.size;
    if (!this.inBand && right <= this.leftBound) {
      this.totalSize += tx.size;
      return;
    }

    while (left < right) {
      if (right > this.leftBound) {
        this.inBand = true;
        const txRate = tx.rate || tx.feePerSize || 0;
        const weight = Math.min(right, this.rightBound) - Math.max(left, this.leftBound);
        this.totalBandFee += txRate * weight;
        this.totalBandWeight += weight;
        this.maxBandRate = Math.max(this.maxBandRate, txRate);
        this.minBandRate = Math.min(this.minBandRate, txRate);
      }
      left = Math.min(right, this.rightBound);

      if (left >= this.rightBound) {
        this.inBand = false;
        const avgBandFeeRate = this.totalBandWeight ? this.totalBandFee / this.totalBandWeight : 0;
        this.feeRange.unshift({
          avg: avgBandFeeRate,
          min: this.minBandRate,
          max: this.maxBandRate,
        });
        this.bandIndex++;
        this.setNextBounds();
        this.totalBandFee = 0;
        this.totalBandWeight = 0;
        this.minBandRate = Infinity;
        this.maxBandRate = 0;
      }
    }
    this.totalSize += tx.size;
  }

  private setNextBounds(): void {
    const nextPercentile = this.percentiles[this.bandIndex];
    if (nextPercentile != null) {
      this.leftBound = (nextPercentile / 100) * this.maxWeight - this.bandWidth / 2;
      this.rightBound = this.leftBound + this.bandWidth;
    } else {
      this.leftBound = Infinity;
      this.rightBound = Infinity;
    }
  }

  getRawFeeStats(): WorkingFeeStats {
    if (this.totalBandWeight > 0) {
      const avgBandFeeRate = this.totalBandWeight ? this.totalBandFee / this.totalBandWeight : 0;
      this.feeRange.unshift({
        avg: avgBandFeeRate,
        min: this.minBandRate,
        max: this.maxBandRate,
      });
    }
    while (this.feeRange.length < this.percentiles.length) {
      this.feeRange.unshift({ avg: 0, min: 0, max: 0 });
    }
    return {
      minFee: this.feeRange[0].min,
      medianFee: this.feeRange[Math.floor(this.feeRange.length / 2)].avg,
      maxFee: this.feeRange[this.feeRange.length - 1].max,
      feeRange: this.feeRange.map((f) => f.avg),
    };
  }

  getFeeStats(): FeeStats {
    const stats = this.getRawFeeStats();
    stats.feeRange[0] = stats.minFee;
    stats.feeRange[stats.feeRange.length - 1] = stats.maxFee;
    return stats;
  }
}
