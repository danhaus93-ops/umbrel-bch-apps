import config from '../config';
import { IDifficultyAdjustment } from '../mempool.interfaces';
import blocks from './blocks';

export interface DifficultyAdjustment {
  scheduleOffsetSeconds: number; // seconds ahead(+) or behind(-) ideal schedule
  difficultyDriftPercent: number; // next-block % difficulty change (assuming 600s block)
  currentBits: string; // current block bits (hex)
  nextBits: string; // predicted next block bits (hex)
  timeAvg: number; // avg block time over recent 8 blocks (ms)
}

// --- ASERT (aserti3-2d) functions ---
// Ported from: https://gist.github.com/A60AB5450353F40E/5607d5aeb9ba0e84a71ab8f55ebdd2ad

const ASERT_ANCHOR_IDEAL_BLOCK_TIME = 600;

interface AsertAnchor {
  bits: string;
  tick: number; // anchor_height * 600
  timestamp: number; // previous block timestamp at anchor
  tau: number; // half-life in seconds
}

// Per-network ASERT anchor parameters from BCHN chainparams.cpp
// scalenet has no hard-coded anchor (periodic reorgs); mainnet anchor used as proxy
const ASERT_ANCHORS: Record<string, AsertAnchor> = {
  mainnet: { bits: '1804dafe', tick: 396988200, timestamp: 1605447844, tau: 172800 },
  testnet4: { bits: '1d00ffff', tick: 10106400, timestamp: 1605451779, tau: 3600 },
  chipnet: { bits: '1d00ffff', tick: 10106400, timestamp: 1605451779, tau: 3600 },
  scalenet: { bits: '1804dafe', tick: 396988200, timestamp: 1605447844, tau: 172800 },
};

function bitsToTarget(bits: string): number {
  const exponent = parseInt(bits.slice(0, 2), 16);
  const mantissa = parseInt(bits.slice(2), 16);
  return mantissa * Math.pow(2, (exponent - 3) * 8);
}

function targetToBits(target: number): string {
  if (target === 0) {
    return '00000000';
  }

  let exponent = Math.floor(Math.log2(target) / 8) + 1;
  let mantissa = Math.floor(target / Math.pow(2, (exponent - 3) * 8));

  if (mantissa > 0x7fffff) {
    mantissa = Math.floor(mantissa / 256);
    exponent++;
  }

  return exponent.toString(16).padStart(2, '0') + mantissa.toString(16).padStart(6, '0');
}

function calculateTarget(
  heightTick: number,
  timestamp: number,
  anchor: AsertAnchor,
  nextTargetBlockTime: number = 600
): number {
  const anchorTarget = bitsToTarget(anchor.bits);

  const tickDelta = heightTick - anchor.tick;
  const timeDelta = timestamp - anchor.timestamp;

  const t = Math.trunc;
  const base = t(((timeDelta - (tickDelta + ASERT_ANCHOR_IDEAL_BLOCK_TIME)) * 65536) / anchor.tau);
  const hi = t(base / 65536) + (base < 0 ? -1 : 0);
  const lo = base - hi * 65536;

  return (
    (t((195766423245049 * lo + 971821376 * lo ** 2 + 5127 * lo ** 3 + 140737488355328) / 2 ** 48) + 65536) *
    t(ASERT_ANCHOR_IDEAL_BLOCK_TIME / nextTargetBlockTime) *
    anchorTarget *
    2 ** (hi - 16)
  );
}

function calculateTargetLegacy(
  height: number,
  timestamp: number,
  anchor: AsertAnchor,
  nextTargetBlockTime: number = 600
): number {
  return calculateTarget(height * 600, timestamp, anchor, nextTargetBlockTime);
}

// function numericBitsToHex(bits: number): string {
//   return bits.toString(16).padStart(8, '0');
// }

// --- End ASERT functions ---

/**
 * Returns the ASERT anchor block height for the given network.
 *
 * @param {string} network - Network name (e.g. 'mainnet', 'testnet4', 'chipnet', 'scalenet').
 * @returns {number} The anchor block height derived from the network's anchor tick.
 */
export function getAsertAnchorHeight(network: string): number {
  const anchor = ASERT_ANCHORS[network] ?? ASERT_ANCHORS.mainnet;
  return Math.floor(anchor.tick / ASERT_ANCHOR_IDEAL_BLOCK_TIME); // Eg. 661647 for mainnet
}

/**
 * Calculate the difficulty increase/decrease by using the `bits` integer contained in two
 * block headers.
 *
 * Warning: Only compare `bits` from blocks in two adjacent difficulty periods. This code
 * assumes the maximum difference is x4 or /4 (as per the protocol) and will throw an
 * error if an exponent difference of 2 or more is seen.
 *
 * @param {number} oldBits The 32 bit `bits` integer from a block header.
 * @param {number} newBits The 32 bit `bits` integer from a block header in the next difficulty period.
 * @returns {number} A floating point decimal of the difficulty change from old to new.
 *          (ie. 21.3 means 21.3% increase in difficulty, -21.3 is a 21.3% decrease in difficulty)
 */
