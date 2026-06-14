import {
  VerboseTransactionExtended,
  VerboseMempoolTransactionExtended,
  TransactionExtended,
  TransactionMinerInfo,
  VoutStrippedToScriptPubkey,
} from '../mempool.interfaces';
import { IPublicApi } from './bitcoin/public-api.interface';
import bitcoinApi, { bitcoinCoreApi } from './bitcoin/bitcoin-api-factory';
import logger from '../logger';
import pLimit from '../utils/p-limit';

class TransactionUtils {
  constructor() {}

  // Inversed the opcodes object from https://gitlab.melroy.org/bitcoincash/bitcoin-cash-explorer/-/blob/main/backend/src/utils/bitcoin-script.ts?ref_type=heads
  private static opcodes: Record<number, string> = {
    0: 'OP_0',
    76: 'OP_PUSHDATA1',
    77: 'OP_PUSHDATA2',
    78: 'OP_PUSHDATA4',
    79: 'OP_PUSHNUM_NEG1',
    80: 'OP_RESERVED',
    81: 'OP_PUSHNUM_1',
    82: 'OP_PUSHNUM_2',
    83: 'OP_PUSHNUM_3',
    84: 'OP_PUSHNUM_4',
    85: 'OP_PUSHNUM_5',
    86: 'OP_PUSHNUM_6',
    87: 'OP_PUSHNUM_7',
    88: 'OP_PUSHNUM_8',
    89: 'OP_PUSHNUM_9',
    90: 'OP_PUSHNUM_10',
    91: 'OP_PUSHNUM_11',
    92: 'OP_PUSHNUM_12',
    93: 'OP_PUSHNUM_13',
    94: 'OP_PUSHNUM_14',
    95: 'OP_PUSHNUM_15',
    96: 'OP_PUSHNUM_16',
    97: 'OP_NOP',
    98: 'OP_VER',
    99: 'OP_IF',
    100: 'OP_NOTIF',
    101: 'OP_BEGIN',
    102: 'OP_UNTIL',
    103: 'OP_ELSE',
    104: 'OP_ENDIF',
    105: 'OP_VERIFY',
    106: 'OP_RETURN',
    107: 'OP_TOALTSTACK',
    108: 'OP_FROMALTSTACK',
    109: 'OP_2DROP',
    110: 'OP_2DUP',
    111: 'OP_3DUP',
    112: 'OP_2OVER',
    113: 'OP_2ROT',
    114: 'OP_2SWAP',
    115: 'OP_IFDUP',
    116: 'OP_DEPTH',
    117: 'OP_DROP',
    118: 'OP_DUP',
    119: 'OP_NIP',
    120: 'OP_OVER',
    121: 'OP_PICK',
    122: 'OP_ROLL',
    123: 'OP_ROT',
    124: 'OP_SWAP',
    125: 'OP_TUCK',
    126: 'OP_CAT',
    127: 'OP_SUBSTR',
    128: 'OP_LEFT',
    129: 'OP_RIGHT',
    130: 'OP_SIZE',
    188: 'OP_REVERSEBYTES',
    131: 'OP_INVERT',
    132: 'OP_AND',
    133: 'OP_OR',
    134: 'OP_XOR',
    135: 'OP_EQUAL',
    136: 'OP_EQUALVERIFY',
    137: 'OP_DEFINE',
    138: 'OP_INVOKE',
    139: 'OP_1ADD',
    140: 'OP_1SUB',
    141: 'OP_LSHIFTNUM',
    142: 'OP_RSHIFTNUM',
    143: 'OP_NEGATE',
    144: 'OP_ABS',
    145: 'OP_NOT',
    146: 'OP_0NOTEQUAL',
    147: 'OP_ADD',
    148: 'OP_SUB',
    149: 'OP_MUL',
    150: 'OP_DIV',
    151: 'OP_MOD',
    152: 'OP_LSHIFTBIN',
    153: 'OP_RSHIFTBIN',
    154: 'OP_BOOLAND',
    155: 'OP_BOOLOR',
    156: 'OP_NUMEQUAL',
    157: 'OP_NUMEQUALVERIFY',
    158: 'OP_NUMNOTEQUAL',
    159: 'OP_LESSTHAN',
    160: 'OP_GREATERTHAN',
    161: 'OP_LESSTHANOREQUAL',
    162: 'OP_GREATERTHANOREQUAL',
    163: 'OP_MIN',
    164: 'OP_MAX',
    165: 'OP_WITHIN',
    166: 'OP_RIPEMD160',
    167: 'OP_SHA1',
    168: 'OP_SHA256',
    169: 'OP_HASH160',
    170: 'OP_HASH256',
    171: 'OP_CODESEPARATOR',
    172: 'OP_CHECKSIG',
    173: 'OP_CHECKSIGVERIFY',
    174: 'OP_CHECKMULTISIG',
    175: 'OP_CHECKMULTISIGVERIFY',
    176: 'OP_NOP1',
    177: 'OP_CHECKLOCKTIMEVERIFY',
    178: 'OP_CHECKSEQUENCEVERIFY',
    179: 'OP_NOP4',
    180: 'OP_NOP5',
    181: 'OP_NOP6',
    182: 'OP_NOP7',
    183: 'OP_NOP8',
    184: 'OP_NOP9',
    185: 'OP_NOP10',
    192: 'OP_INPUTINDEX',
    193: 'OP_ACTIVEBYTECODE',
    194: 'OP_TXVERSION',
    195: 'OP_TXINPUTCOUNT',
    196: 'OP_TXOUTPUTCOUNT',
    197: 'OP_TXLOCKTIME',
    198: 'OP_UTXOVALUE',
    199: 'OP_UTXOBYTECODE',
    200: 'OP_OUTPOINTTXHASH',
    201: 'OP_OUTPOINTINDEX',
    202: 'OP_INPUTBYTECODE',
    203: 'OP_INPUTSEQUENCENUMBER',
    204: 'OP_OUTPUTVALUE',
    205: 'OP_OUTPUTBYTECODE',
    206: 'OP_UTXOTOKENCATEGORY',
    207: 'OP_UTXOTOKENCOMMITMENT',
    208: 'OP_UTXOTOKENAMOUNT',
    209: 'OP_OUTPUTTOKENCATEGORY',
    210: 'OP_OUTPUTTOKENCOMMITMENT',
    211: 'OP_OUTPUTTOKENAMOUNT',
    253: 'OP_PUBKEYHASH',
    254: 'OP_PUBKEY',
    255: 'OP_INVALIDOPCODE',
  };

