import { ScriptInfo } from '@app/shared/script.utils';
import { Vin, Vout } from '@app/interfaces/backend-api.interface';
import {
  BASE58_CHARS,
  HEX_CHARS,
  CASHADDR_CHARS,
} from '@app/shared/regex.utils';
import { hash, Hash } from '@app/shared/sha256';

export type AddressType =
  | 'fee'
  | 'empty'
  | 'provably_unspendable'
  | 'op_return'
  | 'multisig'
  | 'p2pk'
  | 'p2pkh'
  | 'p2sh'
  | 'p2s'
  | 'p2sh32'
  | 'anchor'
  | 'unknown';

type NetworkConfig = {
  base58: {
    pubkey: string[];
    script: string | string[];
  };
  bech32: string;
  bch: string;
};

const ADDRESS_PREFIXES: Record<string, NetworkConfig> = {
  mainnet: {
    base58: {
      pubkey: ['1'],
      script: ['3'],
    },
    bech32: 'bc1',
    bch: 'bitcoincash:',
  },
  testnet4: {
    base58: {
      pubkey: ['m', 'n'],
      script: '2',
    },
    bech32: 'tb1',
    bch: 'bchtest:',
  },
  scalenet: {
    base58: {
      pubkey: ['m', 'n'],
      script: '2',
    },
    bech32: 'tb1',
    bch: 'bchtest:',
  },
  chipnet: {
    base58: {
      pubkey: ['m', 'n'],
      script: '2',
    },
    bech32: 'tb1',
    bch: 'bchtest:',
  },
};

// precompiled regexes for common address types (excluding prefixes)
const base58Regex = RegExp('^' + BASE58_CHARS + '{26,34}$');
const cashaddrRegex = RegExp('^' + CASHADDR_CHARS + '{20,100}$');
const pubkeyRegex = RegExp(
  '^' + `(04${HEX_CHARS}{128})|(0[23]${HEX_CHARS}{64})$`
);

export function detectAddressType(
  address: string,
  network: string
): AddressType {
  network = network || 'mainnet';
  const networkConfig = ADDRESS_PREFIXES[network];

  if (!networkConfig) {
    return 'unknown';
  }

  // Check for BCH CashAddr addresses (with or without prefix)
  let cashaddrInput: string | null = null;
  if (address.startsWith(networkConfig.bch)) {
    const suffix = address.slice(networkConfig.bch.length);
    if (cashaddrRegex.test(suffix)) {
      cashaddrInput = address;
    }
  } else if (cashaddrRegex.test(address)) {
    cashaddrInput = networkConfig.bch + address;
  }

  if (cashaddrInput !== null) {
    try {
      const decoded = cashaddrDecode(cashaddrInput);
      const typeBits = (decoded.version >>> 3) & 0x0f;
      // typeBits 0 = p2pkh, 2 = p2pkh-with-tokens
      if (typeBits === 0 || typeBits === 2) return 'p2pkh';
      // typeBits 1 = p2sh, 3 = p2sh-with-tokens
      if (typeBits === 1 || typeBits === 3) return 'p2sh';
    } catch {
      // fall through to unknown
    }
  }

  // Legacy address types
  const firstChar = address.substring(0, 1);
  if (
    networkConfig.base58.pubkey.includes(firstChar) &&
    base58Regex.test(address.slice(1))
  ) {
    return 'p2pkh';
  } else if (
    (Array.isArray(networkConfig.base58.script)
      ? networkConfig.base58.script.includes(firstChar)
      : networkConfig.base58.script === firstChar) &&
    base58Regex.test(address.slice(1))
  ) {
    return 'p2sh';
  }

  // Legacy p2pk
  if (pubkeyRegex.test(address)) {
    return 'p2pk';
  }
  return 'unknown';
}

/**
 * Parses & classifies address types + properties from address strings
 *
 * can optionally augment this data with examples of spends from the address,
 * e.g. to classify revealed scripts for scripthash-type addresses.
 */
export class AddressTypeInfo {
  network: string;
  address: string;
  type: AddressType;
  // script data
  scripts: Map<string, ScriptInfo>; // raw script
  // flags
  isMultisig?: { m: number; n: number };
  tapscript?: boolean;
  simplicity?: boolean;

