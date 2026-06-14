import { Application, Request, Response } from 'express';
import config from '../../config';
import statisticsApi from './statistics-api';
import { handleError } from '../../utils/api';
class StatisticsRoutes {
  public initRoutes(app: Application) {
    app
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/2h', this.$getStatisticsByTime.bind(this, '2h'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/24h', this.$getStatisticsByTime.bind(this, '24h'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/3d', this.$getStatisticsByTime.bind(this, '3d'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/1w', this.$getStatisticsByTime.bind(this, '1w'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/1m', this.$getStatisticsByTime.bind(this, '1m'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/3m', this.$getStatisticsByTime.bind(this, '3m'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/6m', this.$getStatisticsByTime.bind(this, '6m'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/1y', this.$getStatisticsByTime.bind(this, '1y'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/2y', this.$getStatisticsByTime.bind(this, '2y'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/3y', this.$getStatisticsByTime.bind(this, '3y'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/4y', this.$getStatisticsByTime.bind(this, '4y'))
      .get(config.EXPLORER.API_URL_PREFIX + 'statistics/all', this.$getStatisticsByTime.bind(this, 'all'));
  }

  private async $getStatisticsByTime(
    time: '2h' | '24h' | '3d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '4y' | 'all',
    req: Request,
    res: Response
  ) {
    res.header('Pragma', 'public');
    res.header('Cache-control', 'public');
    res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());

    try {
      let result;
      switch (time as string) {
        case '24h':
          result = await statisticsApi.$list24H();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
          break;
        case '3d':
          result = await statisticsApi.$list3D();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
          break;
        case '1w':
          result = await statisticsApi.$list1W();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 600).toUTCString());
          break;
        case '1m':
          result = await statisticsApi.$list1M();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 1800).toUTCString());
          break;
        case '3m':
          result = await statisticsApi.$list3M();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 3600).toUTCString());
          break;
        case '6m':
          result = await statisticsApi.$list6M();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 7200).toUTCString());
          break;
        case '1y':
          result = await statisticsApi.$list1Y();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 14400).toUTCString());
          break;
        case '2y':
          result = await statisticsApi.$list2Y();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 86400).toUTCString());
          break;
        case '3y':
          result = await statisticsApi.$list3Y();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 86400).toUTCString());
          break;
        case '4y':
          result = await statisticsApi.$list4Y();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 86400).toUTCString());
          break;
        case 'all':
          result = await statisticsApi.$listAll();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 86400).toUTCString());
          break;
        default:
          result = await statisticsApi.$list2H();
          res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
          break;
      }
      res.json(result);
    } catch (e) {
      handleError(req, res, 500, 'Failed to get statistics');
    }
  }
}

export default new StatisticsRoutes();