  public stripCoinbaseTransaction(tx: VerboseTransactionExtended): TransactionMinerInfo {
    return {
      vin: [
        {
          scriptsig: tx.vin[0].scriptsig || tx.vin[0]['coinbase'],
        },
      ],
      vout: tx.vout
        .map(
          (vout): VoutStrippedToScriptPubkey => ({
            scriptpubkey_address: vout.scriptpubkey_address,
            scriptpubkey_asm: vout.scriptpubkey_asm,
            value: vout.value,
          })
        )
        .filter((vout) => vout.value),
    };
  }

  /**
   * Wrapper for $getTransactionExtended with an automatic retry direct to BCHN if the first API request fails.
   * Propagates any error from the retry request.
   * @param txid
   * @param addPrevouts
   * @param lazyPrevouts
   * @param forceCore
   * @param addMempoolData
   * @returns Promise<TransactionExtended>
   */
  public async $getTransactionExtendedRetry(
    txid: string,
    addPrevouts = false,
    lazyPrevouts = false,
    forceCore = false,
    addMempoolData = false
  ): Promise<VerboseTransactionExtended> {
    try {
      const result = await this.$getTransactionExtended(txid, addPrevouts, lazyPrevouts, forceCore, addMempoolData);
      if (result) {
        return result;
      } else {
        logger.err(`Cannot fetch tx ${txid}. Reason: backend returned null data`);
      }
    } catch (e) {
      logger.err(`Cannot fetch tx ${txid}. Reason: ` + (e instanceof Error ? e.message : e));
    }
    // retry direct from Core if first request failed
    return this.$getTransactionExtended(txid, addPrevouts, lazyPrevouts, true, addMempoolData);
  }