  constructor(
    network: string,
    address: string,
    type?: AddressType,
    vin?: Vin[],
    vout?: Vout
  ) {
    this.network = network;
    this.address = address;
    this.scripts = new Map();
    if (type) {
      this.type = type;
    } else {
      this.type = detectAddressType(address, network);
    }
    this.processInputs(vin);
    if (vout) {
      this.processOutput(vout);
    }
  }

  public clone(): AddressTypeInfo {
    const cloned = new AddressTypeInfo(this.network, this.address, this.type);
    cloned.scripts = new Map(
      Array.from(this.scripts, ([key, value]) => [key, value?.clone()])
    );
    cloned.isMultisig = this.isMultisig;
    cloned.tapscript = this.tapscript;
    cloned.simplicity = this.simplicity;
    return cloned;
  }

  public processInputs(vin: Vin[] = [], vinIds: string[] = []): void {
    // for single-script types, if we've seen one input we've seen them all
    if (['p2sh'].includes(this.type)) {
      if (!this.scripts.size && vin.length) {
        const v = vin[0];
        if (v.inner_redeemscript_asm) {
          this.processScript(
            new ScriptInfo(
              'inner_redeemscript',
              undefined,
              v.inner_redeemscript_asm
            )
          );
        } else if (v.scriptsig || v.scriptsig_asm) {
          this.processScript(
            new ScriptInfo('scriptsig', v.scriptsig, v.scriptsig_asm)
          );
        }
      }
    } else if (this.type === 'multisig') {
      if (vin.length) {
        const v = vin[0];
        this.processScript(
          new ScriptInfo(
            'scriptpubkey',
            v.prevout.scriptpubkey,
            v.prevout.scriptpubkey_asm
          )
        );
      }
    } else if (this.type === 'unknown') {
      for (const v of vin) {
        if (v.prevout?.scriptpubkey === '51024e73') {
          this.type = 'anchor';
        }
      }
    }
    // and there's nothing more to learn from processing inputs for other types
  }

  public processOutput(output: Vout): void {
    if (this.type === 'multisig') {
      if (!this.scripts.size) {
        this.processScript(
          new ScriptInfo(
            'scriptpubkey',
            output.scriptpubkey,
            output.scriptpubkey_asm
          )
        );
      }
    } else if (this.type === 'unknown') {
      if (output.scriptpubkey === '51024e73') {
        this.type = 'anchor';
      }
    }
  }

  public compareTo(other: AddressTypeInfo): AddressSimilarityResult {
    return compareAddresses(this.address, other.address, this.network);
  }

  public compareToString(other: string): AddressSimilarityResult {
    if (other === this.address) {
      return { status: 'identical' };
    }
    const otherInfo = new AddressTypeInfo(this.network, other);
    return this.compareTo(otherInfo);
  }

  public processScript(script: ScriptInfo): boolean {
    if (this.scripts.has(script.key)) {
      return false;
    }
    this.scripts.set(script.key, script);
    if (script.template?.type === 'multisig') {
      this.isMultisig = { m: script.template['m'], n: script.template['n'] };
    }
    return true;
  }
}

export interface AddressMatch {
  prefix: string;
  postfix: string;
}

export interface AddressSimilarity {
  status: 'comparable';
  score: number;
  left: AddressMatch;
  right: AddressMatch;
}
export type AddressSimilarityResult =
  | { status: 'identical' }
  | { status: 'incomparable' }
  | AddressSimilarity;

export const ADDRESS_SIMILARITY_THRESHOLD = 1_000_000; // 1 false positive per ~1 million comparisons

