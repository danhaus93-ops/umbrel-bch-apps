import { calcBitsDifference, calcAsertDifficultyAdjustment } from '../../api/difficulty-adjustment';

describe('Mempool Difficulty Adjustment', () => {
  const recentBlocksFor = (blockTimestamp: number) => [
    { timestamp: blockTimestamp - 3600 },
    { timestamp: blockTimestamp - 3000 },
    { timestamp: blockTimestamp - 2400 },
    { timestamp: blockTimestamp - 1800 },
    { timestamp: blockTimestamp - 1200 },
    { timestamp: blockTimestamp - 600 },
    { timestamp: blockTimestamp },
  ];

  test('should calculate ASERT Difficulty Adjustments properly for mainnet', () => {
    const blockHeight = 946905;
    const blockTimestamp = 1776280633;
    const recentBlocks = recentBlocksFor(blockTimestamp);

    const result = calcAsertDifficultyAdjustment(blockHeight, blockTimestamp, 'mainnet', recentBlocks);

    expect(result).toHaveProperty('scheduleOffsetSeconds');
    expect(result).toHaveProperty('difficultyDriftPercent');
    expect(result).toHaveProperty('currentBits');
    expect(result).toHaveProperty('nextBits');
    expect(result).toHaveProperty('timeAvg');

    expect(typeof result.scheduleOffsetSeconds).toBe('number');
    expect(typeof result.difficultyDriftPercent).toBe('number');
    expect(result.currentBits).toMatch(/^[0-9a-f]{8}$/);
    expect(result.nextBits).toMatch(/^[0-9a-f]{8}$/);
    expect(result.timeAvg).toBe(600000);
  });

  test('should use testnet4 anchor (height 16844, bits 1d00ffff, tau 3600) for testnet4', () => {
    // testnet4 anchor is at height 16844, timestamp 1605451779 (Nov 2020).
    // Use a block 200 blocks above anchor with ideal-pace timing to keep hi exponent small.
    const blockHeight = 17044; // anchor + 200
    const blockTimestamp = 1605451779 + 200 * 600; // ideal 10-min spacing
    const recentBlocks = recentBlocksFor(blockTimestamp);

    const result = calcAsertDifficultyAdjustment(blockHeight, blockTimestamp, 'testnet4', recentBlocks);

    expect(result.currentBits).toMatch(/^[0-9a-f]{8}$/);
    expect(result.nextBits).toMatch(/^[0-9a-f]{8}$/);

    // testnet4 anchor bits (1d00ffff) differ from mainnet (1804dafe) — results must differ
    const mainnetResult = calcAsertDifficultyAdjustment(blockHeight, blockTimestamp, 'mainnet', recentBlocks);
    expect(result.currentBits).not.toEqual(mainnetResult.currentBits);
  });

  test('chipnet should produce same result as testnet4 (identical anchor params)', () => {
    // chipnet anchor is identical to testnet4: height 16844, bits 1d00ffff, tau 3600
    const blockHeight = 17044; // anchor + 200
    const blockTimestamp = 1605451779 + 200 * 600; // ideal 10-min spacing → scheduleOffset = 0
    const recentBlocks = recentBlocksFor(blockTimestamp);

    const testnet4Result = calcAsertDifficultyAdjustment(blockHeight, blockTimestamp, 'testnet4', recentBlocks);
    const chipnetResult = calcAsertDifficultyAdjustment(blockHeight, blockTimestamp, 'chipnet', recentBlocks);

    // Both networks share the same anchor — results must be identical
    expect(chipnetResult.currentBits).toEqual(testnet4Result.currentBits);
    expect(chipnetResult.nextBits).toEqual(testnet4Result.nextBits);
    expect(chipnetResult.scheduleOffsetSeconds).toEqual(testnet4Result.scheduleOffsetSeconds);
    expect(chipnetResult.difficultyDriftPercent).toEqual(testnet4Result.difficultyDriftPercent);
    expect(chipnetResult.timeAvg).toEqual(testnet4Result.timeAvg);

    // At ideal pace: bits hold steady at 1d00e417, schedule is exactly on time
    expect(chipnetResult.currentBits).toBe('1d00e417');
    expect(chipnetResult.scheduleOffsetSeconds).toBe(0);
    expect(chipnetResult.timeAvg).toBe(600000);
  });

  test('should calculate Difficulty change from bits fields of two blocks', () => {
    // Check same exponent + check min max for output
    expect(calcBitsDifference(0x1d000200, 0x1d000100)).toEqual(100);
    expect(calcBitsDifference(0x1d000400, 0x1d000100)).toEqual(300);
    expect(calcBitsDifference(0x1d000800, 0x1d000100)).toEqual(300); // Actually 700
    expect(calcBitsDifference(0x1d000100, 0x1d000200)).toEqual(-50);
    expect(calcBitsDifference(0x1d000100, 0x1d000400)).toEqual(-75);
    expect(calcBitsDifference(0x1d000100, 0x1d000800)).toEqual(-75); // Actually -87.5
    // Check new higher exponent
    expect(calcBitsDifference(0x1c000200, 0x1d000001)).toEqual(100);
    expect(calcBitsDifference(0x1c000400, 0x1d000001)).toEqual(300);
    expect(calcBitsDifference(0x1c000800, 0x1d000001)).toEqual(300);
    expect(calcBitsDifference(0x1c000100, 0x1d000002)).toEqual(-50);
    expect(calcBitsDifference(0x1c000100, 0x1d000004)).toEqual(-75);
    expect(calcBitsDifference(0x1c000100, 0x1d000008)).toEqual(-75);
    // Check new lower exponent
    expect(calcBitsDifference(0x1d000002, 0x1c000100)).toEqual(100);
    expect(calcBitsDifference(0x1d000004, 0x1c000100)).toEqual(300);
    expect(calcBitsDifference(0x1d000008, 0x1c000100)).toEqual(300);
    expect(calcBitsDifference(0x1d000001, 0x1c000200)).toEqual(-50);
    expect(calcBitsDifference(0x1d000001, 0x1c000400)).toEqual(-75);
    expect(calcBitsDifference(0x1d000001, 0x1c000800)).toEqual(-75);
    // Check error when exponents are too far apart
    expect(() => calcBitsDifference(0x1d000001, 0x1a000800)).toThrow(/Impossible exponent difference/);
    // Check invalid inputs
    expect(() => calcBitsDifference(0x7f000001, 0x1a000800)).toThrow(/Invalid bits/);
    expect(() => calcBitsDifference(0, 0x1a000800)).toThrow(/Invalid bits/);
    expect(() => calcBitsDifference(100.2783, 0x1a000800)).toThrow(/Invalid bits/);
    expect(() => calcBitsDifference(0x00800000, 0x1a000800)).toThrow(/Invalid bits/);
    expect(() => calcBitsDifference(0x1c000000, 0x1a000800)).toThrow(/Invalid bits/);
  });
});