export function calcBitsDifference(oldBits: number, newBits: number): number {
  // Must be
  // - integer
  // - highest exponent is 0x20, so max value (as integer) is 0x207fffff
  // - min value is 1 (exponent = 0)
  // - highest bit of the number-part is +- sign, it must not be 1
  const verifyBits = (bits: number): void => {
    if (
      Math.floor(bits) !== bits ||
      bits > 0x207fffff ||
      bits < 1 ||
      (bits & 0x00800000) !== 0 ||
      (bits & 0x007fffff) === 0
    ) {
      throw new Error('Invalid bits');
    }
  };
  verifyBits(oldBits);
  verifyBits(newBits);

  // No need to mask exponents because we checked the bounds above
  const oldExp = oldBits >> 24;
  const newExp = newBits >> 24;
  const oldNum = oldBits & 0x007fffff;
  const newNum = newBits & 0x007fffff;
  // The diff can only possibly be 1, 0, -1
  // (because maximum difficulty change is x4 or /4 (2 bits up or down))
  let result: number;
  switch (newExp - oldExp) {
    // New less than old, target lowered, difficulty increased
    case -1:
      result = ((oldNum << 8) * 100) / newNum - 100;
      break;
    // Same exponent, compare numbers as is.
    case 0:
      result = (oldNum * 100) / newNum - 100;
      break;
    // Old less than new, target raised, difficulty decreased
    case 1:
      result = (oldNum * 100) / (newNum << 8) - 100;
      break;
    default:
      throw new Error('Impossible exponent difference');
  }

  // Min/Max values
  return result > 300 ? 300 : result < -75 ? -75 : result;
}

/**
 * Calculate ASERT-based difficulty adjustment data for BCH.
 *
 * Uses the aserti3-2d algorithm to compute:
 * - Schedule offset: how far ahead/behind the ideal 10-minute schedule
 * - Difficulty drift: expected % change for the next block
 * - Current and predicted next block bits
 */
export function calcAsertDifficultyAdjustment(
  blockHeight: number,
  latestBlockTimestamp: number,
  network: string,
  recentBlocks: { timestamp: number }[]
): DifficultyAdjustment {
  const BLOCK_SECONDS_TARGET = 600;
  const anchor = ASERT_ANCHORS[network] ?? ASERT_ANCHORS.mainnet;
  const anchorHeight = Math.floor(anchor.tick / ASERT_ANCHOR_IDEAL_BLOCK_TIME);

  // Schedule offset: how far ahead or behind the ideal schedule
  // Positive = network is ahead (blocks mined faster than 10min avg)
  // Negative = network is behind (blocks mined slower than 10min avg)
  const idealElapsed = (blockHeight - anchorHeight) * BLOCK_SECONDS_TARGET;
  const actualElapsed = latestBlockTimestamp - anchor.timestamp;
  const scheduleOffsetSeconds = idealElapsed - actualElapsed;

  // Current ASERT target and bits
  const currentTarget = calculateTargetLegacy(blockHeight, latestBlockTimestamp, anchor);
  const currentBits = targetToBits(currentTarget);

  // Predicted next block target (assuming it arrives in exactly 600s)
  const nextTarget = calculateTargetLegacy(blockHeight + 1, latestBlockTimestamp + BLOCK_SECONDS_TARGET, anchor);
  const nextBits = targetToBits(nextTarget);

  // Difficulty drift %: how much harder/easier the next block will be
  // Higher target = easier mining = difficulty decrease (negative drift)
  // Lower target = harder mining = difficulty increase (positive drift)
  const difficultyDriftPercent = currentTarget !== 0 ? ((currentTarget - nextTarget) / currentTarget) * 100 : 0;

  // Average block time from recent blocks (last ~8 blocks = 7 intervals)
  let timeAvgSecs = BLOCK_SECONDS_TARGET;
  if (recentBlocks.length >= 2) {
    const sorted = [...recentBlocks].sort((a, b) => a.timestamp - b.timestamp);
    const totalTime = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
    timeAvgSecs = totalTime / (sorted.length - 1);
  }

  const timeAvg = Math.floor(timeAvgSecs * 1000);

  return {
    scheduleOffsetSeconds,
    difficultyDriftPercent,
    currentBits,
    nextBits,
    timeAvg,
  };
}

class DifficultyAdjustmentApi {
  public getDifficultyAdjustment(): IDifficultyAdjustment | null {
    const blockHeight = blocks.getCurrentBlockHeight();
    const blocksCache = blocks.getBlocks();
    const latestBlock = blocksCache[blocksCache.length - 1];
    if (!latestBlock) {
      return null;
    }
    // Use last ~8 blocks for average block time calculation (7 intervals)
    const recentBlocks = blocksCache.slice(-8).map((b) => ({ timestamp: b.timestamp }));

    return calcAsertDifficultyAdjustment(blockHeight, latestBlock.timestamp, config.EXPLORER.NETWORK, recentBlocks);
  }
}

export default new DifficultyAdjustmentApi();