function fuzzyPrefixMatch(
  a: string,
  b: string,
  rtl: boolean = false
): { score: number; matchA: string; matchB: string } {
  let score = 0;
  let gap = false;
  let done = false;

  let ai = 0;
  let bi = 0;
  let prefixA = '';
  let prefixB = '';
  if (rtl) {
    a = a.split('').reverse().join('');
    b = b.split('').reverse().join('');
  }

  let discounted = false;
  while (ai < a.length && bi < b.length && !done) {
    if (a[ai] === b[bi]) {
      // matching characters
      prefixA += a[ai];
      prefixB += b[bi];
      if (discounted) {
        score += 0.5;
      } else {
        score++;
      }
      discounted = false;
      ai++;
      bi++;
    } else if (!gap) {
      // try looking ahead in both strings to find the best match
      const nextMatchA = ai + 1 < a.length && a[ai + 1] === b[bi];
      const nextMatchB = bi + 1 < b.length && a[ai] === b[bi + 1];
      const nextMatchBoth =
        ai + 1 < a.length && bi + 1 < b.length && a[ai + 1] === b[bi + 1];
      if (nextMatchBoth) {
        // single differing character
        prefixA += a[ai];
        prefixB += b[bi];
        ai++;
        bi++;
      } else if (nextMatchA) {
        // character missing in b
        prefixA += a[ai];
        ai++;
      } else if (nextMatchB) {
        // character missing in a
        prefixB += b[bi];
        bi++;
      } else {
        ai++;
        bi++;
      }
      gap = true;
      discounted = true;
    } else {
      done = true;
    }
  }

  if (rtl) {
    prefixA = prefixA.split('').reverse().join('');
    prefixB = prefixB.split('').reverse().join('');
  }

  return { score, matchA: prefixA, matchB: prefixB };
}

export function compareAddressInfo(
  a: AddressTypeInfo,
  b: AddressTypeInfo
): AddressSimilarityResult {
  if (a.address === b.address) {
    return { status: 'identical' };
  }
  if (a.type !== b.type) {
    return { status: 'incomparable' };
  }
  if (!['p2pkh', 'p2sh'].includes(a.type)) {
    return { status: 'incomparable' };
  }
  const isCashAddr =
    ['p2pkh', 'p2sh'].includes(a.type) && cashaddrRegex.test(a.address);
  const isLegacyBase58 = !isCashAddr;

  const left = fuzzyPrefixMatch(a.address, b.address);
  const right = fuzzyPrefixMatch(a.address, b.address, true);
  // depending on address type, some number of matching prefix characters are guaranteed
  let prefixScore: number;
  if (isLegacyBase58) {
    prefixScore = 1;
  } else {
    // CashAddr: account for the 'bitcoincash:' (or 'bchtest:') prefix + first type character
    const bchPrefix = ADDRESS_PREFIXES[a.network || 'mainnet']?.bch;
    prefixScore = (a.address.startsWith(bchPrefix) ? bchPrefix.length : 0) + 1;
  }

  // add the two scores together
  const totalScore = left.score + right.score - prefixScore;

  // adjust for the size of the alphabet (58 for legacy base58, 32 for CashAddr base32)
  const alphabetSize = isLegacyBase58 ? 58 : 32;
  const normalizedScore = Math.pow(alphabetSize, totalScore);

  return {
    status: 'comparable',
    score: normalizedScore,
    left: {
      prefix: left.matchA,
      postfix: right.matchA,
    },
    right: {
      prefix: left.matchB,
      postfix: right.matchB,
    },
  };
}

export function compareAddresses(
  a: string,
  b: string,
  network: string
): AddressSimilarityResult {
  if (a === b) {
    return { status: 'identical' };
  }
  const aInfo = new AddressTypeInfo(network, a);
  return aInfo.compareToString(b);
}

// avoids the overhead of creating AddressTypeInfo objects for each address,
// but a and b *MUST* be valid normalized addresses, of the same valid type
export function checkedCompareAddressStrings(
  a: string,
  b: string,
  type: AddressType,
  network: string
): AddressSimilarityResult {
  return compareAddressInfo(
    { address: a, type: type, network: network } as AddressTypeInfo,
    { address: b, type: type, network: network } as AddressTypeInfo
  );
}

export function normalizeBchAddress(address: string): string {
  // Remove bitcoin: prefix for legacy base58 addresses (keep bitcoincash: prefix)
  if (address.startsWith('bitcoin:')) {
    return address.replace('bitcoin:', '');
  }
  return address;
}

// CashAddr constants
// Note: CashAddr uses the same base32 alphabet as bech32
// Source: https://github.com/ealmansi/cashaddrjs/blob/master/src/base32.js
const CASHADDR_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// CashAddr polymod uses 40-bit arithmetic — must use BigInt to avoid JS overflow
// Source: https://github.com/ealmansi/cashaddrjs/blob/master/src/cashaddr.js
const CASHADDR_GENERATORS = [
  0x98f2bc8e61n,
  0x79b76d99e2n,
  0xf33e5fb3c4n,
  0xae2eabe2a8n,
  0x1e4f43e470n,
];