  /**
   * @param txId
   * @param addPrevouts
   * @param lazyPrevouts
   * @param forceCore - See https://github.com/mempool/mempool/issues/2904
   * @param addMempoolData
   * @returns Promise<TransactionExtended>
   */
  public async $getTransactionExtended(
    txId: string,
    addPrevouts = false,
    lazyPrevouts = false,
    forceCore = false,
    addMempoolData = false
  ): Promise<VerboseTransactionExtended> {
    let transaction: IPublicApi.VerboseTransaction;
    if (forceCore === true) {
      transaction = (await bitcoinCoreApi.$getRawTransaction(
        txId,
        false,
        addPrevouts,
        lazyPrevouts
      )) as IPublicApi.VerboseTransaction;
    } else {
      transaction = (await bitcoinApi.$getRawTransaction(
        txId,
        false,
        addPrevouts,
        lazyPrevouts
      )) as IPublicApi.VerboseTransaction;
    }

    if (addMempoolData || !transaction?.status?.confirmed) {
      return this.extendMempoolTransaction(transaction);
    } else {
      return this.extendTransaction(transaction);
    }
  }

  /**
   *
   * @param txId
   * @param addPrevouts
   * @param lazyPrevouts
   * @param forceCore
   * @returns Promise<MempoolTransactionExtended>
   */
  public async $getMempoolTransactionExtended(
    txId: string,
    addPrevouts = false,
    lazyPrevouts = false,
    forceCore = false
  ): Promise<VerboseMempoolTransactionExtended> {
    return (await this.$getTransactionExtended(
      txId,
      addPrevouts,
      lazyPrevouts,
      forceCore,
      true
    )) as VerboseMempoolTransactionExtended;
  }

