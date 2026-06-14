import { TransactionFlags } from '@app/shared/filters.utils';
import {
  getVarIntLength,
  parseMultisigScript,
  isPoint,
} from '@app/shared/script.utils';
import { Transaction, Vin, Utxo } from '@app/interfaces/backend-api.interface';
import { hash, Hash, ripemd160 } from '@app/shared/sha256';
import { AddressType, cashaddrEncode } from '@app/shared/address-utils';

// BCHN default policy settings
const MIN_BLOCK_SIZE = 32_000_000;
const MAX_BLOCK_SIGOPS_COST = 80_000;
const MAX_STANDARD_TX_SIGOPS_COST = MAX_BLOCK_SIGOPS_COST / 5;
const MIN_STANDARD_TX_SIZE = 65; /// TODO: Check for BCH
const MAX_P2SH_SIGOPS = 15;
const MAX_STANDARD_SCRIPTSIG_SIZE = 1650;
const DUST_RELAY_TX_FEE = 3;
const MAX_OP_RETURN_RELAY = 83;

const DEFAULT_PERMIT_BAREMULTISIG = true;
const MAX_TX_LEGACY_SIGOPS = 2_500 * 4; // witness-adjusted sigops

export function countScriptSigops(
  script: string,
  isRawScript: boolean = false
): number {
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
    const matches = script.matchAll(
      /(?:OP_(?:PUSHNUM_)?(\d+))? OP_CHECKMULTISIG/g
    );
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

// enforce canonical DER-encoded signature format
// <0x30> <total len> <0x02> <len R> <R> <0x02> <len S> <S> <hashtype>
// see https://github.com/bitcoin/bitcoin/blob/9a05b45da60d214cb1e5a50c3d2293b1defc9bb0/src/script/interpreter.cpp#L97-L106
//
// TODO: For BCH this DER Sig check is incomplete. While it might work on some P2PKH transactions, it will not work on SIGHASH_UTXOS
export function isCanonicalDERSig(w: string): boolean {
  // minimum DER signature length is 8 bytes + sighash flag (see https://mempool.space/testnet/tx/c6c232a36395fa338da458b86ff1327395a9afc28c5d2daa4273e410089fd433)

  if (w.length < 18) {
    return false;
  }

  // first byte is 0x30 ("SEQUENCE")
  if (!w.startsWith('30')) {
    return false;
  }

  // second byte encodes the total length of the sequence (not including sighash flag)
  const compoundLength = parseInt(w.slice(2, 4), 16);
  if (w.length !== compoundLength * 2 + 6) {
    return false;
  }

  // third byte is 0x02 ("INTEGER")
  if (w.slice(4, 6) !== '02') {
    return false;
  }

  // fourth byte encodes the length of the R component
  const rLength = parseInt(w.slice(6, 8), 16);
  // rLength doesn't overflow remaining space
  if (w.length < rLength * 2 + 10) {
    return false;
  }
  const sEnd = 8 + rLength * 2;

  // next byte after R is 0x02 ("INTEGER")
  if (w.slice(sEnd, sEnd + 2) !== '02') {
    return false;
  }

  // next byte encodes the length of the S component
  const sLength = parseInt(w.slice(sEnd + 2, sEnd + 4), 16);
  // R + S lengths exactly fit the length of the signature
  if (w.length !== (rLength + sLength) * 2 + 14) {
    return false;
  }

  return true;
}

export enum SighashFlag {
  ALL = 1,
  NONE = 2,
  SINGLE = 3,
  UTXOS = 0x20,
  FORKID = 0x40,
  ANYONECANPAY = 0x80,
}

export type SighashValue =
  | (SighashFlag.ALL | SighashFlag.FORKID)
  | (SighashFlag.NONE | SighashFlag.FORKID)
  | (SighashFlag.SINGLE | SighashFlag.FORKID)
  | (SighashFlag.ALL | SighashFlag.UTXOS | SighashFlag.FORKID)
  | (SighashFlag.NONE | SighashFlag.UTXOS | SighashFlag.FORKID)
  | (SighashFlag.SINGLE | SighashFlag.UTXOS | SighashFlag.FORKID)
  | (SighashFlag.ALL | SighashFlag.ANYONECANPAY | SighashFlag.FORKID)
  | (SighashFlag.NONE | SighashFlag.ANYONECANPAY | SighashFlag.FORKID)
  | (SighashFlag.SINGLE | SighashFlag.ANYONECANPAY | SighashFlag.FORKID)
  | (SighashFlag.ALL | SighashFlag.NONE | SighashFlag.FORKID);

// Combinations of Bitwise OR (converted to Decimal)
// All decimals are with FORKID, but we omit this in the label name
export const SighashLabels: Record<number, string> = {
  '65': 'SIGHASH_ALL',
  '66': 'SIGHASH_NONE',
  '67': 'SIGHASH_SINGLE',
  '97': 'SIGHASH_ALL | SIGHASH_UTXOS',
  '98': 'SIGHASH_NONE | SIGHASH_UTXOS',
  '99': 'SIGHASH_SINGLE | SIGHASH_UTXOS',
  '193': 'SIGHASH_ALL | ACP',
  '194': 'SIGHASH_NONE | ACP',
  '195': 'SIGHASH_SINGLE | ACP',
};

export interface SigInfo {
  signature: string;
  sighash: SighashValue; // in hex
}

export class Sighash {
  static isACP(val: SighashValue): boolean {
    return val >= SighashFlag.ANYONECANPAY;
  }

  static isUTXOS(val: SighashValue): boolean {
    return val >= SighashFlag.UTXOS;
  }

  static isNone(val: SighashValue): boolean {
    return (val & 0x7f) === SighashFlag.NONE;
  }

  static isSingle(val: SighashValue): boolean {
    return (val & 0x7f) === SighashFlag.SINGLE;
  }

  static isAll(val: SighashValue): boolean {
    return (val & 0x7f) === SighashFlag.ALL;
  }
}

/**
 * Decode the sighash flag from a sighash hex value
 *
 * @param sighash Sighash flag (like a hex value)
 * @returns Sighash flag as SighashValue (if it matches common sighash flags)
 */
export function decodeSighashFlag(sighash: number): SighashValue {
  if (
    (sighash >= 0x41 && sighash <= 0x67) ||
    (sighash >= 0x61 && sighash <= 0xc3)
  ) {
    return sighash as SighashValue;
  }
  return (SighashFlag.ALL | SighashFlag.FORKID) as SighashValue;
}

/**
 * Try to extract the DER signarure from a script ASM
 *
 * Do NOT use this for P2PKH in BCH, maybe P2SH might work.. most likely not either.
 * @param script_asm Input script ASM
 * @returns Array of signatures
 */
export function extractDERSignaturesASM(script_asm: string): SigInfo[] {
  if (!script_asm) {
    return [];
  }

  const signatures: SigInfo[] = [];
  const ops = script_asm.split(' ');

  for (let i = 0; i < ops.length - 1; i++) {
    // Look for OP_PUSHBYTES_N followed by a hex string
    if (ops[i].startsWith('OP_PUSHBYTES_')) {
      const hexData = ops[i + 1];
      if (isCanonicalDERSig(hexData)) {
        const sighash = decodeSighashFlag(parseInt(hexData.slice(-2), 16));
        signatures.push({
          signature: hexData,
          sighash,
        });
      }
    }
  }

  return signatures;
}

export function processInputSignatures(vin: Vin): SigInfo[] {
  const addressType = vin.prevout?.scriptpubkey_type as AddressType;
  let signatures: SigInfo[] = [];
  // Only switch on BCH supported types
  switch (addressType) {
    case 'p2pk':
    case 'multisig':
    case 'p2pkh':
      // We might need to look better into this still, I currently just "made it work",
      // Maybe something can still be improved or is incorrect.
      if (vin.scriptsig_byte_code.length > 0) {
        signatures.push({
          signature: vin.scriptsig_byte_code.join(''),
          sighash: decodeSighashFlag(
            // First data line contains the sighash flag at the end
            parseInt(vin.scriptsig_byte_code[0].slice(-2), 16)
          ),
        });
      }
      break;
    case 'p2sh':
      {
        if (vin.scriptsig_byte_code.length > 0) {
          signatures.push({
            signature: vin.scriptsig_byte_code.join(''), // BCH is using Schnorr signature algorithm
            sighash: SighashFlag.ALL | SighashFlag.UTXOS | SighashFlag.FORKID, // hard coded for now
          });
        }
        // Old BTC stuff
        // signatures = [
        //   ...extractDERSignaturesASM(vin.scriptsig_asm),
        //   ...extractDERSignaturesASM(vin.inner_redeemscript_asm),
        // ];
      }
      break;
    default:
      // non-signed input types?
      break;
  }
  return signatures;
}

/*
 * returns the number of missing signatures and the number of bytes to add to the transaction
 * - Add a DER sig     in scriptsig: 71 bytes signature + 1 push byte = 72 bytes
 * - Add a public key  in scriptsig: 33 bytes pubkey    + 1 push byte = 34 bytes
 */
export function fillUnsignedInput(vin: Vin): {
  missingSigs: number;
  bytes: number;
} {
  let missingSigs = 0;
  let bytes = 0;

  const addressType = vin.prevout?.scriptpubkey_type as AddressType;
  let signatures: SigInfo[] = [];
  let multisig: { m: number; n: number } | null = null;
  // Only switch on BCH supported types
  switch (addressType) {
    case 'p2pk':
      // BCH uses Schnorr signatures (not DER) — use scriptsig_byte_code populated during decode
      if (!vin.scriptsig_byte_code?.length) {
        missingSigs = 1;
        bytes = 72;
      }
      break;
    case 'multisig':
      signatures = extractDERSignaturesASM(vin.scriptsig_asm);
      multisig = parseMultisigScript(vin.prevout.scriptpubkey_asm);
      if (multisig && multisig.m - signatures.length > 0) {
        missingSigs = multisig.m - signatures.length;
        bytes = 72 * missingSigs + 1; // add empty stack item required for OP_CHECKMULTISIG
        const scriptsigLength = vin.scriptsig.length / 2;
        const newLength = scriptsigLength + bytes;
        if (scriptsigLength < 253 && newLength >= 253) {
          bytes += 2; // Increase scriptsig's compact size from 1 to 3 bytes
        }
      }
      break;
    case 'p2pkh':
      // BCH uses Schnorr signatures (not DER) — use scriptsig_byte_code populated during decode
      if (!vin.scriptsig_byte_code?.length) {
        missingSigs = 1;
        bytes = 106; // 72 + 34 (sig + public key)
      }
      break;
    case 'p2sh':
      // Check for P2SH multisig
      multisig = parseMultisigScript(vin.inner_redeemscript_asm);
      if (multisig) {
        signatures = extractDERSignaturesASM(vin.scriptsig_asm);
        if (multisig.m - signatures.length > 0) {
          missingSigs = multisig.m - signatures.length;
          bytes = 72 * missingSigs + 1; // empty push required for OP_CHECKMULTISIG
          const scriptsigLength = vin.scriptsig.length / 2;
          const newLength = scriptsigLength + bytes;
          if (scriptsigLength < 253 && newLength >= 253) {
            bytes += 2; // Increase scriptsig's compact size from 1 to 3 bytes
          }
        }
      }
      break;
    default:
      break;
  }
  return { missingSigs, bytes };
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
export function isNonStandard(
  tx: Transaction,
  height?: number,
  network?: string
): boolean {
  // version
  if (isNonStandardVersion(tx, height, network)) {
    return true;
  }

  // tx-size
  if (tx.size > MIN_BLOCK_SIZE) {
    return true;
  }

  // tx-size-small
  if (getSize(tx) < MIN_STANDARD_TX_SIZE) {
    return true;
  }

  // bad-txns-too-many-sigops
  if (tx.sigops && tx.sigops > MAX_STANDARD_TX_SIGOPS_COST) {
    return true;
  }

  // legacy sigops
  if (isNonStandardLegacySigops(tx, height, network)) {
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
    if (vin.scriptsig_asm) {
      for (const op of vin.scriptsig_asm.split(' ')) {
        if (opcodes[op] && opcodes[op] > opcodes['OP_16']) {
          return true;
        }
      }
    }
    // bad-txns-nonstandard-inputs
    if (vin.prevout?.scriptpubkey_type === 'p2sh') {
      // TODO: evaluate script (https://github.com/bitcoin/bitcoin/blob/1ac627c485a43e50a9a49baddce186ee3ad4daad/src/policy/policy.cpp#L177)
      // countScriptSigops returns the witness-scaled sigops, so divide by 4 before comparison with MAX_P2SH_SIGOPS
      const sigops = countScriptSigops(vin.inner_redeemscript_asm || '') / 4;
      if (sigops > MAX_P2SH_SIGOPS) {
        return true;
      }
    } else if (
      ['unknown', 'provably_unspendable', 'empty'].includes(
        vin.prevout?.scriptpubkey_type || ''
      )
    ) {
      return true;
    } else if (
      vin.prevout?.scriptpubkey_type === 'anchor' &&
      isNonStandardAnchor(vin, height, network)
    ) {
      return true;
    }
  }

  // output validation
  let opreturnCount = 0;
  let opreturnBytes = 0;
  for (const vout of tx.vout) {
    // scriptpubkey
    if (
      ['nonstandard', 'provably_unspendable', 'empty'].includes(
        vout.scriptpubkey_type
      )
    ) {
      // (non-standard output type)
      return true;
    } else if (vout.scriptpubkey_type === 'unknown') {
      // undefined segwit version/length combinations are actually standard in outputs
      // https://github.com/bitcoin/bitcoin/blob/2c79abc7ad4850e9e3ba32a04c530155cda7f980/src/script/interpreter.cpp#L1950-L1951
      if (vout.scriptpubkey.startsWith('00')) {
        return true;
      }
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
    if (
      vout.scriptpubkey_type !== 'op_return' &&
      isDustOutput(vout.value, vout.scriptpubkey)
    ) {
      // TODO: Update for BCH. BCH also doesn't have Ephemeral dust
    }
  }

  // op_return
  if (opreturnCount > 0) {
    if (!isStandardOpReturn(opreturnBytes, opreturnCount, height, network)) {
      return true;
    }
  }

  // TODO: non-mandatory-script-verify-flag

  return false;
}

// Individual versioned standardness rules

// const V3_STANDARDNESS_ACTIVATION_HEIGHT = {
//   testnet4: 42_000,
//   testnet: 2_900_000,
//   chipnet: 211_000,
//   '': 863_500,
// };
function isNonStandardVersion(
  tx: Transaction,
  height?: number,
  network?: string
): boolean {
  let TX_MAX_STANDARD_VERSION = 2;

  // Note: BCH Currently doesn't *yet* have v3 transactions
  // if (
  //   height != null &&
  //   network != null &&
  //   V3_STANDARDNESS_ACTIVATION_HEIGHT[network] &&
  //   height <= V3_STANDARDNESS_ACTIVATION_HEIGHT[network]
  // ) {
  //   // V3 transactions were non-standard to spend before v28.x (scheduled for 2024/09/30 https://github.com/bitcoin/bitcoin/issues/29891)
  //   TX_MAX_STANDARD_VERSION = 2;
  // }

  if (tx.version > TX_MAX_STANDARD_VERSION) {
    return true;
  }
  return false;
}

const ANCHOR_STANDARDNESS_ACTIVATION_HEIGHT = {
  testnet4: 42_000,
  '': 863_500,
};
function isNonStandardAnchor(
  vin: Vin,
  height?: number,
  network?: string
): boolean {
  if (
    height != null &&
    network != null &&
    ANCHOR_STANDARDNESS_ACTIVATION_HEIGHT[network] &&
    height <= ANCHOR_STANDARDNESS_ACTIVATION_HEIGHT[network] &&
    vin.prevout?.scriptpubkey === '51024e73'
  ) {
    // anchor outputs were non-standard to spend before v28.x (scheduled for 2024/09/30 https://github.com/bitcoin/bitcoin/issues/29891)
    return true;
  }
  return false;
}

// OP_RETURN size & count limits were lifted in v28.3/v29.2/v30.0
const OP_RETURN_STANDARDNESS_ACTIVATION_HEIGHT = {
  testnet4: 108_000,
  '': 921_000,
};
const MAX_DATACARRIER_BYTES = 83;
function isStandardOpReturn(
  bytes: number,
  outputs: number,
  height?: number,
  network?: string
): boolean {
  if (
    height == null ||
    (OP_RETURN_STANDARDNESS_ACTIVATION_HEIGHT[network] &&
      height >= OP_RETURN_STANDARDNESS_ACTIVATION_HEIGHT[network]) || // limits lifted
    // OR
    (bytes <= MAX_DATACARRIER_BYTES && outputs <= 1) // below old limits
  ) {
    return true;
  }
  return false;
}

// New legacy sigops limit started to be enforced in v30.0
const LEGACY_SIGOPS_STANDARDNESS_ACTIVATION_HEIGHT = {
  testnet4: 108_000,
  '': 921_000,
};
function isNonStandardLegacySigops(
  tx: Transaction,
  height?: number,
  network?: string
): boolean {
  if (
    height == null ||
    (LEGACY_SIGOPS_STANDARDNESS_ACTIVATION_HEIGHT[network] &&
      height >= LEGACY_SIGOPS_STANDARDNESS_ACTIVATION_HEIGHT[network])
  ) {
    if (!checkSigopsBIP54(tx, MAX_TX_LEGACY_SIGOPS)) {
      return true;
    }
  }
  return false;
}

export function getSize(tx: Transaction): number {
  return Math.ceil(tx.size);
}

export function setSighashFlags(flags: bigint, byte_code_data: string): bigint {
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

export function isBurnKey(pubkey: string): boolean {
  return [
    '022222222222222222222222222222222222222222222222222222222222222222',
    '033333333333333333333333333333333333333333333333333333333333333333',
    '020202020202020202020202020202020202020202020202020202020202020202',
    '030303030303030303030303030303030303030303030303030303030303030303',
  ].includes(pubkey);
}

export function getTransactionFlags(
  tx: Transaction,
  height?: number,
  network?: string
): bigint {
  let flags = tx.flags ? BigInt(tx.flags) : 0n;

  // Already processed static flags, no need to do it again
  if (tx.flags) {
    return flags;
  }

  // Process static flags
  if (tx.version === 1) {
    flags |= TransactionFlags.v1;
  } else if (tx.version === 2) {
    flags |= TransactionFlags.v2;
  }
  // BCH currently doesn't have txs v3 yet
  //  else if (tx.version === 3) {
  //   flags |= TransactionFlags.v3;
  // }
  const reusedInputAddresses: { [address: string]: number } = {};
  const reusedOutputAddresses: { [address: string]: number } = {};
  const inValues = {};
  const outValues = {};
  for (const vin of tx.vin) {
    switch (vin.prevout?.scriptpubkey_type) {
      case 'p2pk':
        flags |= TransactionFlags.p2pk;
        break;
      case 'multisig':
        flags |= TransactionFlags.p2ms;
        break;
      case 'p2pkh':
        flags |= TransactionFlags.p2pkh;
        break;
      case 'p2sh':
        flags |= TransactionFlags.p2sh;
        break;
    }

    // sighash flags
    if (
      vin.scriptsig_byte_code.length > 0 &&
      vin.scriptpubkey_byte_code_pattern === '76a95188ac'
    ) {
      flags |= setSighashFlags(flags, vin.scriptsig_byte_code[0]);
    }

    if (vin.prevout?.scriptpubkey_address) {
      reusedInputAddresses[vin.prevout?.scriptpubkey_address] =
        (reusedInputAddresses[vin.prevout?.scriptpubkey_address] || 0) + 1;
    }
    inValues[vin.prevout?.value || Math.random()] =
      (inValues[vin.prevout?.value || Math.random()] || 0) + 1;
  }

  let hasFakePubkey = false;
  for (const vout of tx.vout) {
    switch (vout.scriptpubkey_type) {
      case 'p2pk':
        {
          flags |= TransactionFlags.p2pk;
          // detect fake pubkey (i.e. not a valid DER point on the secp256k1 curve)
          hasFakePubkey =
            hasFakePubkey || !isPoint(vout.scriptpubkey?.slice(2, -2));
        }
        break;
      case 'multisig':
        {
          flags |= TransactionFlags.p2ms;
          // detect fake pubkeys (i.e. not valid DER points on the secp256k1 curve)
          const asm = vout.scriptpubkey_asm;
          for (const key of asm?.split(' ') || []) {
            if (!hasFakePubkey && !key.startsWith('OP_')) {
              hasFakePubkey = hasFakePubkey || isBurnKey(key) || !isPoint(key);
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
      case 'op_return':
        flags |= TransactionFlags.op_return;
        break;
    }
    if (vout.scriptpubkey_address) {
      reusedOutputAddresses[vout.scriptpubkey_address] =
        (reusedOutputAddresses[vout.scriptpubkey_address] || 0) + 1;
    }
    outValues[vout.value || Math.random()] =
      (outValues[vout.value || Math.random()] || 0) + 1;
  }
  if (hasFakePubkey) {
    flags |= TransactionFlags.fake_pubkey;
  }

  // fast but bad heuristic to detect possible coinjoins
  // (at least 5 inputs and 5 outputs, less than half of which are unique amounts, with no address reuse)
  const addressReuse =
    Object.keys(reusedOutputAddresses).reduce(
      (acc, key) =>
        Math.max(
          acc,
          (reusedInputAddresses[key] || 0) + (reusedOutputAddresses[key] || 0)
        ),
      0
    ) > 1;
  if (
    !addressReuse &&
    tx.vin.length >= 5 &&
    tx.vout.length >= 5 &&
    Object.keys(inValues).length + Object.keys(outValues).length <=
      (tx.vin.length + tx.vout.length) / 2
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

  if (isNonStandard(tx, height, network)) {
    flags |= TransactionFlags.nonstandard;
  }

  return flags;
}

/**
 * TODO: I really need to start using https://github.com/bitauth/libauth/blob/60aec23/src/lib/vm/instruction-sets/common/instruction-sets-utils.ts#L780 to get the getDustThreshold
 * See also: https://gitlab.com/bitcoin-cash-node/bitcoin-cash-node/-/blob/master/src/policy/policy.cpp?ref_type=heads#L39
 *
 * "Dust" is defined in terms of dustRelayFee, which has units
 * satoshis-per-kilobyte. If you'd pay more than 1/3 in fees to spend
 * something, then we consider it dust.  A typical spendable txout is 34
 * bytes big, and will need a CTxIn of at least 148 bytes to spend: so dust
 * is a spendable txout less than 546*dustRelayFee/1000 (in satoshis).
 */
function getDustThreshold(scriptpubkey: string): number {
  let dustSize = scriptpubkey.length / 2;
  dustSize += getVarIntLength(dustSize);
  dustSize += 148; // See description above
  return DUST_RELAY_TX_FEE * dustSize;
}

function isDustOutput(value: number, scriptpubkey: string): boolean {
  return value < getDustThreshold(scriptpubkey);
}

// Adapted from mempool backend https://github.com/mempool/mempool/blob/14e49126c3ca8416a8d7ad134a95c5e090324d69/backend/src/api/transaction-utils.ts#L254
// Converts hex bitcoin script to ASM
function convertScriptSigAsm(hex: string): string {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  const b = [];
  let i = 0;

  while (i < buf.length) {
    const op = buf[i];
    if (op >= 0x01 && op <= 0x4e) {
      i++;
      let push;
      if (op === 0x4c) {
        push = buf[i];
        b.push('OP_PUSHDATA1');
        i += 1;
      } else if (op === 0x4d) {
        push = buf[i] | (buf[i + 1] << 8);
        b.push('OP_PUSHDATA2');
        i += 2;
      } else if (op === 0x4e) {
        push =
          buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
        b.push('OP_PUSHDATA4');
        i += 4;
      } else {
        push = op;
        b.push('OP_PUSHBYTES_' + push);
      }

      const data = buf.slice(i, i + push);
      if (data.length !== push) {
        break;
      }

      b.push(uint8ArrayToHexString(data));
      i += data.length;
    } else {
      if (op === 0x00) {
        // Could be either 'OP_0' or 'OP_FALSE'
        b.push('OP_0');
      } else if (op === 0x4f) {
        // This is 'OP_1NEGATE'
        b.push('OP_PUSHNUM_NEG1'); // Rename to OP_PUSHNUM_NEG1
      } else if (op === 0xb1) {
        // This is 'OP_CHECKLOCKTIMEVERIFY'
        b.push('OP_CLTV'); // Rename to OP_CLTV
      } else if (op === 0xb2) {
        // This is 'OP_CHECKSEQUENCEVERIFY'
        b.push('OP_CSV'); // Rename to OP_CSV
      } else {
        const opcode = opcodes[op];
        if (opcode) {
          b.push(opcode);
        } else {
          b.push('OP_RETURN_' + op);
        }
      }
      i += 1;
    }
  }

  return b.join(' ');
}

// Copied from mempool backend https://github.com/mempool/mempool/blob/14e49126c3ca8416a8d7ad134a95c5e090324d69/backend/src/api/transaction-utils.ts#L227
// Fills inner_redeemscript_asm fields of fetched prevouts for decoded transactions
export function addInnerScriptsToVin(vin: Vin): void {
  if (!vin.prevout) {
    return;
  }

  if (vin.prevout.scriptpubkey_type === 'p2sh') {
    const redeemScript = vin.scriptsig_asm.split(' ').reverse()[0];
    vin.inner_redeemscript_asm = convertScriptSigAsm(redeemScript);
  }
}

/**
 * Extracts each pushed data element from a raw scriptsig hex into an array of hex strings,
 * matching the format BCHN returns as scriptsig_byte_code.
 * E.g. P2PKH: [ "<sig+sighash>", "<pubkey>" ]
 */
function extractScriptsigByteCode(scriptsig: string): string[] {
  if (!scriptsig) return [];
  const buf = hexStringToUint8Array(scriptsig);
  const chunks: string[] = [];
  let i = 0;
  while (i < buf.length) {
    const op = buf[i++];
    let len = 0;
    if (op === 0x00) {
      // OP_0 / OP_FALSE — zero-length push, skip
      continue;
    } else if (op >= 0x01 && op <= 0x4b) {
      len = op;
    } else if (op === 0x4c) {
      // OP_PUSHDATA1
      if (i >= buf.length) break;
      len = buf[i++];
    } else if (op === 0x4d) {
      // OP_PUSHDATA2
      if (i + 2 > buf.length) break;
      len = buf[i] | (buf[i + 1] << 8);
      i += 2;
    } else if (op === 0x4e) {
      // OP_PUSHDATA4
      if (i + 4 > buf.length) break;
      len =
        buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
      i += 4;
    } else {
      // Non-push opcode — not expected in standard scriptsigs, stop
      break;
    }
    if (i + len > buf.length) break;
    chunks.push(uint8ArrayToHexString(buf.slice(i, i + len)));
    i += len;
  }
  return chunks;
}

// Adapted from bitcoinjs-lib at https://github.com/bitcoinjs/bitcoinjs-lib/blob/32e08aa57f6a023e955a9a49baddce186ee3ad4daad/ts_src/transaction.ts#L78
/**
 * Derives the sender CashAddr from a standard P2PKH scriptsig (sig + pubkey pushes).
 * Returns a minimal prevout with address info but value: null so fee calc is unaffected.
 * Returns null for coinbase, unsigned, or non-P2PKH inputs.
 */
function deriveAddressFromScriptSig(
  scriptsig: string,
  network: string
): {
  value: null;
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
} | null {
  if (!scriptsig) return null;
  try {
    const buf = hexStringToUint8Array(scriptsig);
    let i = 0;
    let lastPush: Uint8Array | null = null;
    while (i < buf.length) {
      const op = buf[i++];
      if (op === 0) {
        lastPush = new Uint8Array(0);
      } else if (op <= 0x4b) {
        if (i + op > buf.length) return null;
        lastPush = buf.slice(i, i + op);
        i += op;
      } else if (op === 0x4c) {
        if (i >= buf.length) return null;
        const len = buf[i++];
        if (i + len > buf.length) return null;
        lastPush = buf.slice(i, i + len);
        i += len;
      } else if (op === 0x4d) {
        if (i + 2 > buf.length) return null;
        const len = buf[i] | (buf[i + 1] << 8);
        i += 2;
        if (i + len > buf.length) return null;
        lastPush = buf.slice(i, i + len);
        i += len;
      } else {
        return null;
      }
    }
    // P2PKH: last push must be a valid compressed (33 B) or uncompressed (65 B) pubkey
    if (
      lastPush &&
      (lastPush.length === 33 || lastPush.length === 65) &&
      (lastPush[0] === 0x02 || lastPush[0] === 0x03 || lastPush[0] === 0x04)
    ) {
      const sha256d = new Hash().update(lastPush).digest();
      const pubkeyHash = ripemd160(sha256d);
      const pubkeyHashHex = uint8ArrayToHexString(pubkeyHash);
      const scriptpubkey = '76a914' + pubkeyHashHex + '88ac';
      return {
        value: null,
        scriptpubkey,
        scriptpubkey_asm:
          'OP_DUP OP_HASH160 OP_PUSHBYTES_20 ' +
          pubkeyHashHex +
          ' OP_EQUALVERIFY OP_CHECKSIG',
        scriptpubkey_type: 'p2pkh',
        scriptpubkey_address: p2pkh(pubkeyHashHex, network),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Parses a CashToken prefix (CHIP-2022-02) from a raw output script blob.
 * PREFIX_TOKEN = 0xef, followed by 32-byte category ID (little-endian), bitfield, and optional fields.
 * Returns the parsed token fields and the number of bytes consumed (0 if no token prefix present).
 */
function parseCashTokenPrefix(
  data: Uint8Array,
  startOffset: number
): {
  token_category?: string;
  token_nft_capability?: string;
  token_nft_commitment?: string;
  token_amount?: string;
  bytesConsumed: number;
} {
  if (data.length <= startOffset || data[startOffset] !== 0xef) {
    return { bytesConsumed: 0 };
  }
  let p = startOffset + 1; // skip PREFIX_TOKEN byte

  // 32-byte category ID in OP_HASH256 byte order (little-endian); reverse for display
  if (p + 32 > data.length) {
    return { bytesConsumed: 0 };
  }
  const categoryBytes = data.slice(p, p + 32);
  const token_category = uint8ArrayToHexString(
    new Uint8Array(categoryBytes).reverse()
  );
  p += 32;

  if (p >= data.length) {
    return { bytesConsumed: 0 };
  }
  const bitfield = data[p++];

  const HAS_NFT = (bitfield & 0x20) !== 0;
  const HAS_COMMITMENT_LENGTH = (bitfield & 0x40) !== 0;
  const HAS_AMOUNT = (bitfield & 0x10) !== 0;
  const nft_capability_bits = bitfield & 0x0f;

  let token_nft_capability: string | undefined;
  let token_nft_commitment: string | undefined;
  let token_amount: string | undefined;

  if (HAS_NFT) {
    if (nft_capability_bits === 0x00) token_nft_capability = 'none';
    else if (nft_capability_bits === 0x01) token_nft_capability = 'mutable';
    else if (nft_capability_bits === 0x02) token_nft_capability = 'minting';
    else token_nft_capability = 'none';
  }

  if (HAS_COMMITMENT_LENGTH) {
    const [commitLen, afterCommitLen] = readVarInt(data, p);
    p = afterCommitLen;
    if (p + commitLen > data.length) {
      return { bytesConsumed: 0 };
    }
    token_nft_commitment = uint8ArrayToHexString(data.slice(p, p + commitLen));
    p += commitLen;
  }

  if (HAS_AMOUNT) {
    const [ftAmount, afterAmount] = readVarInt(data, p);
    p = afterAmount;
    token_amount = ftAmount.toString();
  }

  return {
    token_category,
    token_nft_capability,
    token_nft_commitment,
    token_amount,
    bytesConsumed: p - startOffset,
  };
}

/**
 * Convert a buffer from a hex string to a transaction object
 * Example is from TX ID: 138dabc52e88eda9760976f8adad5bebb92409be2d1842c345d41e606deae45e
 *
 * Hex raw transaction example: 0100000001bec86c1d8ab6d8ef16a4fa22f1b9a72baada515310caf7cd17f4ab2cfcab7b19080000006b483045022100e7421746f94f61724a6b5a2337121e56ddfc68e146ca72bfb2776de6db94a0470220370bc471c362e6ad337ea5152fd589ca30c42d9f40c55b8108d3ea5aad2b15bf41210208c6b6d97ca3d625fba56b6460bdcceb3e06f5555c1184590b3339c0f5879be1ffffffff0284156a94000000001976a91490f228539519931540f0e1de25dbc0093498c7a588ac46e29800000000001976a91463d690ca9b9a4c91cead49805037c2635473fea488ac00000000
 * Becomes buffer: {"0":1,"1":0,"2":0,"3":0,"4":1,"5":190,"6":200,"7":108,"8":29,"9":138,"10":182,"11":216,"12":239,"13":22,"14":164,"15":250,"16":34,"17":241,"18":185,"19":167,"20":43,"21":170,"22":218,"23":81,"24":83,"25":16,"26":202,"27":247,"28":205,"29":23,"30":244,"31":171,"32":44,"33":252,"34":171,"35":123,"36":25,"37":8,"38":0,"39":0,"40":0,"41":107,"42":72,"43":48,"44":69,"45":2,"46":33,"47":0,"48":231,"49":66,"50":23,"51":70,"52":249,"53":79,"54":97,"55":114,"56":74,"57":107,"58":90,"59":35,"60":55,"61":18,"62":30,"63":86,"64":221,"65":252,"66":104,"67":225,"68":70,"69":202,"70":114,"71":191,"72":178,"73":119,"74":109,"75":230,"76":219,"77":148,"78":160,"79":71,"80":2,"81":32,"82":55,"83":11,"84":196,"85":113,"86":195,"87":98,"88":230,"89":173,"90":51,"91":126,"92":165,"93":21,"94":47,"95":213,"96":137,"97":202,"98":48,"99":196,"100":45,"101":159,"102":64,"103":197,"104":91,"105":129,"106":8,"107":211,"108":234,"109":90,"110":173,"111":43,"112":21,"113":191,"114":65,"115":33,"116":2,"117":8,"118":198,"119":182,"120":217,"121":124,"122":163,"123":214,"124":37,"125":251,"126":165,"127":107,"128":100,"129":96,"130":189,"131":204,"132":235,"133":62,"134":6,"135":245,"136":85,"137":92,"138":17,"139":132,"140":89,"141":11,"142":51,"143":57,"144":192,"145":245,"146":135,"147":155,"148":225,"149":255,"150":255,"151":255,"152":255,"153":2,"154":132,"155":21,"156":106,"157":148,"158":0,"159":0,"160":0,"161":0,"162":25,"163":118,"164":169,"165":20,"166":144,"167":242,"168":40,"169":83,"170":149,"171":25,"172":147,"173":21,"174":64,"175":240,"176":225,"177":222,"178":37,"179":219,"180":192,"181":9,"182":52,"183":152,"184":199,"185":165,"186":136,"187":172,"188":70,"189":226,"190":152,"191":0,"192":0,"193":0,"194":0,"195":0,"196":25,"197":118,"198":169,"199":20,"200":99,"201":214,"202":144,"203":202,"204":155,"205":154,"206":76,"207":145,"208":206,"209":173,"210":73,"211":128,"212":80,"213":55,"214":194,"215":99,"216":84,"217":115,"218":254,"219":164,"220":136,"221":172,"222":0,"223":0,"224":0,"225":0}
 *
 * @param buffer The raw transaction data as a buffer
 * @param network
 * @param inputs Additional information from a PSBT, if available
 * @returns The decoded transaction object and the raw hex
 */
function fromBuffer(
  buffer: Uint8Array,
  network: string,
  inputs?: PsbtKeyValueMap[]
): { tx: Transaction; hex: string; warnings: string[] } {
  let offset = 0;

  // Parse raw transaction
  const tx = {
    status: {
      confirmed: null,
      block_height: null,
      block_hash: null,
      block_time: null,
    },
  } as Transaction;

  [tx.version, offset] = readInt32(buffer, offset);

  let marker, flag;
  [marker, offset] = readInt8(buffer, offset);
  [flag, offset] = readInt8(buffer, offset);

  let isLegacyTransaction = true;
  if (marker === 0x00 && flag === 0x01) {
    isLegacyTransaction = false;
  } else {
    offset -= 2;
  }

  let vinLen;
  [vinLen, offset] = readVarInt(buffer, offset);
  if (vinLen === 0) {
    throw new Error('Transaction has no inputs');
  }
  tx.vin = [];
  for (let i = 0; i < vinLen; ++i) {
    let txid, vout, scriptsig, sequence;
    [txid, offset] = readSlice(buffer, offset, 32);
    txid = uint8ArrayToHexString(txid.reverse());
    [vout, offset] = readInt32(buffer, offset, true);
    [scriptsig, offset] = readVarSlice(buffer, offset);
    scriptsig = uint8ArrayToHexString(scriptsig);
    [sequence, offset] = readInt32(buffer, offset, true);
    const is_coinbase = txid === '0'.repeat(64);
    const scriptsig_asm = convertScriptSigAsm(scriptsig);
    const inner_redeemscript_asm = '';
    // TODO: Parse value, scriptsig_byte_code_pattern, scriptsig_byte_code_data, scriptpubkey, scriptpubkey_asm, scriptpubkey_type, scriptpubkey_address, scriptpubkey_byte_code_pattern, scriptpubkey_byte_code_data
    // Q: Is this even all stored in a raw transaction hex?
    const value = null;
    // const scriptsig_byte_code_pattern = '';
    const scriptsig_byte_code: string[] = is_coinbase
      ? []
      : extractScriptsigByteCode(scriptsig);
    // const scriptpubkey = '';
    // const scriptpubkey_asm = '';
    // const scriptpubkey_type = '';
    // const scriptpubkey_address = '';
    const scriptpubkey_byte_code_pattern = '';
    // const scriptpubkey_byte_code: string[] = [];
    // const token_category = '';
    // const token_amount = 0;
    // const token_nft_capability = '';
    // const token_nft_commitment = '';
    const derivedPrevout = is_coinbase
      ? null
      : deriveAddressFromScriptSig(scriptsig, network);
    tx.vin.push({
      value,
      txid,
      vout,
      is_coinbase,
      scriptsig,
      scriptsig_asm,
      inner_redeemscript_asm,
      // scriptsig_byte_code_pattern,
      scriptsig_byte_code,
      // scriptpubkey,
      // scriptpubkey_asm,
      // scriptpubkey_type,
      // scriptpubkey_address,
      scriptpubkey_byte_code_pattern,
      // scriptpubkey_byte_code,
      sequence,
      prevout: derivedPrevout,
    });
  }

  let voutLen;
  [voutLen, offset] = readVarInt(buffer, offset);
  tx.vout = [];
  for (let i = 0; i < voutLen; ++i) {
    let value, scriptpubkeyArray, scriptpubkey;
    [value, offset] = readInt64(buffer, offset);
    value = Number(value);
    [scriptpubkeyArray, offset] = readVarSlice(buffer, offset);
    const tokenFields = parseCashTokenPrefix(scriptpubkeyArray, 0);
    const lockingScript = scriptpubkeyArray.slice(tokenFields.bytesConsumed);
    scriptpubkey = uint8ArrayToHexString(lockingScript);
    const scriptpubkey_asm = convertScriptSigAsm(scriptpubkey);
    const toAddress = scriptPubKeyToAddress(scriptpubkey, network);
    const scriptpubkey_type = toAddress.type;
    const scriptpubkey_address = toAddress?.address;
    // TODO: scriptpubkey_byte_code_pattern, scriptpubkey_byte_code_data
    // Q: Is this even all stored in a raw transaction hex?
    // const scriptpubkey_byte_code_pattern = '';
    // const scriptpubkey_byte_code: string[] = [];
    const voutEntry: any = {
      value,
      scriptpubkey,
      scriptpubkey_asm,
      scriptpubkey_type,
      scriptpubkey_address,
      // scriptpubkey_byte_code_pattern,
      // scriptpubkey_byte_code,
    };
    if (tokenFields.bytesConsumed > 0) {
      voutEntry.token_category = tokenFields.token_category;
      if (tokenFields.token_nft_capability !== undefined) {
        voutEntry.token_nft_capability = tokenFields.token_nft_capability;
      }
      if (tokenFields.token_nft_commitment !== undefined) {
        voutEntry.token_nft_commitment = tokenFields.token_nft_commitment;
      }
      if (tokenFields.token_amount !== undefined) {
        voutEntry.token_amount = tokenFields.token_amount;
      }
    }
    tx.vout.push(voutEntry);
  }

  [tx.locktime, offset] = readInt32(buffer, offset, true);

  const warnings: string[] = [];
  if (offset !== buffer.length) {
    warnings.push(
      'Transaction has trailing data; the input script may contain extra fields (e.g. unsigned transaction)'
    );
  }

  // Optionally add data from PSBT: prevouts, redeem scripts and signatures
  if (inputs) {
    for (let i = 0; i < tx.vin.length; i++) {
      const vin = tx.vin[i];
      const inputRecords = inputs[i];

      const groups = {
        normalUtxo: inputRecords.get(PSBT_IN.NORMAL_UTXO)?.[0] || null,
        finalScriptSig: inputRecords.get(PSBT_IN.FINAL_SCRIPTSIG)?.[0] || null,
        redeemScript: inputRecords.get(PSBT_IN.REDEEM_SCRIPT)?.[0] || null,
        partialSigs: inputRecords.get(PSBT_IN.PARTIAL_SIG) || [],
      };

      // Fill prevout
      // if (groups.witnessUtxo && !vin.prevout) {
      //   let value,
      //     scriptpubkeyArray,
      //     scriptpubkey,
      //     outputOffset = 0;
      //   [value, outputOffset] = readInt64(
      //     groups.witnessUtxo.value,
      //     outputOffset
      //   );
      //   value = Number(value);
      //   [scriptpubkeyArray, outputOffset] = readVarSlice(
      //     groups.witnessUtxo.value,
      //     outputOffset
      //   );
      //   scriptpubkey = uint8ArrayToHexString(scriptpubkeyArray);
      //   const scriptpubkey_asm = convertScriptSigAsm(scriptpubkey);
      //   const toAddress = scriptPubKeyToAddress(scriptpubkey, network);
      //   const scriptpubkey_type = toAddress.type;
      //   const scriptpubkey_address = toAddress?.address;
      //   vin.prevout = {
      //     value,
      //     scriptpubkey,
      //     scriptpubkey_asm,
      //     scriptpubkey_type,
      //     scriptpubkey_address,
      //   };
      // }
      if (groups.normalUtxo && !vin.prevout) {
        const utxoTx = fromBuffer(groups.normalUtxo.value, network).tx;
        vin.prevout = utxoTx.vout[vin.vout];
      }

      // Fill final scriptSig
      let finalizedScriptSig = false;
      if (groups.finalScriptSig) {
        vin.scriptsig = uint8ArrayToHexString(groups.finalScriptSig.value);
        vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
        finalizedScriptSig = true;
      }
      if (finalizedScriptSig) {
        continue;
      }

      // Fill redeem script
      if (groups.redeemScript && !finalizedScriptSig) {
        const redeemScript = groups.redeemScript.value;
        if (redeemScript.length > 520) {
          throw new Error('Redeem script must be <= 520 bytes');
        }
        let pushOpcode;
        if (redeemScript.length < 0x4c) {
          pushOpcode = new Uint8Array([redeemScript.length]);
        } else if (redeemScript.length <= 0xff) {
          pushOpcode = new Uint8Array([0x4c, redeemScript.length]); // OP_PUSHDATA1
        } else {
          pushOpcode = new Uint8Array([
            0x4d,
            redeemScript.length & 0xff,
            redeemScript.length >> 8,
          ]); // OP_PUSHDATA2
        }
        vin.scriptsig =
          (vin.scriptsig || '') +
          uint8ArrayToHexString(pushOpcode) +
          uint8ArrayToHexString(redeemScript);
        vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
        vin.inner_redeemscript_asm = vin.scriptsig_asm.split(' ').reverse()[0];
      }

      // Fill partial signatures
      for (const record of groups.partialSigs) {
        const signature = record.value;
        const scriptpubkey_type = vin.prevout?.scriptpubkey_type;
        if (scriptpubkey_type === 'multisig' && !finalizedScriptSig) {
          if (signature.length > 74) {
            throw new Error('Signature must be <= 74 bytes');
          }
          const pushOpcode = new Uint8Array([signature.length]);
          vin.scriptsig =
            uint8ArrayToHexString(pushOpcode) +
            uint8ArrayToHexString(signature) +
            (vin.scriptsig || '');
          vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
        }
        if (scriptpubkey_type === 'p2sh') {
          if (!finalizedScriptSig) {
            if (signature.length > 74) {
              throw new Error('Signature must be <= 74 bytes');
            }
            const pushOpcode = new Uint8Array([signature.length]);
            vin.scriptsig =
              uint8ArrayToHexString(pushOpcode) +
              uint8ArrayToHexString(signature) +
              (vin.scriptsig || '');
            vin.scriptsig_asm = convertScriptSigAsm(vin.scriptsig);
          }
        }
      }
    }
  }

  // Calculate final size and txid
  const rawHex = serializeTransaction(tx);
  tx.size = rawHex.length;
  tx.txid = txid(tx);
  return { tx, hex: uint8ArrayToHexString(rawHex), warnings };
}

export type PsbtKeyValue = { keyData: Uint8Array; value: Uint8Array };
type PsbtKeyValueMap = Map<number, PsbtKeyValue[]>;

// TODO: This is different for BCH for sure, we need to update this
const PSBT_IN = {
  NORMAL_UTXO: 0x00,
  // WITNESS_UTXO: 0x01,
  PARTIAL_SIG: 0x02,
  REDEEM_SCRIPT: 0x04,
  WITNESS_SCRIPT: 0x05,
  BIP32_DERIVATION: 0x06,
  FINAL_SCRIPTSIG: 0x07,
};

// PSBT_OUT was only TAP root related, and is removed for now.

/**
 * Decodes a PSBT buffer into the unsigned raw transaction and input/output maps
 * @param psbtBuffer
 * @returns
 *   - the unsigned transaction from a PSBT
 *   - the full input map for each input
 *   - the full output map for each output
 */
function decodePsbt(psbtBuffer: Uint8Array): {
  rawTx: Uint8Array;
  inputs: PsbtKeyValueMap[];
  outputs: PsbtKeyValueMap[];
} {
  let offset = 0;

  // magic: "psbt" in ASCII
  const expectedMagic = [0x70, 0x73, 0x62, 0x74];
  for (let i = 0; i < expectedMagic.length; i++) {
    if (psbtBuffer[offset + i] !== expectedMagic[i]) {
      throw new Error('Invalid PSBT magic bytes');
    }
  }
  offset += expectedMagic.length;

  const separator = psbtBuffer[offset];
  offset += 1;
  if (separator !== 0xff) {
    throw new Error('Invalid PSBT separator');
  }

  // GLOBAL MAP
  let rawTx: Uint8Array | null = null;
  while (offset < psbtBuffer.length) {
    const [keyLen, newOffset] = readVarInt(psbtBuffer, offset);
    offset = newOffset;
    // key length of 0 means the end of the global map
    if (keyLen === 0) {
      break;
    }
    const key = psbtBuffer.slice(offset, offset + keyLen);
    offset += keyLen;
    const [valLen, newOffset2] = readVarInt(psbtBuffer, offset);
    offset = newOffset2;
    const value = psbtBuffer.slice(offset, offset + valLen);
    offset += valLen;

    // Global key type 0x00 holds the unsigned transaction.
    if (key[0] === 0x00) {
      rawTx = value;
    }
  }

  if (!rawTx) {
    throw new Error('Unsigned transaction not found in PSBT');
  }

  const readMaps = (
    count: number,
    startOffset: number
  ): { map: PsbtKeyValueMap[]; offset: number } => {
    const map: PsbtKeyValueMap[] = [];
    let offset = startOffset;

    for (let i = 0; i < count; i++) {
      const records: PsbtKeyValueMap = new Map();
      const seenKeys = new Set<string>();
      while (offset < psbtBuffer.length) {
        const [keyLen, newOffset] = readVarInt(psbtBuffer, offset);
        offset = newOffset;
        if (keyLen === 0) {
          break;
        }
        const key = psbtBuffer.slice(offset, offset + keyLen);
        offset += keyLen;

        const keyHex = uint8ArrayToHexString(key);
        if (seenKeys.has(keyHex)) {
          throw new Error('Duplicate key in map');
        }
        seenKeys.add(keyHex);

        const [valLen, newOffset2] = readVarInt(psbtBuffer, offset);
        offset = newOffset2;
        const value = psbtBuffer.slice(offset, offset + valLen);
        offset += valLen;

        const [keyType, keyDataOffset] = readVarInt(key, 0);
        const bucket = records.get(keyType) || [];
        bucket.push({ keyData: key.slice(keyDataOffset), value });
        records.set(keyType, bucket);
      }
      map.push(records);
    }

    return { map, offset };
  };

  let numInputs: number;
  let numOutputs: number;
  let txOffset = 0;
  // Skip version (4 bytes)
  txOffset += 4;
  const [inputCount, newTxOffset] = readVarInt(rawTx, txOffset);
  txOffset = newTxOffset;
  numInputs = inputCount;
  for (let i = 0; i < numInputs; i++) {
    txOffset += 32; // prev txid
    txOffset += 4; // vout
    const [scriptLength, scriptOffset] = readVarInt(rawTx, txOffset);
    txOffset = scriptOffset;
    txOffset += scriptLength;
    txOffset += 4; // sequence
  }
  const [outputCount, _] = readVarInt(rawTx, txOffset);
  numOutputs = outputCount;

  // INPUT MAPS
  const inputMaps = readMaps(numInputs, offset);
  offset = inputMaps.offset;
  const inputs = inputMaps.map;

  // OUTPUT MAPS
  const outputMaps = readMaps(numOutputs, offset);
  const outputs = outputMaps.map;

  return { rawTx, inputs, outputs };
}

/**
 * Encodes an unsigned transaction and input/output data into a PSBT buffer
 * @param rawTx - The unsigned transaction as Uint8Array
 * @param inputs - Array of input maps containing key-value pairs for each input
 * @param outputs - Array of output maps containing key-value pairs for each output
 * @returns PSBT buffer as Uint8Array
 */
function encodePsbt(
  rawTx: Uint8Array,
  inputs: PsbtKeyValueMap[],
  outputs: PsbtKeyValueMap[]
): Uint8Array {
  const result: number[] = [];

  // Magic bytes: "psbt" in ASCII
  result.push(0x70, 0x73, 0x62, 0x74);

  // Separator
  result.push(0xff);

  const writeKeyValue = (
    keyType: number,
    keyData: Uint8Array,
    value: Uint8Array
  ): void => {
    const keyTypeBytes = varIntToBytes(keyType);
    const keyLength = keyTypeBytes.length + keyData.length;
    result.push(...varIntToBytes(keyLength));
    result.push(...keyTypeBytes);
    result.push(...keyData);
    result.push(...varIntToBytes(value.length));
    result.push(...value);
  };

  const writeMap = (records: PsbtKeyValueMap): void => {
    for (const [keyType, items] of records) {
      for (const record of items) {
        writeKeyValue(keyType, record.keyData, record.value);
      }
    }
    result.push(0x00);
  };

  // GLOBAL MAP
  // Add unsigned transaction (key type 0x00)
  writeKeyValue(0x00, new Uint8Array(), rawTx);

  // End global map
  result.push(0x00);

  // INPUT MAPS
  for (const inputMap of inputs) {
    writeMap(inputMap);
  }

  // OUTPUT MAPS
  for (const outputMap of outputs) {
    writeMap(outputMap);
  }

  return new Uint8Array(result);
}

export type TxCheck = (tx: Transaction) => CheckResult;
export type CheckResult = {
  passed: boolean;
  label: string;
};

export const TX_CHECKS = {
  fee:
    (expected: number): TxCheck =>
    (tx) => {
      const feeKnown = tx.fee !== undefined;
      const passed = feeKnown && tx.fee === expected;
      let label: string;
      if (!feeKnown) {
        label = `Can't calculate tx fee, expected ${expected} sats`;
      } else if (passed) {
        label = `Fee: ${expected} sats`;
      } else {
        label = `Fee: ${tx.fee} sats, expected ${expected} sats`;
      }
      return { label, passed };
    },
  input:
    (index: number, expected: Pick<Vin, 'txid' | 'vout'>): TxCheck =>
    (tx) => {
      const input = tx.vin[index];
      if (!input) {
        return { label: `Input #${index} is missing`, passed: false };
      }

      const passed =
        input.txid === expected.txid && input.vout === expected.vout;
      let label = `Input #${index}: ${input.txid.slice(0, 20)}...:${input.vout}`;
      if (!passed) {
        label += `, expected ${expected.txid.slice(0, 20)}...:${expected.vout}`;
      }
      return { label, passed };
    },
  outputValue:
    (index: number, expected: number): TxCheck =>
    (tx) => {
      const output = tx.vout[index];
      if (!output) {
        return { label: `Output #${index} is missing`, passed: false };
      }

      const passed = output.value === expected;
      let label = `Output #${index} value: ${output.value} sats`;
      if (!passed) {
        label += `, expected ${expected} sats`;
      }
      return { passed, label };
    },
  outputScriptPubKey:
    (index: number, expected: string): TxCheck =>
    (tx) => {
      const output = tx.vout[index];
      if (!output) {
        return { label: `Output #${index} is missing`, passed: false };
      }

      const passed = output.scriptpubkey === expected;
      let label = `Output #${index} scriptPubKey: ${output.scriptpubkey.slice(0, 20)}...`;
      if (!passed) {
        label += `, expected ${expected.slice(0, 20)}...`;
      }
      return { passed, label };
    },
  outputScriptPubKeyAsm:
    (index: number, expected: string): TxCheck =>
    (tx) => {
      const output = tx.vout[index];
      if (!output) {
        return { label: `Output #${index} is missing`, passed: false };
      }

      const passed = output.scriptpubkey_asm === expected;
      let label = `Output #${index} scriptPubKey: ${output.scriptpubkey_asm.slice(0, 20)}...`;
      if (!passed) {
        label += `, expected ${expected.slice(0, 20)}...`;
      }
      return { passed, label };
    },
  outputAddress:
    (index: number, expected: string): TxCheck =>
    (tx) => {
      const output = tx.vout[index];
      if (!output) {
        return { label: `Output #${index} is missing`, passed: false };
      }

      const passed = output.scriptpubkey_address === expected;
      let label = `Output #${index} address: ${output.scriptpubkey_address}`;
      if (!passed) {
        label += `, expected ${expected}`;
      }
      return { passed, label };
    },
  sequence:
    (index: number, expected: number): TxCheck =>
    (tx) => {
      const input = tx.vin[index];
      if (!input) {
        return { label: `Input #${index} is missing`, passed: false };
      }

      const passed = input.sequence === expected;
      let label = `Input #${index} sequence: 0x${input.sequence.toString(16).padStart(8, '0')}`;
      if (!passed) {
        label += `, expected 0x${expected.toString(16).padStart(8, '0')}`;
      }
      return { label, passed };
    },
  locktime:
    (expected: number): TxCheck =>
    (tx) => {
      const locktime = tx.locktime;
      const passed = locktime === expected;
      let label = `Locktime: ${locktime}`;
      if (!passed) {
        label += `, expected ${expected}`;
      }
      return { passed, label };
    },
  version:
    (expected: number): TxCheck =>
    (tx) => {
      const version = tx.version;
      const passed = version === expected;
      let label = `Version: ${version}`;
      if (!passed) {
        label += `, expected ${expected}`;
      }
      return { passed, label };
    },
  inputSignature:
    (index: number, expected: SighashValue[]): TxCheck =>
    (tx) => {
      const input = tx.vin[index];
      const signatures = processInputSignatures(input);
      const sighashes = Array.from(
        new Set(signatures.map((sigInfo) => sigInfo.sighash))
      );
      const passed =
        signatures.length > 0 &&
        sighashes.every((sighash) => expected.includes(sighash));
      const actualSighash = sighashes
        .map((sighash) => SighashLabels[sighash] || `UNKNOWN(${sighash})`)
        .join(' or ');

      let label = `Input #${index}:`;
      if (signatures.length === 0) {
        label += ' no signatures found';
      } else if (passed) {
        label += ` signed with ${actualSighash}`;
      } else {
        label += ` signed with ${actualSighash}, expected ${expected.map((s) => SighashLabels[s]).join(' or ')}`;
      }
      return { label, passed };
    },
};

export function decodeRawTransaction(
  input: string,
  network: string
): { tx: Transaction; hex: string; psbt?: string; warnings: string[] } {
  const buffer = convertTextToBuffer(input);

  if (
    buffer[0] === 0x70 &&
    buffer[1] === 0x73 &&
    buffer[2] === 0x62 &&
    buffer[3] === 0x74
  ) {
    // PSBT magic bytes
    const { rawTx, inputs } = decodePsbt(buffer);
    return {
      ...fromBuffer(rawTx, network, inputs),
      psbt: uint8ArrayToHexString(buffer),
    };
  }

  try {
    return fromBuffer(buffer, network);
  } catch (e) {
    // Retry stripping 8-byte embedded input values (BCH unsigned tx format)
    return fromBufferWithInputValues(buffer, network);
  }
}

/**
 * Parses a raw transaction where each input has an extra 8-byte value field
 * appended after the sequence (BCH unsigned tx / sighash preimage format).
 * Strips those bytes and delegates to fromBuffer, adding a warning.
 */
function fromBufferWithInputValues(
  buffer: Uint8Array,
  network: string
): { tx: Transaction; hex: string; warnings: string[] } {
  let offset = 0;
  const clean: number[] = [];
  // token data extracted per-input (index → token fields) for later merging into prevouts
  const inputTokenData: Map<
    number,
    ReturnType<typeof parseCashTokenPrefix>
  > = new Map();

  // version (4 bytes)
  if (offset + 4 > buffer.length) {
    throw new Error('Cannot read slice out of bounds');
  }
  clean.push(...buffer.slice(offset, offset + 4));
  offset += 4;

  const [vinLen, afterVinLen] = readVarInt(buffer, offset);
  clean.push(...varIntToBytes(vinLen));
  offset = afterVinLen;

  for (let i = 0; i < vinLen; i++) {
    // txid (32) + vout (4)
    if (offset + 36 > buffer.length) {
      throw new Error('Cannot read slice out of bounds');
    }
    clean.push(...buffer.slice(offset, offset + 36));
    offset += 36;

    // scriptsig (varint-prefixed)
    const [scriptLen, afterScript] = readVarInt(buffer, offset);
    clean.push(...varIntToBytes(scriptLen));
    offset = afterScript;
    if (offset + scriptLen > buffer.length) {
      throw new Error('Cannot read slice out of bounds');
    }
    clean.push(...buffer.slice(offset, offset + scriptLen));
    offset += scriptLen;

    // sequence (4 bytes)
    if (offset + 4 > buffer.length) {
      throw new Error('Cannot read slice out of bounds');
    }
    clean.push(...buffer.slice(offset, offset + 4));
    offset += 4;

    // embedded input value (8 bytes in unsigned tx format)
    if (offset + 8 > buffer.length) {
      throw new Error('Cannot read slice out of bounds');
    }
    const valueLow =
      buffer[offset] |
      (buffer[offset + 1] << 8) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 24);
    const valueHigh =
      buffer[offset + 4] |
      (buffer[offset + 5] << 8) |
      (buffer[offset + 6] << 16) |
      (buffer[offset + 7] << 24);
    const valueUnsigned = (valueHigh >>> 0) * 0x100000000 + (valueLow >>> 0);
    offset += 8;

    // Detect extended unsigned tx format: sentinel value >= 0xfffffffffffffff0
    // Lower nibble 0x0f = extension version 0, meaning a real value + optional token data follow
    if (valueUnsigned >= 0xfffffffffffffff0) {
      // read real satoshi value (varint)
      const [_realValue, afterValue] = readVarInt(buffer, offset);
      offset = afterValue;
      // read wrapped token data (varint-prefixed slice)
      const [tokenSliceLen, afterSliceLen] = readVarInt(buffer, offset);
      offset = afterSliceLen;
      if (offset + tokenSliceLen > buffer.length) {
        throw new Error('Cannot read slice out of bounds');
      }
      const tokenSlice = buffer.slice(offset, offset + tokenSliceLen);
      offset += tokenSliceLen;
      // first byte should be 0xef (PREFIX_TOKEN), rest is token data
      if (tokenSlice.length > 0 && tokenSlice[0] === 0xef) {
        const tokenFields = parseCashTokenPrefix(tokenSlice, 0);
        if (tokenFields.bytesConsumed > 0) {
          inputTokenData.set(i, tokenFields);
        }
      }
    }
  }

  // copy remainder (vout count + outputs + locktime)
  clean.push(...buffer.slice(offset));

  const result = fromBuffer(new Uint8Array(clean), network);

  // Merge extracted input token data into prevouts
  for (const [idx, tokenFields] of inputTokenData) {
    const vin = result.tx.vin[idx];
    if (vin) {
      if (!vin.prevout) {
        (vin as any).prevout = {};
      }
      (vin.prevout as any).token_category = tokenFields.token_category;
      if (tokenFields.token_nft_capability !== undefined) {
        (vin.prevout as any).token_nft_capability =
          tokenFields.token_nft_capability;
      }
      if (tokenFields.token_nft_commitment !== undefined) {
        (vin.prevout as any).token_nft_commitment =
          tokenFields.token_nft_commitment;
      }
      if (tokenFields.token_amount !== undefined) {
        (vin.prevout as any).token_amount = tokenFields.token_amount;
      }
    }
  }

  result.warnings.push(
    'Input script contains extra fields (unsigned transaction); signature is missing or invalid'
  );
  return result;
}

function serializeCashTokenPrefix(output: any): number[] {
  if (!output.token_category) {
    return [];
  }
  const prefix: number[] = [];
  prefix.push(0xef); // PREFIX_TOKEN
  // category id: stored as display hex (big-endian), must be written reversed (little-endian)
  prefix.push(...hexStringToUint8Array(output.token_category).reverse());
  const hasNft = output.token_nft_capability !== undefined;
  const hasCommitment =
    hasNft &&
    output.token_nft_commitment !== undefined &&
    output.token_nft_commitment.length > 0;
  const hasAmount =
    output.token_amount !== undefined && output.token_amount !== '0';
  let bitfield = 0x00;
  if (hasNft) bitfield |= 0x20;
  if (hasCommitment) bitfield |= 0x40;
  if (hasAmount) bitfield |= 0x10;
  if (hasNft) {
    const cap = output.token_nft_capability;
    if (cap === 'mutable') bitfield |= 0x01;
    else if (cap === 'minting') bitfield |= 0x02;
  }
  prefix.push(bitfield);
  if (hasCommitment) {
    const commitBytes = hexStringToUint8Array(output.token_nft_commitment);
    prefix.push(...varIntToBytes(commitBytes.length));
    prefix.push(...commitBytes);
  }
  if (hasAmount) {
    prefix.push(...varIntToBytes(Number(output.token_amount)));
  }
  return prefix;
}

function serializeTransaction(tx: Transaction): Uint8Array {
  const result: number[] = [];

  // Add version
  result.push(...intToBytes(tx.version, 4));

  // Add input count and inputs
  result.push(...varIntToBytes(tx.vin.length));
  for (const input of tx.vin) {
    result.push(...hexStringToUint8Array(input.txid).reverse());
    result.push(...intToBytes(input.vout, 4));
    const scriptSig = hexStringToUint8Array(input.scriptsig);
    result.push(...varIntToBytes(scriptSig.length));
    result.push(...scriptSig);
    result.push(...intToBytes(input.sequence, 4));
  }

  // Add output count and outputs
  result.push(...varIntToBytes(tx.vout.length));
  for (const output of tx.vout) {
    result.push(...bigIntToBytes(BigInt(output.value), 8));
    const tokenPrefixBytes = serializeCashTokenPrefix(output);
    const scriptPubKey = hexStringToUint8Array(output.scriptpubkey);
    result.push(
      ...varIntToBytes(tokenPrefixBytes.length + scriptPubKey.length)
    );
    result.push(...tokenPrefixBytes);
    result.push(...scriptPubKey);
  }

  // Add locktime
  result.push(...intToBytes(tx.locktime, 4));

  return new Uint8Array(result);
}

function txid(tx: Transaction): string {
  const serializedTx = serializeTransaction(tx);
  const hash1 = new Hash().update(serializedTx).digest();
  const hash2 = new Hash().update(hash1).digest();
  return uint8ArrayToHexString(hash2.reverse());
}

export function createMessageSigningPsbt(
  utxo: Utxo,
  scriptPubKey: string,
  addressType: AddressType,
  address: string,
  message: string,
  feeRate: number,
  fallbackFee: number,
  sequence: number,
  locktime: number,
  normalUtxoHex?: string
): string {
  const opReturnScript = buildOpReturnScript(message);

  // Build transaction
  const tx = {
    version: 2,
    vin: [
      {
        txid: utxo.txid,
        vout: utxo.vout,
        is_coinbase: false,
        scriptsig: '',
        scriptsig_asm: '',
        sequence: sequence,
        prevout: {
          value: utxo.value,
          scriptpubkey: scriptPubKey,
          scriptpubkey_asm: null,
          scriptpubkey_type: addressType,
          scriptpubkey_address: address,
        },
      },
    ],
    vout: [
      {
        value: 0,
        scriptpubkey: opReturnScript.script,
        scriptpubkey_asm: 'OP_RETURN ' + opReturnScript.dataHex,
        scriptpubkey_type: 'op_return',
        scriptpubkey_address: undefined,
      },
      {
        value: utxo.value, // fee will be estimated and subtracted later
        scriptpubkey: scriptPubKey,
        scriptpubkey_asm: null,
        scriptpubkey_type: addressType,
        scriptpubkey_address: address,
      },
    ],
    locktime: locktime,
  } as Transaction;

  // Estimate fee
  let rawTx = serializeTransaction(tx);
  let fee = fallbackFee;
  const { bytes } = fillUnsignedInput(tx.vin[0]);
  if (bytes) {
    let finalSize = rawTx.length + bytes;
    fee = Math.ceil(finalSize * feeRate);
  }
  const dustThreshold = getDustThreshold(tx.vout[1].scriptpubkey);
  // console.log(`Estimated fee: ${fee} sats, dust threshold: ${dustThreshold} sats`);
  // console.log(`Output value before fee: ${tx.vout[1].value} sats`);
  if (tx.vout[1].value < fee + dustThreshold) {
    throw new Error(
      `Output value is under dust threshold of ${dustThreshold} sats`
    );
  }
  tx.vout[1].value -= fee;

  // Build PSBT
  rawTx = serializeTransaction(tx);
  const inputRecords: PsbtKeyValueMap = new Map<number, PsbtKeyValue[]>();
  if (normalUtxoHex) {
    inputRecords.set(PSBT_IN.NORMAL_UTXO, [
      {
        keyData: new Uint8Array(),
        value: hexStringToUint8Array(normalUtxoHex.trim()),
      },
    ]);
  }

  const inputs: PsbtKeyValueMap[] = [inputRecords];
  const outputs: PsbtKeyValueMap[] = Array.from(
    { length: tx.vout.length },
    () => new Map<number, PsbtKeyValue[]>()
  );
  const psbt = uint8ArrayToBase64(encodePsbt(rawTx, inputs, outputs));
  return psbt;
}

function buildOpReturnScript(messageText: string): {
  script: string;
  dataHex: string;
} {
  const messageBytes = new TextEncoder().encode(messageText);
  if (messageBytes.length > MAX_OP_RETURN_RELAY) {
    throw new Error(
      `Message too long, max supported size is ${MAX_OP_RETURN_RELAY} bytes.`
    );
  }
  const dataHex = uint8ArrayToHexString(messageBytes);
  const len = messageBytes.length;
  const pushData: number[] = [];

  if (len <= 0x4b) {
    pushData.push(len);
  } else if (len <= 0xff) {
    pushData.push(0x4c, len);
  } else if (len <= 0xffff) {
    pushData.push(0x4d, len & 0xff, (len >> 8) & 0xff);
  } else if (len <= 0xffffffff) {
    pushData.push(
      0x4e,
      len & 0xff,
      (len >> 8) & 0xff,
      (len >> 16) & 0xff,
      (len >> 24) & 0xff
    );
  }

  const scriptBytes = [0x6a, ...pushData, ...Array.from(messageBytes)];
  return {
    script: uint8ArrayToHexString(new Uint8Array(scriptBytes)),
    dataHex,
  };
}

// Copied from explorer backend https://gitlab.melroy.org/bitcoincash/bitcoin-cash-explorer/-/blob/main/backend/src/api/transaction-utils.ts?ref_type=heads#L196
export function countSigops(transaction: Transaction): number {
  let sigops = 0;

  for (const input of transaction.vin) {
    if (input.scriptsig_asm) {
      sigops += countScriptSigops(input.scriptsig_asm, true);
    }
    if (input.prevout) {
      switch (true) {
        case input.prevout.scriptpubkey_type === 'p2sh' &&
          input.scriptsig &&
          input.scriptsig.startsWith('160014'):
        case input.prevout?.scriptpubkey_type === 'p2sh' &&
          input.scriptsig &&
          input.scriptsig.startsWith('220020'):
        case input.prevout.scriptpubkey_type === 'p2sh':
          if (input.inner_redeemscript_asm) {
            sigops += countScriptSigops(input.inner_redeemscript_asm);
          }
          break;
      }
    }
  }

  for (const output of transaction.vout) {
    if (output.scriptpubkey_asm) {
      sigops += countScriptSigops(output.scriptpubkey_asm, true);
    }
  }

  return sigops;
}

export function scriptPubKeyToAddress(
  scriptPubKey: string,
  network: string
): { address: string; type: string } {
  // Safety guard: strip an accidentally un-stripped CashToken prefix (0xef + 32-byte category + bitfield...)
  // This should not normally happen since fromBuffer now strips the prefix before calling this function.
  if (scriptPubKey.startsWith('ef') && scriptPubKey.length >= 68) {
    const tokenFields = parseCashTokenPrefix(
      hexStringToUint8Array(scriptPubKey),
      0
    );
    if (tokenFields.bytesConsumed > 0) {
      scriptPubKey = scriptPubKey.slice(tokenFields.bytesConsumed * 2);
    }
  }
  // P2PKH
  if (/^76a914[0-9a-f]{40}88ac$/.test(scriptPubKey)) {
    return {
      address: p2pkh(scriptPubKey.substring(6, 6 + 40), network),
      type: 'p2pkh',
    };
  }
  // P2PK
  if (
    /^21[0-9a-f]{66}ac$/.test(scriptPubKey) ||
    /^41[0-9a-f]{130}ac$/.test(scriptPubKey)
  ) {
    return { address: null, type: 'p2pk' };
  }
  // P2SH
  if (/^a914[0-9a-f]{40}87$/.test(scriptPubKey)) {
    return {
      address: p2sh(scriptPubKey.substring(4, 4 + 40), network),
      type: 'p2sh',
    };
  }
  // P2SH32 (CHIP-2022-05, activated May 2023)
  if (/^aa20[0-9a-f]{64}87$/.test(scriptPubKey)) {
    return {
      address: p2sh32(scriptPubKey.substring(4, 4 + 64), network),
      type: 'p2sh32',
    };
  }
  // multisig
  if (/^[0-9a-f]+ae$/.test(scriptPubKey)) {
    return { address: null, type: 'multisig' };
  }
  // anchor
  if (scriptPubKey === '51024e73') {
    return { address: p2a(network), type: 'anchor' };
  }
  // op_return
  if (/^6a/.test(scriptPubKey)) {
    return { address: null, type: 'op_return' };
  }
  return { address: null, type: 'unknown' };
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
function checkSigopsBIP54(
  tx: Transaction,
  limit: number = MAX_TX_LEGACY_SIGOPS
): boolean {
  let sigops = 0;
  for (const input of tx.vin) {
    if (input.scriptsig_asm) {
      sigops += countScriptSigops(input.scriptsig_asm);
    }
    if (input.prevout) {
      // P2SH redeem script
      if (
        input.prevout.scriptpubkey_type === 'p2sh' &&
        input.inner_redeemscript_asm
      ) {
        sigops += countScriptSigops(input.inner_redeemscript_asm);
      } else {
        // prevout scriptpubkey
        sigops += countScriptSigops(input.prevout.scriptpubkey_asm);
      }
    }

    if (sigops > limit) {
      return false;
    }
  }
  return true;
}

function p2pkh(pubKeyHash: string, network: string): string {
  const isTestnet = ['testnet4', 'scalenet', 'chipnet'].includes(network);
  const prefix = isTestnet ? 'bchtest' : 'bitcoincash';
  const hashBytes = hexStringToUint8Array(pubKeyHash);
  return cashaddrEncode(prefix, 0x00, hashBytes);
}

function p2sh(scriptHash: string, network: string): string {
  const isTestnet = ['testnet4', 'scalenet', 'chipnet'].includes(network);
  const prefix = isTestnet ? 'bchtest' : 'bitcoincash';
  const hashBytes = hexStringToUint8Array(scriptHash);
  return cashaddrEncode(prefix, 0x08, hashBytes);
}

function p2sh32(scriptHash: string, network: string): string {
  const isTestnet = ['testnet4', 'scalenet', 'chipnet'].includes(network);
  const prefix = isTestnet ? 'bchtest' : 'bitcoincash';
  const hashBytes = hexStringToUint8Array(scriptHash);
  return cashaddrEncode(prefix, 0x0b, hashBytes);
}

function p2a(network: string): string {
  const pubkeyHashArray = hexStringToUint8Array('4e73');
  const hrp = ['testnet4', 'scalenet', 'chipnet'].includes(network)
    ? 'tb'
    : 'bc';
  const version = 1;
  const words = [version].concat(toWords(pubkeyHashArray));
  const bech32Address = bech32Encode(hrp, words, 'bech32m');
  return bech32Address;
}

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// base58 encoding
function base58Encode(data: Uint8Array): string {
  const hexString = Array.from(data)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  let num = BigInt('0x' + hexString);

  let encoded = '';
  while (num > 0) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  for (const byte of data) {
    if (byte === 0) {
      encoded = '1' + encoded;
    } else {
      break;
    }
  }

  return encoded;
}

// base58 decoding
function base58Decode(s: string): Uint8Array {
  let num = BigInt(0);
  const base = BigInt(58);

  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Invalid base58 character');
    }
    num = num * base + BigInt(index);
  }

  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;

  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }

  for (let i = 0; i < s.length && s[i] === '1'; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

function base58ToSpk(address: string, network: string): string | null {
  try {
    const decoded = base58Decode(address);
    if (decoded.length !== 25) {
      return null;
    }
    const version = decoded[0];
    const payload = decoded.slice(1, 21);
    const checksum = decoded.slice(21, 25);

    // Verify checksum
    const versionedPayload = new Uint8Array([version, ...payload]);
    const hash1 = new Hash().update(versionedPayload).digest();
    const hash2 = new Hash().update(hash1).digest();
    const expectedChecksum = hash2.slice(0, 4);
    if (checksum.length !== expectedChecksum.length) {
      return null;
    }
    for (let i = 0; i < checksum.length; i++) {
      if (checksum[i] !== expectedChecksum[i]) {
        return null;
      }
    }

    console.log('ok?');
    const payloadHex = uint8ArrayToHexString(payload);

    // P2PKH
    const p2pkhVersion = ['testnet4', 'scalenet', 'chipnet'].includes(network)
      ? 0x6f
      : 0x00;
    if (version === p2pkhVersion) {
      return '76a914' + payloadHex + '88ac';
    }

    // P2SH
    const p2shVersion = ['testnet4', 'scalenet', 'chipnet'].includes(network)
      ? 0xc4
      : 0x05;
    if (version === p2shVersion) {
      return 'a914' + payloadHex + '87';
    }
  } catch (e) {
    // Invalid base58
  }
  return null;
}

// bech32 encoding / decoding
// Adapted from https://github.com/bitcoinjs/bech32/blob/5ceb0e3d4625561a459c85643ca6947739b2d83c/src/index.ts
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
type Bech32Encoding = 'bech32' | 'bech32m';

function bech32Encode(
  prefix: string,
  words: number[],
  encoding: Bech32Encoding = 'bech32'
): string {
  const constant = encoding === 'bech32m' ? 0x2bc830a3 : 1;
  const checksum = createChecksum(prefix, words, constant);
  const combined = words.concat(checksum);
  let result = prefix + '1';
  for (let i = 0; i < combined.length; ++i) {
    result += BECH32_ALPHABET.charAt(combined[i]);
  }
  return result;
}

/* Decodes a *valid* bech32 or bech32m encoded address into its prefix and payload */
function bech32Decode(address: string): {
  prefix: string;
  words: number[];
  encoding: Bech32Encoding;
} {
  const normalized = address.toLowerCase();
  const separator = normalized.lastIndexOf('1');
  const prefix = normalized.slice(0, separator);
  const encodedWords = normalized.slice(separator + 1);
  const words: number[] = [];
  for (let i = 0; i < encodedWords.length; i++) {
    words.push(BECH32_ALPHABET.indexOf(encodedWords.charAt(i)));
  }

  const polymod = bech32Polymod(prefix, words);
  let encoding: Bech32Encoding;
  if (polymod === 1) {
    encoding = 'bech32';
  } else if (polymod === 0x2bc830a3) {
    encoding = 'bech32m';
  } else {
    throw new Error('Invalid bech32 checksum');
  }

  return { prefix, words: words.slice(0, -6), encoding };
}

function bech32ToSpk(address: string, network: string): string | null {
  const expectedHrp = ['testnet4', 'scalenet', 'chipnet'].includes(network)
    ? 'tb'
    : 'bc';
  try {
    const decoded = bech32Decode(address);
    if (decoded.prefix !== expectedHrp) {
      return null;
    }
    const version = decoded.words[0];
    const data = fromWords(decoded.words.slice(1));
    const versionOpcode =
      version === 0 ? '00' : (version + 0x50).toString(16).padStart(2, '0');
    const pushLen = data.length.toString(16).padStart(2, '0');
    return versionOpcode + pushLen + uint8ArrayToHexString(data);
  } catch (e) {
    // Invalid bech32 address
  }
  return null;
}

export function hexStringToUint8Array(hex: string): Uint8Array {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return buf;
}

// Helper functions needed by transaction.utils.ts
export function uint8ArrayToHexString(uint8Array: Uint8Array): string {
  return Array.from(uint8Array)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxV = (1 << toBits) - 1;

  for (let i = 0; i < data.length; ++i) {
    const value = data[i];
    if (value < 0 || value >> fromBits) {
      throw new Error('Invalid value');
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxV);
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxV);
    }
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxV) {
    throw new Error('Invalid data');
  }
  return ret;
}

function toWords(bytes) {
  return convertBits(bytes, 8, 5, true);
}

function fromWords(words: number[]) {
  return new Uint8Array(convertBits(words, 5, 8, false));
}

function bech32Polymod(prefix: string, words: number[]): number {
  let chk = prefixChk(prefix);
  for (let i = 0; i < words.length; ++i) {
    chk = polymodStep(chk) ^ words[i];
  }
  return chk;
}

function polymodStep(pre) {
  const GENERATORS = [
    0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
  ];
  const b = pre >> 25;
  return (
    ((pre & 0x1ffffff) << 5) ^
    ((b & 1 ? GENERATORS[0] : 0) ^
      (b & 2 ? GENERATORS[1] : 0) ^
      (b & 4 ? GENERATORS[2] : 0) ^
      (b & 8 ? GENERATORS[3] : 0) ^
      (b & 16 ? GENERATORS[4] : 0))
  );
}

function prefixChk(prefix) {
  let chk = 1;
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    chk = polymodStep(chk) ^ (c >> 5);
  }
  chk = polymodStep(chk);
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    chk = polymodStep(chk) ^ (c & 0x1f);
  }
  return chk;
}

function createChecksum(prefix: string, words: number[], constant: number) {
  const POLYMOD_CONST = constant;
  let chk = prefixChk(prefix);
  for (let i = 0; i < words.length; ++i) {
    const x = words[i];
    chk = polymodStep(chk) ^ x;
  }
  for (let i = 0; i < 6; ++i) {
    chk = polymodStep(chk);
  }
  chk ^= POLYMOD_CONST;

  const checksum = [];
  for (let i = 0; i < 6; ++i) {
    checksum.push((chk >> (5 * (5 - i))) & 31);
  }
  return checksum;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  return new Uint8Array([...binaryString].map((char) => char.charCodeAt(0)));
}

function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binaryString);
}

function intToBytes(value: number, byteLength: number): number[] {
  const bytes = [];
  for (let i = 0; i < byteLength; i++) {
    bytes.push((value >> (8 * i)) & 0xff);
  }
  return bytes;
}

function bigIntToBytes(value: bigint, byteLength: number): number[] {
  const bytes = [];
  for (let i = 0; i < byteLength; i++) {
    bytes.push(Number((value >> BigInt(8 * i)) & 0xffn));
  }
  return bytes;
}

function varIntToBytes(value: number | bigint): number[] {
  const bytes = [];

  if (typeof value === 'number') {
    if (value < 0xfd) {
      bytes.push(value);
    } else if (value <= 0xffff) {
      bytes.push(0xfd, value & 0xff, (value >> 8) & 0xff);
    } else if (value <= 0xffffffff) {
      bytes.push(0xfe, ...intToBytes(value, 4));
    }
  } else {
    if (value < 0xfdn) {
      bytes.push(Number(value));
    } else if (value <= 0xffffn) {
      bytes.push(0xfd, Number(value & 0xffn), Number((value >> 8n) & 0xffn));
    } else if (value <= 0xffffffffn) {
      bytes.push(0xfe, ...intToBytes(Number(value), 4));
    } else {
      bytes.push(0xff, ...bigIntToBytes(value, 8));
    }
  }

  return bytes;
}

function readInt8(buffer: Uint8Array, offset: number): [number, number] {
  if (offset + 1 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  return [buffer[offset], offset + 1];
}

function readInt16(buffer: Uint8Array, offset: number): [number, number] {
  if (offset + 2 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  return [buffer[offset] | (buffer[offset + 1] << 8), offset + 2];
}

function readInt32(
  buffer: Uint8Array,
  offset: number,
  unsigned: boolean = false
): [number, number] {
  if (offset + 4 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  const value =
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24);
  return [unsigned ? value >>> 0 : value, offset + 4];
}

function readInt64(buffer: Uint8Array, offset: number): [bigint, number] {
  if (offset + 8 > buffer.length) {
    throw new Error('Buffer out of bounds');
  }
  const low = BigInt(
    buffer[offset] |
      (buffer[offset + 1] << 8) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 24)
  );
  const high = BigInt(
    buffer[offset + 4] |
      (buffer[offset + 5] << 8) |
      (buffer[offset + 6] << 16) |
      (buffer[offset + 7] << 24)
  );
  return [(high << 32n) | (low & 0xffffffffn), offset + 8];
}

function readVarInt(buffer: Uint8Array, offset: number): [number, number] {
  const [first, newOffset] = readInt8(buffer, offset);

  if (first < 0xfd) {
    return [first, newOffset];
  } else if (first === 0xfd) {
    return readInt16(buffer, newOffset);
  } else if (first === 0xfe) {
    return readInt32(buffer, newOffset, true);
  } else if (first === 0xff) {
    const [bigValue, nextOffset] = readInt64(buffer, newOffset);

    if (bigValue > Number.MAX_SAFE_INTEGER) {
      throw new Error('VarInt exceeds safe integer range');
    }

    const numValue = Number(bigValue);
    return [numValue, nextOffset];
  } else {
    throw new Error('Invalid VarInt prefix');
  }
}

function readSlice(
  buffer: Uint8Array,
  offset: number,
  n: number | bigint
): [Uint8Array, number] {
  const length = Number(n);
  if (offset + length > buffer.length) {
    throw new Error('Cannot read slice out of bounds');
  }
  const slice = buffer.slice(offset, offset + length);
  return [slice, offset + length];
}

function readVarSlice(
  buffer: Uint8Array,
  offset: number
): [Uint8Array, number] {
  const [length, newOffset] = readVarInt(buffer, offset);
  return readSlice(buffer, newOffset, length);
}

function readVector(
  buffer: Uint8Array,
  offset: number
): [Uint8Array[], number] {
  const [count, newOffset] = readVarInt(buffer, offset);
  let updatedOffset = newOffset;
  const vector: Uint8Array[] = [];

  for (let i = 0; i < count; i++) {
    const [slice, nextOffset] = readVarSlice(buffer, updatedOffset);
    vector.push(slice);
    updatedOffset = nextOffset;
  }

  return [vector, updatedOffset];
}

// SHA256(SHA256(tag) || SHA256(tag) || dataHex)
export function taggedHash(tag: string, dataHex: string): string {
  const encoder = new TextEncoder();
  const tagHash = hash(encoder.encode(tag));
  return uint8ArrayToHexString(
    hash(
      new Uint8Array([
        ...tagHash,
        ...tagHash,
        ...hexStringToUint8Array(dataHex),
      ])
    )
  );
}

export function compactSize(n: number): Uint8Array {
  if (n <= 252) {
    return new Uint8Array([n]);
  } else if (n <= 0xffff) {
    return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
  } else if (n <= 0xffffffff) {
    return new Uint8Array([
      0xfe,
      n & 0xff,
      (n >> 8) & 0xff,
      (n >> 16) & 0xff,
      (n >> 24) & 0xff,
    ]);
  } else {
    const buffer = new Uint8Array(9);
    buffer[0] = 0xff;
    let num = BigInt(n);
    for (let i = 1; i <= 8; i++) {
      buffer[i] = Number(num & BigInt(0xff));
      num >>= BigInt(8);
    }
    return buffer;
  }
}

// Inversed the opcodes object from https://gitlab.melroy.org/bitcoincash/bitcoin-cash-explorer/-/blob/main/backend/src/utils/bitcoin-script.ts?ref_type=heads
const opcodes = {
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

export function convertTextToBuffer(input: string): Uint8Array {
  if (!input.length) {
    throw new Error('Empty input');
  }

  let buffer: Uint8Array;
  if (input.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(input)) {
    buffer = hexStringToUint8Array(input);
  } else if (
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)|[A-Za-z0-9+/]{3}=)?$/.test(
      input
    )
  ) {
    buffer = base64ToUint8Array(input);
  } else {
    throw new Error('Invalid input: not hex or base64');
  }
  return buffer;
}