// Source: https://github.com/ealmansi/cashaddrjs/blob/master/src/cashaddr.js
function cashAddrPolymod(v: number[]): bigint {
  let c = 1n;
  for (const d of v) {
    const topBits = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let j = 0; j < 5; j++) {
      if ((topBits >> BigInt(j)) & 1n) {
        c ^= CASHADDR_GENERATORS[j];
      }
    }
  }
  return c ^ 1n;
}

// Source: https://github.com/ealmansi/cashaddrjs/blob/master/src/cashaddr.js
function maskCashAddrPrefix(prefix: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < prefix.length; i++) {
    result.push(prefix.charCodeAt(i) & 0x1f);
  }
  return result;
}

// Helper functions
function uint8ArrayToHexString(uint8Array: Uint8Array): string {
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

function fromWords(words: number[]) {
  return new Uint8Array(convertBits(words, 5, 8, false));
}

// CashAddr encoding/decoding for Bitcoin Cash
// Based on: https://github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md
function cashaddrDecode(address: string): {
  prefix: string;
  version: number;
  hash: Uint8Array;
} {
  // Remove prefix if present
  let prefix = '';
  let addr = address;
  const colonIndex = address.indexOf(':');
  if (colonIndex !== -1) {
    prefix = address.slice(0, colonIndex);
    addr = address.slice(colonIndex + 1);
  } else {
    // Default to bitcoincash for addresses without prefix
    prefix = 'bitcoincash';
  }

  // Convert to lowercase
  addr = addr.toLowerCase();

  // Decode base32
  const words: number[] = [];
  for (let i = 0; i < addr.length; i++) {
    const char = addr.charAt(i);
    const index = CASHADDR_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid CashAddr character');
    }
    words.push(index);
  }

  // Validate checksum using the CashAddr polymod
  const checksumInput = [...maskCashAddrPrefix(prefix), 0, ...words];
  if (cashAddrPolymod(checksumInput) !== 0n) {
    throw new Error('Invalid CashAddr checksum');
  }

  // Remove checksum (last 8 characters)
  const dataWords = words.slice(0, -8);

  // Convert from 5-bit to 8-bit
  const data = new Uint8Array(convertBits(dataWords, 5, 8, false));

  // Extract version byte and hash
  if (data.length < 1) {
    throw new Error('Invalid CashAddr data');
  }

  const version = data[0];
  const hash = data.slice(1);

  return { prefix, version, hash };
}

