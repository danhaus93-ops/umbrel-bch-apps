import memPool from '../mempool';
import logger from '../../logger';
import { VerboseTransactionExtended, OptimizedStatistic } from '../../mempool.interfaces';
import statisticsApi from './statistics-api';

class Statistics {
  protected intervalTimer: NodeJS.Timer | undefined;
  protected lastRun = 0;
  protected newStatisticsEntryCallback: ((stats: OptimizedStatistic) => void) | undefined;

  public setNewStatisticsEntryCallback(fn: (stats: OptimizedStatistic) => void) {
    this.newStatisticsEntryCallback = fn;
  }

  public startStatistics(): void {
    logger.info('Starting statistics service');

    const now = new Date();
    const nextInterval = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      Math.floor(now.getMinutes() / 1) * 1 + 1,
      0,
      0
    );
    const difference = nextInterval.getTime() - now.getTime();

    setTimeout(() => {
      this.runStatistics();
      this.intervalTimer = setInterval(
        () => {
          this.runStatistics(true);
        },
        1 * 60 * 1000
      );
    }, difference);
  }

  public async runStatistics(skipIfRecent = false): Promise<void> {
    if (!memPool.isInSync()) {
      return;
    }

    if (skipIfRecent && new Date().getTime() / 1000 - this.lastRun < 30) {
      return;
    }

    this.lastRun = new Date().getTime() / 1000;
    const currentMempool = memPool.getMempool();
    const txPerSecond = memPool.getTxPerSecond();
    const bytesPerSecond = memPool.getBytesPerSecond();

    logger.debug('Running statistics');

    let memPoolArray: VerboseTransactionExtended[] = [];
    for (const i in currentMempool) {
      if (currentMempool.hasOwnProperty(i)) {
        memPoolArray.push(currentMempool[i]);
      }
    }
    // Remove 0 and undefined
    memPoolArray = memPoolArray.filter((tx) => tx.feePerSize);

    if (!memPoolArray.length) {
      try {
        const insertIdZeroed = await statisticsApi.$createZeroedStatistic();
        if (this.newStatisticsEntryCallback && insertIdZeroed) {
          const newStats = await statisticsApi.$get(insertIdZeroed);
          if (newStats) {
            this.newStatisticsEntryCallback(newStats);
          }
        }
      } catch (e) {
        logger.err('Unable to insert zeroed statistics. ' + e);
      }
      return;
    }

    memPoolArray.sort((a, b) => a.feePerSize - b.feePerSize);
    const totalSize = memPoolArray.map((tx) => tx.size).reduce((acc, curr) => acc + curr);
    const totalFee = memPoolArray.map((tx) => tx.fee).reduce((acc, curr) => acc + curr);

    const logFees = [
      0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400,
      500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000,
    ];

    const sizeFees: { [feePerByte: number]: number } = {};
    const lastItem = logFees.length - 1;

    memPoolArray.forEach((transaction) => {
      for (let i = 0; i < logFees.length; i++) {
        if (i === lastItem || transaction.feePerSize < logFees[i + 1]) {
          if (sizeFees[logFees[i]]) {
            sizeFees[logFees[i]] += transaction.size;
          } else {
            sizeFees[logFees[i]] = transaction.size;
          }
          break;
        }
      }
    });

    // get minFee and convert to sats/b
    const minFee = memPool.getMempoolInfo().mempoolminfee * 100000;

    try {
      const insertId = await statisticsApi.$create({
        added: 'NOW()',
        unconfirmed_transactions: memPoolArray.length,
        tx_per_second: txPerSecond,
        bytes_per_second: Math.round(bytesPerSecond),
        mempool_byte_size: totalSize,
        total_fee: totalFee,
        fee_data: '',
        min_fee: minFee,
        size_0: sizeFees['0'] || 0,
        size_1: sizeFees['1'] || 0,
        size_2: sizeFees['2'] || 0,
        size_3: sizeFees['3'] || 0,
        size_4: sizeFees['4'] || 0,
        size_5: sizeFees['5'] || 0,
        size_6: sizeFees['6'] || 0,
        size_8: sizeFees['8'] || 0,
        size_10: sizeFees['10'] || 0,
        size_12: sizeFees['12'] || 0,
        size_15: sizeFees['15'] || 0,
        size_20: sizeFees['20'] || 0,
        size_30: sizeFees['30'] || 0,
        size_40: sizeFees['40'] || 0,
        size_50: sizeFees['50'] || 0,
        size_60: sizeFees['60'] || 0,
        size_70: sizeFees['70'] || 0,
        size_80: sizeFees['80'] || 0,
        size_90: sizeFees['90'] || 0,
        size_100: sizeFees['100'] || 0,
        size_125: sizeFees['125'] || 0,
        size_150: sizeFees['150'] || 0,
        size_175: sizeFees['175'] || 0,
        size_200: sizeFees['200'] || 0,
        size_250: sizeFees['250'] || 0,
        size_300: sizeFees['300'] || 0,
        size_350: sizeFees['350'] || 0,
        size_400: sizeFees['400'] || 0,
        size_500: sizeFees['500'] || 0,
        size_600: sizeFees['600'] || 0,
        size_700: sizeFees['700'] || 0,
        size_800: sizeFees['800'] || 0,
        size_900: sizeFees['900'] || 0,
        size_1000: sizeFees['1000'] || 0,
        size_1200: sizeFees['1200'] || 0,
        size_1400: sizeFees['1400'] || 0,
        size_1600: sizeFees['1600'] || 0,
        size_1800: sizeFees['1800'] || 0,
        size_2000: sizeFees['2000'] || 0,
      });

      if (this.newStatisticsEntryCallback && insertId) {
        const newStats = await statisticsApi.$get(insertId);
        if (newStats) {
          this.newStatisticsEntryCallback(newStats);
        }
      }
    } catch (e) {
      logger.err('Unable to insert statistics. ' + e);
    }
  }
}

export default new Statistics();
