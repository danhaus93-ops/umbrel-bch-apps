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
  mainnet: {
    bits: '1804dafe',
    tick: 396988200,
    timestamp: 1605447844,
    tau: 172800,
  },
  testnet4: {
    bits: '1d00ffff',
    tick: 10106400,
    timestamp: 1605451779,
    tau: 3600,
  },
  chipnet: {
    bits: '1d00ffff',
    tick: 10106400,
    timestamp: 1605451779,
    tau: 3600,
  },
  scalenet: {
    bits: '1804dafe',
    tick: 396988200,
    timestamp: 1605447844,
    tau: 172800,
  },
};

export function getAsertAnchor(network: string): AsertAnchor {
  return ASERT_ANCHORS[network] ?? ASERT_ANCHORS['mainnet'];
}

export function getAsertAnchorHeight(network: string): number {
  const anchor = getAsertAnchor(network);
  return Math.floor(anchor.tick / ASERT_ANCHOR_IDEAL_BLOCK_TIME); // 661647 for mainnet
}

export function bitsToTarget(bits: string): number {
  const exponent = parseInt(bits.slice(0, 2), 16);
  const mantissa = parseInt(bits.slice(2), 16);
  return mantissa * Math.pow(2, (exponent - 3) * 8);
}

export function targetToBits(target: number): string {
  if (target === 0) return '00000000';

  let exponent = Math.floor(Math.log2(target) / 8) + 1;
  let mantissa = Math.floor(target / Math.pow(2, (exponent - 3) * 8));

  if (mantissa > 0x7fffff) {
    mantissa = Math.floor(mantissa / 256);
    exponent++;
  }

  return (
    exponent.toString(16).padStart(2, '0') +
    mantissa.toString(16).padStart(6, '0')
  );
}

export function calculateTarget(
  heightTick: number,
  timestamp: number,
  anchor: AsertAnchor,
  nextTargetBlockTime: number = 600
): number {
  const anchorTarget = bitsToTarget(anchor.bits);

  const tickDelta = heightTick - anchor.tick;
  const timeDelta = timestamp - anchor.timestamp;

  const t = Math.trunc;
  const base = t(
    ((timeDelta - (tickDelta + ASERT_ANCHOR_IDEAL_BLOCK_TIME)) * 65536) /
      anchor.tau
  );
  const hi = t(base / 65536) + (base < 0 ? -1 : 0);
  const lo = base - hi * 65536;

  return (
    (t(
      (195766423245049 * lo +
        971821376 * lo ** 2 +
        5127 * lo ** 3 +
        140737488355328) /
        2 ** 48
    ) +
      65536) *
    t(ASERT_ANCHOR_IDEAL_BLOCK_TIME / nextTargetBlockTime) *
    anchorTarget *
    2 ** (hi - 16)
  );
}

export function calculateTargetLegacy(
  height: number,
  timestamp: number,
  anchor: AsertAnchor,
  nextTargetBlockTime: number = 600
): number {
  return calculateTarget(height * 600, timestamp, anchor, nextTargetBlockTime);
}

export function getScheduleOffsetSeconds(
  height: number,
  timestamp: number,
  network: string = 'mainnet'
): number {
  const anchor = getAsertAnchor(network);
  const anchorHeight = Math.floor(anchor.tick / ASERT_ANCHOR_IDEAL_BLOCK_TIME);
  const idealElapsed = (height - anchorHeight) * ASERT_ANCHOR_IDEAL_BLOCK_TIME;
  const actualElapsed = timestamp - anchor.timestamp;
  return idealElapsed - actualElapsed;
}

export function getDifficultyDriftPercentSinceAnchor(
  height: number,
  timestamp: number,
  network: string = 'mainnet'
): number {
  const anchor = getAsertAnchor(network);
  const anchorTarget = bitsToTarget(anchor.bits);
  const currentTarget = calculateTargetLegacy(height, timestamp, anchor);
  if (anchorTarget === 0) return 0;
  // Higher target = easier = difficulty decrease (negative drift)
  // Lower target = harder = difficulty increase (positive drift)
  return ((anchorTarget - currentTarget) / anchorTarget) * 100;
}

// --- End ASERT functions ---