// Based on: https://github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md
export function cashaddrEncode(
  prefix: string,
  version: number,
  hash: Uint8Array
): string {
  const payloadData = Uint8Array.from([version, ...hash]);
  const payloadWords = convertBits(Array.from(payloadData), 8, 5, true);

  const checksumInput = [
    ...maskCashAddrPrefix(prefix),
    0,
    ...payloadWords,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  let checksum = cashAddrPolymod(checksumInput);
  const checksumWords: number[] = [];
  for (let i = 0; i < 8; ++i) {
    checksumWords.push(Number(checksum & 31n));
    checksum >>= 5n;
  }
  checksumWords.reverse();

  const allWords = [...payloadWords, ...checksumWords];
  let result = '';
  for (let i = 0; i < allWords.length; i++) {
    result += CASHADDR_ALPHABET.charAt(allWords[i]);
  }
  return `${prefix}:${result}`;
}

// Based on: https://github.com/paytaca/bitcoincash-explorer/blob/eb0d613dd245a93624914536340db6bd04cf3e4b/app/utils/addressFormat.ts
export function convertToTokenAddress(address: string): string | null {
  try {
    const decoded = cashaddrDecode(address);
    const typeBits = (decoded.version >>> 3) & 0x0f;
    const lengthBits = decoded.version & 0x07;

    let tokenTypeBits: number;
    if (typeBits === 0) {
      tokenTypeBits = 2;
    } else if (typeBits === 1) {
      tokenTypeBits = 3;
    } else {
      return null;
    }

    const tokenVersion = (tokenTypeBits << 3) | lengthBits;
    const hadPrefix = address.includes(':');
    const encoded = cashaddrEncode(decoded.prefix, tokenVersion, decoded.hash);
    return hadPrefix ? encoded : encoded.split(':')[1];
  } catch (e) {
    return null;
  }
}

export function isTokenAddress(address: string): boolean {
  try {
    const decoded = cashaddrDecode(
      address.includes(':') ? address : `bitcoincash:${address}`
    );
    const typeBits = (decoded.version >>> 3) & 0x0f;
    return typeBits === 2 || typeBits === 3;
  } catch {
    return false;
  }
}

export function tokenToCashAddr(address: string): string | null {
  try {
    const decoded = cashaddrDecode(
      address.includes(':') ? address : `bitcoincash:${address}`
    );
    const typeBits = (decoded.version >>> 3) & 0x0f;
    const lengthBits = decoded.version & 0x07;

    let normalTypeBits: number;
    if (typeBits === 2) {
      normalTypeBits = 0;
    } else if (typeBits === 3) {
      normalTypeBits = 1;
    } else {
      return null;
    }

    const normalVersion = (normalTypeBits << 3) | lengthBits;
    const hadPrefix = address.includes(':');
    const encoded = cashaddrEncode(decoded.prefix, normalVersion, decoded.hash);
    return hadPrefix ? encoded : encoded.split(':')[1];
  } catch (e) {
    return null;
  }
}

/**
 * Cash Address to Script Public key (SPK)
 * @param address
 * @returns SPK
 */
function cashaddrToSpk(address: string): string | null {
  try {
    const decoded = cashaddrDecode(address);
    const typeBits = (decoded.version >>> 3) & 0x0f;
    const hashHex = uint8ArrayToHexString(decoded.hash);

    // typeBits 0 = p2pkh, 2 = p2pkh-with-tokens — same scriptPubKey
    if (typeBits === 0 || typeBits === 2) {
      return '76a914' + hashHex + '88ac';
    }

    // typeBits 1 = p2sh, 3 = p2sh-with-tokens — same scriptPubKey
    if (typeBits === 1 || typeBits === 3) {
      return 'a914' + hashHex + '87';
    }

    return null;
  } catch (e) {
    return null;
  }
}

function base58Decode(address: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  let leadingZeros = 0;

  for (const char of address) {
    const value = BigInt(alphabet.indexOf(char));
    if (value === -1n) {
      throw new Error('Invalid base58 character');
    }
    num = num * 58n + value;
  }

  for (const char of address) {
    if (char === '1') {
      leadingZeros++;
    } else {
      break;
    }
  }

  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num = num / 256n;
  }

  for (let i = 0; i < leadingZeros; i++) {
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

function p2a(network: string): string {
  const hrp = ['testnet4', 'scalenet', 'chipnet'].includes(network)
    ? 'tb'
    : 'bc';
  const pubkeyHashArray = hexStringToUint8Array('4e73');
  const version = 1;
  const words = [version].concat(toWords(pubkeyHashArray));
  const bech32Address = bech32Encode(hrp, words, 'bech32m');
  return bech32Address;
}

// bech32 encoding / decoding
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
    ((b & 0x01 ? GENERATORS[0] : 0) ^
      (b & 0x02 ? GENERATORS[1] : 0) ^
      (b & 0x04 ? GENERATORS[2] : 0) ^
      (b & 0x08 ? GENERATORS[3] : 0) ^
      (b & 0x10 ? GENERATORS[4] : 0))
  );
}

function prefixChk(prefix) {
  let chk = 1;
  for (let i = 0; i < prefix.length; ++i) {
    chk = polymodStep(chk) ^ (prefix.charCodeAt(i) & 0x1f);
  }
  return polymodStep(chk);
}

function createChecksum(
  prefix: string,
  words: number[],
  constant: number
): number[] {
  const values = [
    ...prefix
      .toLowerCase()
      .split('')
      .map((c) => c.charCodeAt(0) & 0x1f),
    0,
    ...words,
  ];
  const polymod = bech32Polymod(prefix, values.concat([0, 0, 0, 0, 0, 0]));
  return (polymod ^ constant)
    .toString(16)
    .match(/.{2}/g)
    .map((hex) => parseInt(hex, 16));
}

