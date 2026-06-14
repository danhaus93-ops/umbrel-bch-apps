import { Application, Request, Response } from 'express';
import config from '../../config';
import logger from '../../logger';
import BlocksAuditsRepository from '../../repositories/BlocksAuditsRepository';
import BlocksRepository from '../../repositories/BlocksRepository';
import DifficultyAdjustmentsRepository from '../../repositories/DifficultyAdjustmentsRepository';
import HashratesRepository from '../../repositories/HashratesRepository';
import bitcoinClient from '../bitcoin/bitcoin-client';
import mining from './mining';
import PricesRepository from '../../repositories/PricesRepository';
import { handleError } from '../../utils/api';
import { getAsertAnchorHeight } from '../difficulty-adjustment';

class MiningRoutes {
  private static readonly VALID_INTERVALS = ['24h', '3d', '1w', '1m', '3m', '6m', '1y', '2y', '3y', '4y', 'all'];

  public initRoutes(app: Application) {
    app
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/pools', this.$listPools)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/pools/:interval', this.$getPools)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/pool/:slug/hashrate', this.$getPoolHistoricalHashrate)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/pool/:slug/blocks', this.$getPoolBlocks)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/pool/:slug/blocks/:height', this.$getPoolBlocks)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/pool/:slug', this.$getPool)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/hashrate/pools/:interval', this.$getPoolsHistoricalHashrate)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/hashrate/:interval', this.$getHistoricalHashrate)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/difficulty-adjustments', this.$getDifficultyAdjustments)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/reward-stats/:blockCount', this.$getRewardStats)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/fees/:interval', this.$getHistoricalBlockFees)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/fees', this.$getBlockFeesTimespan)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/rewards/:interval', this.$getHistoricalBlockRewards)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/fee-rates/:interval', this.$getHistoricalBlockFeeRates)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/sizes/:interval', this.$getHistoricalBlockSize)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/timestamps/:interval', this.$getHistoricalBlockTimeDiffs)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/tx-counts/:interval', this.$getHistoricalBlockTxCounts)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/volume/:interval', this.$getHistoricalBlockVolume)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/utxo-size/:interval', this.$getHistoricalUtxoSize)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/difficulty-adjustments/:interval', this.$getDifficultyAdjustments)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/predictions/:interval', this.$getHistoricalBlocksHealth)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/audit/scores', this.$getBlockAuditScores)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/audit/scores/:height', this.$getBlockAuditScores)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/audit/score/:hash', this.$getBlockAuditScore)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/audit/:hash', this.$getBlockAudit)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/timestamp/:timestamp', this.$getHeightFromTimestamp)
      .get(config.EXPLORER.API_URL_PREFIX + 'mining/blocks/asert/:blockheight', this.$getAsertBlocks)
      .get(config.EXPLORER.API_URL_PREFIX + 'historical-price', this.$getHistoricalPrice)
      .get(config.EXPLORER.API_URL_PREFIX + 'internal/mining/hashrate/reindex', this.$reindexAllHashrate);
  }

  private static validateInterval(req: Request, res: Response): boolean {
    // Interval can also be null / empty
    if (!req.params.interval) {
      return true;
    } else if (!MiningRoutes.VALID_INTERVALS.includes(req.params.interval)) {
      handleError(req, res, 400, 'Invalid interval');
      return false;
    }
    return true;
  }

  private static getExpiresMsForInterval(interval: string): number {
    // For intervals of 6 months or more, browser can cache for 30 minutes, otherwise cache for 1 minute
    // Which is also more in line with the Valkey expire times for higher intervals.
    return ['6m', '1y', '2y', '3y', '4y', 'all'].includes(interval) ? 1000 * 1800 : 1000 * 60;
  }

  private async $getHistoricalPrice(req: Request, res: Response): Promise<void> {
    try {
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
      if (['testnet4', 'chipnet', 'scalenet'].includes(config.EXPLORER.NETWORK)) {
        handleError(req, res, 400, 'Prices are not available on testnets.');
        return;
      }
      const timestamp = parseInt(req.query.timestamp as string, 10) || 0;
      const currency = req.query.currency as string;

      let response;
      if (timestamp && currency) {
        response = await PricesRepository.$getNearestHistoricalPrice(timestamp, currency);
      } else if (timestamp) {
        response = await PricesRepository.$getNearestHistoricalPrice(timestamp);
      } else if (currency) {
        response = await PricesRepository.$getHistoricalPrices(currency);
      } else {
        response = await PricesRepository.$getHistoricalPrices();
      }
      res.status(200).send(response);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical prices');
    }
  }

  private async $getPool(req: Request, res: Response): Promise<void> {
    try {
      const stats = await mining.$getPoolStat(req.params.slug);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(stats);
    } catch (e) {
      if (e instanceof Error && e.message.indexOf('This mining pool does not exist') > -1) {
        handleError(req, res, 404, e.message);
      } else {
        handleError(req, res, 500, 'Failed to get pool');
      }
    }
  }

  private async $getPoolBlocks(req: Request, res: Response) {
    try {
      const poolBlocks = await BlocksRepository.$getBlocksByPool(
        req.params.slug,
        req.params.height === undefined ? undefined : parseInt(req.params.height, 10)
      );
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(poolBlocks);
    } catch (e) {
      if (e instanceof Error && e.message.indexOf('This mining pool does not exist') > -1) {
        handleError(req, res, 404, e.message);
      } else {
        handleError(req, res, 500, 'Failed to get blocks for pool');
      }
    }
  }

  private async $listPools(req: Request, res: Response): Promise<void> {
    try {
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());

      const pools = await mining.$listPools();
      if (!pools) {
        res.status(500).end();
        return;
      }

      res.header('X-total-count', pools.length.toString());
      if (pools.length === 0) {
        res.status(204).send();
      } else {
        res.json(pools);
      }
    } catch (e) {
      handleError(req, res, 500, 'Failed to get pools');
    }
  }

  private async $getPools(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const stats = await mining.$getPoolsStats(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json(stats);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get pools');
    }
  }

  private async $getPoolsHistoricalHashrate(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const hashrates = await HashratesRepository.$getPoolsWeeklyHashrate(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
      res.json(hashrates);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get pools historical hashrate');
    }
  }

  private async $getPoolHistoricalHashrate(req: Request, res: Response) {
    try {
      const hashrates = await HashratesRepository.$getPoolWeeklyHashrate(req.params.slug);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
      res.json(hashrates);
    } catch (e) {
      if (e instanceof Error && e.message.indexOf('This mining pool does not exist') > -1) {
        handleError(req, res, 404, e.message);
      } else {
        handleError(req, res, 500, 'Failed to get pool historical hashrate');
      }
    }
  }

  private async $getHistoricalHashrate(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    let currentHashrate = 0,
      currentDifficulty = 0;
    try {
      currentHashrate = await bitcoinClient.getNetworkHashPs(1008);
      currentDifficulty = await bitcoinClient.getDifficulty();
    } catch (e) {
      logger.debug('Bitcoin Cash Node is not available, using zeroed value for current hashrate and difficulty');
    }

    try {
      const hashrates = await HashratesRepository.$getNetworkDailyHashrate(interval);
      const difficulty = await DifficultyAdjustmentsRepository.$getAdjustments(interval, false);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
      res.json({
        hashrates: hashrates,
        difficulty: difficulty,
        currentHashrate: currentHashrate,
        currentDifficulty: currentDifficulty,
      });
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical hashrate');
    }
  }

  private async $getHistoricalBlockFees(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const blockFees = await mining.$getHistoricalBlockFees(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json(blockFees);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block fees');
    }
  }

  private async $getBlockFeesTimespan(req: Request, res: Response) {
    try {
      if (!parseInt(req.query.from as string, 10) || !parseInt(req.query.to as string, 10)) {
        throw new Error('Invalid timestamp range');
      }
      if (parseInt(req.query.from as string, 10) > parseInt(req.query.to as string, 10)) {
        throw new Error('from must be less than to');
      }
      const blockFees = await mining.$getBlockFeesTimespan(
        parseInt(req.query.from as string, 10),
        parseInt(req.query.to as string, 10)
      );
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(blockFees);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block fees');
    }
  }

  private async $getHistoricalBlockRewards(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const blockRewards = await mining.$getHistoricalBlockRewards(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json(blockRewards);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block rewards');
    }
  }

  private async $getHistoricalBlockFeeRates(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const blockFeeRates = await mining.$getHistoricalBlockFeeRates(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json(blockFeeRates);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block fee rates');
    }
  }

  private async $getHistoricalBlockSize(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const blockSizes = await mining.$getHistoricalBlockSizes(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json({
        sizes: blockSizes,
      });
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block size');
    }
  }

  private async $getHistoricalBlockTimeDiffs(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }
    try {
      const blockTimeDiffs = await mining.$getHistoricalBlockTimeDiffs(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json({ timeDiffs: blockTimeDiffs });
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block time diffs');
    }
  }

  private async $getHistoricalBlockTxCounts(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }
    try {
      const txCounts = await mining.$getHistoricalBlockTxCounts(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json({ transactions: txCounts });
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block tx counts');
    }
  }

  private async $getHistoricalBlockVolume(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }
    try {
      const volumeData = await mining.$getHistoricalBlockVolume(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json({ volume: volumeData });
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical block volume');
    }
  }

  private async $getHistoricalUtxoSize(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }
    try {
      const utxoData = await mining.$getHistoricalUtxoSize(interval);
      const blockCount = await BlocksRepository.$blockCount(null, null);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json({ utxos: utxoData });
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical UTXO size');
    }
  }

  private async $getDifficultyAdjustments(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const difficulty = await DifficultyAdjustmentsRepository.$getRawAdjustments(interval, true);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
      res.json(difficulty.map((adj) => [adj.time, adj.height, adj.difficulty, adj.adjustment]));
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical difficulty adjustments');
    }
  }

  private async $getRewardStats(req: Request, res: Response) {
    try {
      const response = await mining.$getRewardStats(parseInt(req.params.blockCount, 10));
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(response);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get reward stats');
    }
  }

  private async $getHistoricalBlocksHealth(req: Request, res: Response) {
    const interval = req.params.interval;
    if (!MiningRoutes.validateInterval(req, res)) {
      return;
    }

    try {
      const blocksHealth = await mining.$getBlocksHealthHistory(interval);
      const blockCount = await BlocksAuditsRepository.$getBlocksHealthCount();
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', blockCount.toString());
      res.setHeader('Expires', new Date(Date.now() + MiningRoutes.getExpiresMsForInterval(interval)).toUTCString());
      res.json(blocksHealth.map((health) => [health.time, health.height, health.match_rate]));
    } catch (e) {
      handleError(req, res, 500, 'Failed to get historical blocks health');
    }
  }

  public async $getBlockAudit(req: Request, res: Response) {
    try {
      const audit = await BlocksAuditsRepository.$getBlockAudit(req.params.hash);

      if (!audit) {
        handleError(req, res, 204, `This block has not been audited.`);
        return;
      }

      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24).toUTCString());
      res.json(audit);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get block audit');
    }
  }

  private async $getHeightFromTimestamp(req: Request, res: Response) {
    try {
      const timestamp = parseInt(req.params.timestamp, 10);
      // This will prevent people from entering milliseconds etc.
      // Block timestamps are allowed to be up to 2 hours off, so 24 hours
      // will never put the maximum value before the most recent block
      const nowPlus1day = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
      // Prevent non-integers that are not seconds
      if (!/^[1-9][0-9]*$/.test(req.params.timestamp) || timestamp > nowPlus1day) {
        throw new Error(`Invalid timestamp, value must be Unix seconds`);
      }
      const result = await BlocksRepository.$getBlockHeightFromTimestamp(timestamp);
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
      res.json(result);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get height from timestamp');
    }
  }

  private async $getBlockAuditScores(req: Request, res: Response) {
    try {
      let height = req.params.height === undefined ? undefined : parseInt(req.params.height, 10);
      if (height == null) {
        height = await BlocksRepository.$mostRecentBlockHeight();
      }
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(await BlocksAuditsRepository.$getBlockAuditScores(height, height - 15));
    } catch (e) {
      handleError(req, res, 500, 'Failed to get block audit scores');
    }
  }

  public async $getBlockAuditScore(req: Request, res: Response) {
    try {
      const audit = await BlocksAuditsRepository.$getBlockAuditScore(req.params.hash);

      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24).toUTCString());
      res.json(audit || 'null');
    } catch (e) {
      handleError(req, res, 500, 'Failed to get block audit score');
    }
  }

  private async $reindexAllHashrate(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Internal API: Triggering forced hashrate reindex from 1 year ago');

      // Run forced reindexing in background
      setImmediate(async () => {
        try {
          await mining.$generateAllHashrateHistoryAlways();
          logger.info('Internal API: Forced hashrate reindexing completed successfully');
        } catch (e) {
          logger.err(
            `Internal API: Background forced hashrate reindexing failed: ${e instanceof Error ? e.message : e}`
          );
        }
      });

      res.json({
        message: 'Forced hashrate reindexing requested (genesis block to today)',
        timestamp: new Date().toISOString(),
        status: 'started',
        note: 'This will reindex both daily and weekly hashrates from the genesis block to today',
      });
    } catch (e) {
      logger.err(`Internal API: Failed to trigger forced hashrate reindex: ${e instanceof Error ? e.message : e}`);
      handleError(req, res, 500, 'Failed to trigger forced hashrate reindex');
    }
  }

  private async $getAsertBlocks(req: Request, res: Response): Promise<void> {
    try {
      const blockHeight = parseInt(req.params.blockheight, 10);
      const asertAnchorHeight = getAsertAnchorHeight(config.EXPLORER.NETWORK);

      // Validate block height parameter
      if (isNaN(blockHeight)) {
        handleError(req, res, 400, 'Invalid block height parameter');
        return;
      }

      // Validate that block height is not before ASERT anchor
      if (blockHeight < asertAnchorHeight) {
        handleError(req, res, 400, `Block height must be >= ${asertAnchorHeight} (ASERT anchor height)`);
        return;
      }

      // Get ASERT blocks data
      const asertBlocks = await mining.$getAsertBlocks(blockHeight);

      // Set cache headers
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());

      res.json(asertBlocks);
    } catch (e) {
      if (e instanceof Error && e.message.includes('Block height must be')) {
        handleError(req, res, 400, e.message);
      } else {
        handleError(req, res, 500, 'Failed to get ASERT blocks');
      }
    }
  }
}

export default new MiningRoutes();
