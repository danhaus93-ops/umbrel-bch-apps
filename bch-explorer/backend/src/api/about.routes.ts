import { Application } from 'express';
import config from '../config';
import axios from 'axios';

class AboutRoutes {
  public initRoutes(app: Application) {
    app
      .get(config.EXPLORER.API_URL_PREFIX + 'donations', async (req, res) => {
        try {
          const response = await axios.get(`${config.EXTERNAL_DATA_SERVER.EXPLORER_API}/donations`, {
            responseType: 'stream',
            timeout: 10000,
          });
          response.data.pipe(res);
        } catch (e) {
          res.status(500).end();
        }
      })
      .get(config.EXPLORER.API_URL_PREFIX + 'donations/images/:id', async (req, res) => {
        try {
          const response = await axios.get(
            `${config.EXTERNAL_DATA_SERVER.EXPLORER_API}/donations/images/${req.params.id}`,
            {
              responseType: 'stream',
              timeout: 10000,
            }
          );
          response.data.pipe(res);
        } catch (e) {
          res.status(500).end();
        }
      })
      .get(config.EXPLORER.API_URL_PREFIX + 'contributors', async (req, res) => {
        try {
          const response = await axios.get(`${config.EXTERNAL_DATA_SERVER.EXPLORER_API}/contributors`, {
            responseType: 'stream',
            timeout: 10000,
          });
          response.data.pipe(res);
        } catch (e) {
          res.status(500).end();
        }
      })
      .get(config.EXPLORER.API_URL_PREFIX + 'contributors/images/:id', async (req, res) => {
        try {
          const response = await axios.get(
            `${config.EXTERNAL_DATA_SERVER.EXPLORER_API}/contributors/images/${req.params.id}`,
            {
              responseType: 'stream',
              timeout: 10000,
            }
          );
          response.data.pipe(res);
        } catch (e) {
          res.status(500).end();
        }
      })
      .get(config.EXPLORER.API_URL_PREFIX + 'translators', async (req, res) => {
        try {
          const response = await axios.get(`${config.EXTERNAL_DATA_SERVER.EXPLORER_API}/translators`, {
            responseType: 'stream',
            timeout: 10000,
          });
          response.data.pipe(res);
        } catch (e) {
          res.status(500).end();
        }
      })
      .get(config.EXPLORER.API_URL_PREFIX + 'translators/images/:id', async (req, res) => {
        try {
          const response = await axios.get(
            `${config.EXTERNAL_DATA_SERVER.EXPLORER_API}/translators/images/${req.params.id}`,
            {
              responseType: 'stream',
              timeout: 10000,
            }
          );
          response.data.pipe(res);
        } catch (e) {
          res.status(500).end();
        }
      });
  }
}

export default new AboutRoutes();