  public async $getMempoolTransactionsExtended(
    txids: string[],
    addPrevouts = false,
    lazyPrevouts = false,
    forceCore = false
  ): Promise<VerboseMempoolTransactionExtended[]> {
    const limiter = pLimit(8); // Run 8 requests at a time
    const results = await Promise.allSettled(
      txids.map((txid) =>
        limiter(() => this.$getMempoolTransactionExtended(txid, addPrevouts, lazyPrevouts, forceCore))
      )
    );
    return results
      .filter((reply) => reply.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<VerboseMempoolTransactionExtended>).value);
  }

  public extendTransaction(transaction: IPublicApi.VerboseTransaction): VerboseTransactionExtended {
    // @ts-ignore
    if (transaction.vsize) {
      // @ts-ignore
      return transaction;
    }
    const feePerSize = (transaction.fee || 0) / transaction.size;
    const transactionExtended: VerboseTransactionExtended = {
      feePerSize,
      ...transaction,
    };
    if (!transaction?.status?.confirmed && !transactionExtended.firstSeen) {
      transactionExtended.firstSeen = Math.round(Date.now() / 1000);
    }
    return transactionExtended;
  }

  public extendMempoolTransaction(transaction: IPublicApi.VerboseTransaction): VerboseMempoolTransactionExtended {
    const size = Math.ceil(transaction.size);
    const sigops = transaction.sigops ? transaction.sigops : this.countSigops(transaction);
    // https://gitlab.com/bitcoin-cash-node/bitcoin-cash-node/-/blob/master/src/policy/policy.cpp#L182-185
    const adjustedSize = Math.max(transaction.size, sigops * 5); // adjusted vsize = std::max(nSize, nSigChecks * bytes_per_sigcheck)
    const feePerSize = (transaction.fee || 0) / transaction.size;
    const adjustedFeePerSize = (transaction.fee || 0) / adjustedSize;
    const transactionExtended: VerboseMempoolTransactionExtended = {
      ...transaction,
      order: this.txidToOrdering(transaction.txid),
      size,
      adjustedSize,
      sigops,
      feePerSize,
      adjustedFeePerSize,
    };
    if (!transactionExtended?.status?.confirmed && !transactionExtended.firstSeen) {
      transactionExtended.firstSeen = Math.round(Date.now() / 1000);
    }
    return transactionExtended;
  }

  // Generic method to strip verbosity from any verbose transaction type
  private stripVerbosity<T extends IPublicApi.VerboseTransaction>(transaction: T): IPublicApi.Transaction {
    // Convert verbose vin/vout to non-verbose versions
    const vin = transaction.vin.map(
      (v): IPublicApi.Vin => ({
        txid: v.txid,
        vout: v.vout,
        value: v.value,
        is_coinbase: v.is_coinbase,
        scriptsig: v.scriptsig,
        scriptsig_asm: v.scriptsig_asm,
        inner_redeemscript_asm: v.inner_redeemscript_asm,
        scriptsig_byte_code: v.scriptsig_byte_code,
        scriptpubkey_byte_code_pattern: v.scriptpubkey_byte_code_pattern,
        ...(v.token_category !== undefined && { token_category: v.token_category }),
        ...(v.token_amount !== undefined && { token_amount: v.token_amount }),
        ...(v.token_nft_capability !== undefined && { token_nft_capability: v.token_nft_capability }),
        ...(v.token_nft_commitment !== undefined && { token_nft_commitment: v.token_nft_commitment }),
        sequence: v.sequence,
        prevout: v.prevout
          ? {
              scriptpubkey: v.prevout.scriptpubkey,
              scriptpubkey_asm: v.prevout.scriptpubkey_asm,
              scriptpubkey_type: v.prevout.scriptpubkey_type,
              scriptpubkey_address: v.prevout.scriptpubkey_address,
              ...(v.prevout.token_category !== undefined && { token_category: v.prevout.token_category }),
              ...(v.prevout.token_amount !== undefined && { token_amount: v.prevout.token_amount }),
              ...(v.prevout.token_nft_capability !== undefined && {
                token_nft_capability: v.prevout.token_nft_capability,
              }),
              ...(v.prevout.token_nft_commitment !== undefined && {
                token_nft_commitment: v.prevout.token_nft_commitment,
              }),
              value: v.prevout.value,
            }
          : null,
        lazy: v.lazy,
      })
    );

    const vout = transaction.vout.map(
      (v): IPublicApi.Vout => ({
        scriptpubkey: v.scriptpubkey,
        scriptpubkey_asm: v.scriptpubkey_asm,
        scriptpubkey_type: v.scriptpubkey_type,
        scriptpubkey_address: v.scriptpubkey_address,
        value: v.value,
        ...(v.token_category !== undefined && { token_category: v.token_category }),
        ...(v.token_amount !== undefined && { token_amount: v.token_amount }),
        ...(v.token_nft_capability !== undefined && { token_nft_capability: v.token_nft_capability }),
        ...(v.token_nft_commitment !== undefined && { token_nft_commitment: v.token_nft_commitment }),
      })
    );

    const result: IPublicApi.Transaction = { ...transaction };
    result.vin = vin;
    result.vout = vout;
    return result;
  }

  // Method to strip verbosity from arrays of verbose transactions
  public stripVerbosityFromTransactions(transactions: IPublicApi.VerboseTransaction[]): IPublicApi.Transaction[] {
    return transactions.map((tx) => this.stripVerbosity(tx));
  }

  // Method to strip verbosity from a single verbose transaction (extended types)
  public stripVerbosityFromTransaction(transaction: VerboseTransactionExtended): TransactionExtended {
    return this.stripVerbosity(transaction) as TransactionExtended;
  }

  public hex2ascii(hex: string) {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
  }

  /**
   *  Calculate the sigops cost of an asm script
   */
  public countScriptSigops(script: string, isRawScript = false): number {
    if (!script?.length) {
      return 0;
    }

    let sigops = 0;
    // count OP_CHECKSIG and OP_CHECKSIGVERIFY
    sigops += script.match(/OP_CHECKSIG/g)?.length || 0;

    // count OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY
    if (isRawScript) {
      // in scriptPubKey or scriptSig, always worth 20
      sigops += 20 * (script.match(/OP_CHECKMULTISIG/g)?.length || 0);
    } else {
      // in redeem scripts and witnesses, worth N if preceded by OP_N, 20 otherwise
      const matches = script.matchAll(/(?:OP_(?:PUSHNUM_)?(\d+))? OP_CHECKMULTISIG/g);
      for (const match of matches) {
        const n = parseInt(match[1]);
        if (Number.isInteger(n)) {
          sigops += n;
        } else {
          sigops += 20;
        }
      }
    }

    return sigops * 4;
  }

  public countSigops(transaction: IPublicApi.Transaction): number {
    let sigops = 0;

    for (const input of transaction.vin) {
      if (input.scriptsig_asm) {
        sigops += this.countScriptSigops(input.scriptsig_asm, true);
      }
      if (input.prevout) {
        // BCH  does not have v0_p2wpkh, v0_p2wsh or v1_p2tr
        switch (true) {
          case input.prevout.scriptpubkey_type === 'p2sh' && input.scriptsig && input.scriptsig.startsWith('160014'):
          case input.prevout?.scriptpubkey_type === 'p2sh' && input.scriptsig && input.scriptsig.startsWith('220020'):
          case input.prevout.scriptpubkey_type === 'p2sh':
            if (input.inner_redeemscript_asm) {
              sigops += this.countScriptSigops(input.inner_redeemscript_asm);
            }
            break;
        }
      }
    }

    for (const output of transaction.vout) {
      if (output.scriptpubkey_asm) {
        sigops += this.countScriptSigops(output.scriptpubkey_asm, true);
      }
    }

    return sigops;
  }

  /**
   * see https://github.com/bitcoin/bitcoin/blob/25c45bb0d0bd6618ec9296a1a43605657124e5de/src/policy/policy.cpp#L166-L193
   * returns true if the transactions is permitted under bip54 sigops rules
   *
   * "Unlike the existing block wide sigop limit which counts sigops present in the block
   * itself (including the scriptPubKey which is not executed until spending later), BIP54
   * counts sigops in the block where they are potentially executed (only).
   * This means sigops in the spent scriptPubKey count toward the limit.
   * `fAccurate` means correctly accounting sigops for CHECKMULTISIGs(VERIFY) with 16 pubkeys
   * or fewer. This method of accounting was introduced by BIP16, and BIP54 reuses it.
   * The GetSigOpCount call on the previous scriptPubKey counts both bare and P2SH sigops."
   */
  public checkSigopsBIP54(tx: VerboseTransactionExtended, limit): boolean {
    let sigops = 0;
    for (const input of tx.vin) {
      if (input.scriptsig_asm) {
        sigops += this.countScriptSigops(input.scriptsig_asm);
      }
      if (input.prevout) {
        // P2SH redeem script
        if (input.prevout.scriptpubkey_type === 'p2sh' && input.inner_redeemscript_asm) {
          sigops += this.countScriptSigops(input.inner_redeemscript_asm);
        } else {
          // prevout scriptpubkey
          sigops += this.countScriptSigops(input.prevout.scriptpubkey_asm);
        }
      }

      if (sigops > limit) {
        return false;
      }
    }
    return true;
  }

  // returns the most significant 4 bytes of the txid as an integer
  public txidToOrdering(txid: string): number {
    // Parse last 4 bytes of txid as little-endian uint32, without string allocation
    let result = 0;
    for (let i = 62; i >= 56; i -= 2) {
      const hi = txid.charCodeAt(i);
      const lo = txid.charCodeAt(i + 1);
      result = result * 256 + (hi < 58 ? hi - 48 : hi - 87) * 16 + (lo < 58 ? lo - 48 : lo - 87);
    }
    return result;
  }

  public addInnerScriptsToVin(vin: IPublicApi.Vin): void {
    if (!vin.prevout) {
      return;
    }

    if (vin.prevout.scriptpubkey_type === 'p2sh' && vin.scriptsig_asm?.length) {
      const redeemScript = vin.scriptsig_asm.split(' ').reverse()[0];
      vin.inner_redeemscript_asm = this.convertScriptSigAsm(redeemScript);
    }
  }

  /*private static singleChunkIsBuffer(buf: Buffer | number): buf is Buffer {
    return Buffer.isBuffer(buf);
  }

  private static asMinimalOP(buffer: Buffer): number | undefined {
    if (buffer.length === 0) return 0; // OP_0
    if (buffer.length !== 1) return undefined;
    if (buffer[0] >= 1 && buffer[0] <= 16) return 80 + buffer[0]; // OP_RESERVED + N = OP_N
    if (buffer[0] === 0x81) return 79; // OP_1NEGATE
    return undefined;
  }

  private static decompile(buffer: Buffer): (Buffer | number)[] | null {
    const chunks: (Buffer | number)[] = [];
    let i = 0;

    while (i < buffer.length) {
      const opcode = buffer[i];

      if (opcode > 0x00 && opcode <= 0x4e) {
        let dataLength: number;
        let sizeBytes = 1;

        if (opcode <= 0x4b) {
          dataLength = opcode;
        } else if (opcode === 0x4c) {
          // OP_PUSHDATA1
          if (i + 1 >= buffer.length) return null;
          dataLength = buffer.readUInt8(i + 1);
          sizeBytes = 2;
        } else if (opcode === 0x4d) {
          // OP_PUSHDATA2
          if (i + 2 >= buffer.length) return null;
          dataLength = buffer.readUInt16LE(i + 1);
          sizeBytes = 3;
        } else {
          // 0x4e - OP_PUSHDATA4
          if (i + 4 >= buffer.length) return null;
          dataLength = buffer.readUInt32LE(i + 1);
          sizeBytes = 5;
        }

        i += sizeBytes;

        if (i + dataLength > buffer.length) return null;

        const data = buffer.subarray(i, i + dataLength);
        i += dataLength;

        const op = this.asMinimalOP(data);
        if (op !== undefined) {
          chunks.push(op);
        } else {
          chunks.push(data);
        }
      } else {
        chunks.push(opcode);
        i += 1;
      }
    }

    return chunks;
  }

  private static scriptToASM(chunks: Buffer | (Buffer | number)[]): string {
    let decompiled: (Buffer | number)[] | null;

    if (Buffer.isBuffer(chunks)) {
      decompiled = this.decompile(chunks);
    } else {
      decompiled = chunks;
    }

    if (!decompiled) {
      throw new Error('Could not convert invalid chunks to ASM');
    }

    return decompiled
      .map((chunk) => {
        if (this.singleChunkIsBuffer(chunk)) {
          const op = this.asMinimalOP(chunk);
          if (op === undefined) return chunk.toString('hex');
          chunk = op;
        }
        return this.opcodes[chunk as number];
      })
      .join(' ');
  }*/

  public convertScriptSigAsm(hex: string): string {
    const buf = Buffer.from(hex, 'hex');

    const b: string[] = [];

    let i = 0;
    while (i < buf.length) {
      const op = buf[i];
      if (op >= 0x01 && op <= 0x4e) {
        i++;
        let push: number;
        if (op === 0x4c && buf.length > i) {
          push = buf.readUInt8(i);
          b.push('OP_PUSHDATA1');
          i += 1;
        } else if (op === 0x4d && buf.length > i + 1) {
          push = buf.readUInt16LE(i);
          b.push('OP_PUSHDATA2');
          i += 2;
        } else if (op === 0x4e && buf.length > i + 3) {
          push = buf.readUInt32LE(i);
          b.push('OP_PUSHDATA4');
          i += 4;
        } else {
          push = op;
          b.push('OP_PUSHBYTES_' + push);
        }

        if (i >= buf.length) {
          break;
        }
        const data = buf.subarray(i, Math.min(i + push, buf.length));
        b.push(data.toString('hex'));
        i += data.length;
        if (data.length !== push) {
          break;
        }
      } else {
        if (op === 0x00) {
          b.push('OP_0');
        } else if (op === 0x4f) {
          b.push('OP_PUSHNUM_NEG1');
        } else if (op === 0xb1) {
          b.push('OP_CLTV');
        } else if (op === 0xb2) {
          b.push('OP_CSV');
        } else {
          const opcode = TransactionUtils.opcodes[op];
          if (opcode && op < 0xfd) {
            if (/^OP_(\d+)$/.test(opcode)) {
              b.push(opcode.replace(/^OP_(\d+)$/, 'OP_PUSHNUM_$1'));
            } else {
              b.push(opcode);
            }
          } else {
            b.push('OP_RETURN_' + op);
          }
        }
        i += 1;
      }
    }

    return b.join(' ');
  }

  // calculate the most parsimonious set of prioritizations given a list of block transactions
  // (i.e. the most likely prioritizations and deprioritizations)
  public identifyPrioritizedTransactions(
    transactions: any[],
    rateKey: string
  ): { prioritized: string[]; deprioritized: string[] } {
    // find the longest increasing subsequence of transactions
    // (adapted from https://en.wikipedia.org/wiki/Longest_increasing_subsequence#Efficient_algorithms)
    // should be O(n log n)
    const X = transactions
      .slice(1)
      .reverse()
      .map((tx) => ({ txid: tx.txid, rate: tx[rateKey] })); // standard block order is by *decreasing* effective fee rate, but we want to iterate in increasing order (and skip the coinbase)
    if (X.length < 2) {
      return { prioritized: [], deprioritized: [] };
    }
    const N = X.length;
    const P: number[] = new Array(N);
    const M: number[] = new Array(N + 1);
    M[0] = -1; // undefined so can be set to any value

    let L = 0;
    for (let i = 0; i < N; i++) {
      // Binary search for the smallest positive l ≤ L
      // such that X[M[l]].effectiveFeePerVsize > X[i].effectiveFeePerVsize
      let lo = 1;
      let hi = L + 1;
      while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2); // lo <= mid < hi
        if (X[M[mid]].rate > X[i].rate) {
          hi = mid;
        } else {
          // if X[M[mid]].effectiveFeePerVsize < X[i].effectiveFeePerVsize
          lo = mid + 1;
        }
      }

      // After searching, lo == hi is 1 greater than the
      // length of the longest prefix of X[i]
      const newL = lo;

      // The predecessor of X[i] is the last index of
      // the subsequence of length newL-1
      P[i] = M[newL - 1];
      M[newL] = i;

      if (newL > L) {
        // If we found a subsequence longer than any we've
        // found yet, update L
        L = newL;
      }
    }

    // Reconstruct the longest increasing subsequence
    // It consists of the values of X at the L indices:
    // ..., P[P[M[L]]], P[M[L]], M[L]
    const LIS: any[] = new Array(L);
    let k = M[L];
    for (let j = L - 1; j >= 0; j--) {
      LIS[j] = X[k];
      k = P[k];
    }

    const lisMap = new Map<string, number>();
    LIS.forEach((tx, index) => lisMap.set(tx.txid, index));

    const prioritized: string[] = [];
    const deprioritized: string[] = [];

    let lastRate = X[0].rate;

    for (const tx of X) {
      if (lisMap.has(tx.txid)) {
        lastRate = tx.rate;
      } else {
        if (Math.abs(tx.rate - lastRate) < 0.1) {
          // skip if the rate is almost the same as the previous transaction
        } else if (tx.rate <= lastRate) {
          prioritized.push(tx.txid);
        } else {
          deprioritized.push(tx.txid);
        }
      }
    }

    return { prioritized, deprioritized };
  }

  // Copied from https://gitlab.melroy.org/bitcoincash/bitcoin-cash-explorer/-/blob/main/backend/src/api/bitcoin/bitcoin-api.ts?ref_type=heads#L388
  public translateScriptPubKeyType(outputType: string): string {
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
}

export default new TransactionUtils();