function toWords(bytes) {
  return convertBits(bytes, 8, 5, true);
}

function hexStringToUint8Array(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return result;
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }
  let result = '';
  while (num > 0n) {
    const remainder = num % 58n;
    num = num / 58n;
    result = alphabet[Number(remainder)] + result;
  }
  for (const byte of bytes) {
    if (byte === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }
  return result;
}

export function legacyToCashAddr(address: string, network?: string): string {
  const net = network || 'mainnet';
  const decoded = base58Decode(address);
  if (decoded.length !== 25) {
    throw new Error('Invalid legacy address length');
  }
  const version = decoded[0];
  const payload = decoded.slice(1, 21);
  const checksum = decoded.slice(21, 25);

  const versionedPayload = new Uint8Array([version, ...payload]);
  const hash1 = new Hash().update(versionedPayload).digest();
  const hash2 = new Hash().update(hash1).digest();
  const expectedChecksum = hash2.slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expectedChecksum[i]) {
      throw new Error('Invalid legacy address checksum');
    }
  }

  const isTestnet = ['testnet4', 'scalenet', 'chipnet'].includes(net);
  const p2pkhVersion = isTestnet ? 0x6f : 0x00;
  const p2shVersion = isTestnet ? 0xc4 : 0x05;
  const prefix = isTestnet ? 'bchtest' : 'bitcoincash';

  let cashAddrVersionByte: number;
  if (version === p2pkhVersion) {
    cashAddrVersionByte = 0x00;
  } else if (version === p2shVersion) {
    cashAddrVersionByte = 0x08;
  } else {
    throw new Error('Unrecognised legacy address version byte');
  }

  return cashaddrEncode(prefix, cashAddrVersionByte, payload);
}

export function cashAddrToLegacy(address: string, network?: string): string {
  const net = network || 'mainnet';
  const isTestnet = ['testnet4', 'scalenet', 'chipnet'].includes(net);
  const prefix = isTestnet ? 'bchtest' : 'bitcoincash';

  const normalized = address.includes(':') ? address : `${prefix}:${address}`;
  const decoded = cashaddrDecode(normalized);
  const typeBits = (decoded.version >>> 3) & 0x0f;

  let legacyVersionByte: number;
  if (typeBits === 0 || typeBits === 2) {
    legacyVersionByte = isTestnet ? 0x6f : 0x00;
  } else if (typeBits === 1 || typeBits === 3) {
    legacyVersionByte = isTestnet ? 0xc4 : 0x05;
  } else {
    throw new Error('Unsupported CashAddr type');
  }

  const payload = new Uint8Array([legacyVersionByte, ...decoded.hash]);
  const hash1 = new Hash().update(payload).digest();
  const hash2 = new Hash().update(hash1).digest();
  const checksum = hash2.slice(0, 4);
  const full = new Uint8Array([...payload, ...checksum]);
  return base58Encode(full);
}

// Main function to convert address to scriptPubKey
export function addressToScriptPubKey(
  address: string,
  network: string
): { scriptPubKey: string | null; type: AddressType } {
  const type = detectAddressType(address, network);

  if (type === 'p2pk') {
    if (address.length === 66) {
      return { scriptPubKey: '21' + address + 'ac', type };
    }
    if (address.length === 130) {
      return { scriptPubKey: '41' + address + 'ac', type };
    }
    return { scriptPubKey: null, type };
  }

  if (type === 'p2pkh' || type === 'p2sh') {
    // Check if it's a CashAddr address (BCH base32 format)
    const bchPrefix = ADDRESS_PREFIXES[network || 'mainnet']?.bch;
    if (
      cashaddrRegex.test(address) ||
      (bchPrefix && address.startsWith(bchPrefix))
    ) {
      return { scriptPubKey: cashaddrToSpk(address), type };
    }
    // Fall back to base58 for legacy addresses
    return { scriptPubKey: base58ToSpk(address, network), type };
  }

  if (address === p2a(network)) {
    return { scriptPubKey: bech32ToSpk(address, network), type };
  }

  return { scriptPubKey: null, type };
}
