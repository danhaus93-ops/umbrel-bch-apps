import { MempoolBlock } from '../mempool.interfaces';
import { IBitcoinApi } from './bitcoin/bitcoin-api.interface';
import mempool from './mempool';
import projectedBlocks from './mempool-blocks';

interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

class FeeApi {
  constructor() {}

  minimumIncrement = 1;
  minFastestFee = 1;
  minHalfHourFee = 0.5;
  priorityFactor = 0.5;

  public getRecommendedFee(): RecommendedFees {
    const pBlocks = projectedBlocks.getMempoolBlocks();
    const mPool = mempool.getMempoolInfo();

    return this.calculateRecommendedFee(pBlocks, mPool);
  }

  public getPreciseRecommendedFee(): RecommendedFees {
    const pBlocks = projectedBlocks.getMempoolBlocks();
    const mPool = mempool.getMempoolInfo();

    // minimum non-zero minrelaytxfee / incrementalrelayfee is 1 sat/kB = 0.001 sat/B
    const recommendations = this.calculateRecommendedFee(pBlocks, mPool, 0.001);
    // enforce floor & offset for highest priority recommendations while <100% hashrate accepts sub-sat fees
    recommendations.fastestFee = Math.max(recommendations.fastestFee + this.priorityFactor, this.minFastestFee);
    recommendations.halfHourFee = Math.max(recommendations.halfHourFee + this.priorityFactor / 2, this.minHalfHourFee);
    return {
      fastestFee: Math.round(recommendations.fastestFee * 1000) / 1000,
      halfHourFee: Math.round(recommendations.halfHourFee * 1000) / 1000,
      hourFee: Math.round(recommendations.hourFee * 1000) / 1000,
      economyFee: Math.round(recommendations.economyFee * 1000) / 1000,
      minimumFee: Math.round(recommendations.minimumFee * 1000) / 1000,
    };
  }

  public calculateRecommendedFee(
    pBlocks: MempoolBlock[],
    mPool: IBitcoinApi.MempoolInfo,
    minIncrement: number = this.minimumIncrement
  ): RecommendedFees {
    const purgeRate = this.roundUpToNearest(mPool.mempoolminfee * 100000, minIncrement);
    const minimumFee = Math.max(purgeRate, minIncrement);

    if (!pBlocks.length) {
      return {
        fastestFee: minimumFee,
        halfHourFee: minimumFee,
        hourFee: minimumFee,
        economyFee: minimumFee,
        minimumFee: minimumFee,
      };
    }

    const firstMedianFee = this.optimizeMedianFee(pBlocks[0], pBlocks[1], undefined, minimumFee, minIncrement);
    const secondMedianFee = pBlocks[1]
      ? this.optimizeMedianFee(pBlocks[1], pBlocks[2], firstMedianFee, minimumFee, minIncrement)
      : minimumFee;
    const thirdMedianFee = pBlocks[2]
      ? this.optimizeMedianFee(pBlocks[2], pBlocks[3], secondMedianFee, minimumFee, minIncrement)
      : minimumFee;

    // explicitly enforce a minimum of ceil(mempoolminfee) on all recommendations.
    // simply rounding up recommended rates is insufficient, as the purging rate
    // can exceed the median rate of projected blocks in some extreme scenarios
    // (see https://bitcoin.stackexchange.com/a/120024)
    let fastestFee = Math.max(minimumFee, firstMedianFee);
    let halfHourFee = Math.max(minimumFee, secondMedianFee);
    let hourFee = Math.max(minimumFee, thirdMedianFee);
    const economyFee = Math.max(minimumFee, Math.min(2 * minimumFee, thirdMedianFee));

    // ensure recommendations always increase w/ priority
    fastestFee = Math.max(fastestFee, halfHourFee, hourFee, economyFee);
    halfHourFee = Math.max(halfHourFee, hourFee, economyFee);
    hourFee = Math.max(hourFee, economyFee);

    return {
      fastestFee: this.roundToNearest(fastestFee, minIncrement),
      halfHourFee: this.roundToNearest(halfHourFee, minIncrement),
      hourFee: this.roundToNearest(hourFee, minIncrement),
      economyFee: this.roundToNearest(economyFee, minIncrement),
      minimumFee: this.roundToNearest(minimumFee, minIncrement),
    };
  }

  // Updated for BCH 32MB blocks (not taking ABLA yet into account)
  private optimizeMedianFee(
    pBlock: MempoolBlock,
    nextBlock: MempoolBlock | undefined,
    previousFee: number | undefined,
    minFee: number,
    minIncrement: number = this.minimumIncrement
  ): number {
    const useFee = previousFee ? (pBlock.medianFee + previousFee) / 2 : pBlock.medianFee;
    // BCH has 32MB blocks, so thresholds are scaled accordingly:
    // - Low congestion: ≤16MB (50% of 32MB)
    // - Medium congestion: 16MB-30.4MB (50%-95% of 32MB)
    // - High congestion: >30.4MB (>95% of 32MB)
    if (pBlock.blockSize <= 16000000 || pBlock.medianFee < minFee) {
      return minFee;
    }
    if (pBlock.blockSize <= 30400000 && !nextBlock) {
      const multiplier = (pBlock.blockSize - 16000000) / 16000000;
      return Math.max(this.roundToNearest(useFee * multiplier, minIncrement), minFee);
    }
    return Math.max(this.roundUpToNearest(useFee, minIncrement), minFee);
  }

  private roundUpToNearest(value: number, nearest: number): number {
    if (nearest !== 0) {
      return Math.ceil(value / nearest) * nearest;
    }
    return value;
  }

  private roundToNearest(value: number, nearest: number): number {
    if (nearest !== 0) {
      return Math.round(value / nearest) * nearest;
    }
    return value;
  }
}

export default new FeeApi();
