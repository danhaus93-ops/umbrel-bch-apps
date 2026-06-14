import * as fs from 'fs';

describe('BCH Explorer Backend Config', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.resetModules();
  });

  test('should return defaults when no file is present', () => {
    jest.isolateModules(() => {
      jest.mock('../../explorer-config.json', () => ({}), { virtual: true });

      const config = jest.requireActual('../config').default;

      expect(config.EXPLORER).toStrictEqual({
        ENABLED: true,
        OFFICIAL: false,
        NETWORK: 'mainnet',
        BACKEND: 'none',
        BLOCKS_SUMMARIES_INDEXING: false,
        GOGGLES_INDEXING: false,
        HTTP_PORT: 8999,
        UNIX_SOCKET_PATH: '',
        SPAWN_CLUSTER_PROCS: 0,
        API_URL_PREFIX: '/api/v1/',
        AUTOMATIC_POOLS_UPDATE: false,
        POLL_RATE_MS: 2000,
        CACHE_DIR: './cache',
        CACHE_ENABLED: true,
        CLEAR_PROTECTION_MINUTES: 20,
        RECOMMENDED_FEE_PERCENTILE: 50,
        MIN_BLOCK_SIZE_UNITS: 32000000,
        INITIAL_BLOCKS_AMOUNT: 8,
        MEMPOOL_BLOCKS_AMOUNT: 1,
        INDEXING_BLOCKS_AMOUNT: 11000,
        USE_SECOND_NODE_FOR_MINFEE: false,
        EXTERNAL_ASSETS: [],
        EXTERNAL_MAX_RETRY: 1,
        EXTERNAL_RETRY_INTERVAL: 0,
        USER_AGENT: 'explorer',
        STDOUT_LOG_MIN_PRIORITY: 'debug',
        POOLS_JSON_TREE_URL: 'https://gitlab.melroy.org/api/v4/projects/199/repository/tree',
        POOLS_JSON_URL: 'https://gitlab.melroy.org/bitcoincash/mining-pools/-/raw/main/pools-v2.json',
        POOLS_UPDATE_DELAY: 604800,
        POOLS_SOURCE: 'gitlab',
        AUDIT: false,
        RUST_GBT: true,
        LIMIT_GBT: false,
        MAX_BLOCKS_BULK_QUERY: 0,
        DISK_CACHE_BLOCK_INTERVAL: 6,
        PRICE_UPDATES_PER_HOUR: 1,
        MAX_TRACKED_ADDRESSES: 1,
      });

      expect(config.ELECTRUM).toStrictEqual({
        HOST: '127.0.0.1',
        PORT: 50001,
        TLS_ENABLED: false,
      });

      expect(config.CORE_RPC).toStrictEqual({
        HOST: '127.0.0.1',
        PORT: 8332,
        USERNAME: 'explorer',
        PASSWORD: 'explorer',
        TIMEOUT: 60000,
        COOKIE: false,
        COOKIE_PATH: '/bitcoin/.cookie',
        DEBUG_LOG_PATH: '',
      });

      expect(config.SECOND_CORE_RPC).toStrictEqual({
        HOST: '127.0.0.1',
        PORT: 8332,
        USERNAME: 'explorer',
        PASSWORD: 'explorer',
        TIMEOUT: 60000,
        COOKIE: false,
        COOKIE_PATH: '/bitcoin/.cookie',
      });

      expect(config.DATABASE).toStrictEqual({
        ENABLED: true,
        HOST: '127.0.0.1',
        SOCKET: '',
        PORT: 3306,
        DATABASE: 'explorer',
        USERNAME: 'explorer',
        PASSWORD: 'explorer',
        TIMEOUT: 180000,
        PID_DIR: '',
        POOL_SIZE: 100,
      });

      expect(config.SYSLOG).toStrictEqual({
        ENABLED: true,
        HOST: '127.0.0.1',
        PORT: 514,
        MIN_PRIORITY: 'info',
        FACILITY: 'local7',
      });

      expect(config.STATISTICS).toStrictEqual({
        ENABLED: true,
        TX_PER_SECOND_SAMPLE_PERIOD: 150,
      });

      expect(config.SOCKS5PROXY).toStrictEqual({
        ENABLED: false,
        USE_ONION: true,
        HOST: '127.0.0.1',
        PORT: 9050,
        USERNAME: '',
        PASSWORD: '',
      });

      expect(config.EXTERNAL_DATA_SERVER).toStrictEqual({
        EXPLORER_API: 'https://bchexplorer.cash/api/v1',
        EXPLORER_ONION: 'http://upcomingtordomain.onion/api/v1',
      });

      expect(config.REPLICATION).toStrictEqual({
        ENABLED: false,
        AUDIT: false,
        AUDIT_START_HEIGHT: 774000,
        STATISTICS: false,
        STATISTICS_START_TIME: 1481932800,
        SERVERS: [],
      });

      expect(config.VALKEY).toStrictEqual({
        ENABLED: false,
        UNIX_SOCKET_PATH: '',
        BATCH_QUERY_BASE_SIZE: 5000,
      });

      expect(config.FIAT_PRICE).toStrictEqual({
        ENABLED: true,
        PAID: false,
        API_KEY: '',
      });

      expect(config.STRATUM).toStrictEqual({
        ENABLED: false,
        API: 'http://localhost:1234',
      });
    });
  });

  test('should override the default values with the passed values', () => {
    jest.isolateModules(() => {
      const fixture = JSON.parse(fs.readFileSync(`${__dirname}/../__fixtures__/explorer-config.template.json`, 'utf8'));
      jest.mock('../../explorer-config.json', () => fixture, { virtual: true });

      const config = jest.requireActual('../config').default;

      expect(config.EXPLORER).toStrictEqual(fixture.EXPLORER);

      expect(config.ELECTRUM).toStrictEqual(fixture.ELECTRUM);

      expect(config.CORE_RPC).toStrictEqual(fixture.CORE_RPC);

      expect(config.SECOND_CORE_RPC).toStrictEqual(fixture.SECOND_CORE_RPC);

      expect(config.DATABASE).toStrictEqual(fixture.DATABASE);

      expect(config.SYSLOG).toStrictEqual(fixture.SYSLOG);

      expect(config.STATISTICS).toStrictEqual(fixture.STATISTICS);

      expect(config.SOCKS5PROXY).toStrictEqual(fixture.SOCKS5PROXY);

      expect(config.EXTERNAL_DATA_SERVER).toStrictEqual(fixture.EXTERNAL_DATA_SERVER);

      expect(config.MELROY_EXPLORER_SERVICES).toStrictEqual(fixture.MELROY_EXPLORER_SERVICES);

      expect(config.VALKEY).toStrictEqual(fixture.VALKEY);
    });
  });

  test('should ensure the docker start.sh script has default values', () => {
    jest.isolateModules(() => {
      const startSh = fs.readFileSync(`${__dirname}/../../../docker/backend/start.sh`, 'utf-8');
      const fixture = JSON.parse(fs.readFileSync(`${__dirname}/../__fixtures__/explorer-config.template.json`, 'utf8'));

      function parseJson(jsonObj, root?) {
        for (const [key, value] of Object.entries(jsonObj)) {
          // We have a few cases where we can't follow the pattern
          if (root === 'EXPLORER' && key === 'HTTP_PORT') {
            continue;
          }

          if (root) {
            //The flattened string, i.e, __EXPLORER_ENABLED__
            const replaceStr = `${root ? '__' + root + '_' : '__'}${key}__`;

            //The string used as the environment variable, i.e, EXPLORER_ENABLED
            const envVarStr = `${root ? root : ''}_${key}`;

            let defaultEntry;
            //The string used as the default value, to be checked as a regex, i.e, __EXPLORER_ENABLED__=${EXPLORER_ENABLED:=(.*)}
            if (Array.isArray(value)) {
              defaultEntry = `${replaceStr}=\${${envVarStr}:=[]}`;
              //Regex matching does not work with the array values
              expect(startSh).toContain(defaultEntry);
            } else {
              defaultEntry = replaceStr + '=' + '\\${' + envVarStr + ':=(.*)' + '}';
              const re = new RegExp(defaultEntry);
              expect(startSh).toMatch(re);
            }

            //The string that actually replaces the values in the config file
            const sedStr = 'sed -i "s!' + replaceStr + '!${' + replaceStr + '}!g" explorer-config.json';
            expect(startSh).toContain(sedStr);
          } else {
            parseJson(value, key);
          }
        }
      }

      parseJson(fixture);
    });
  });

  test('should ensure that the explorer-config-template.json Docker template has all the keys', () => {
    jest.isolateModules(() => {
      const fixture = JSON.parse(fs.readFileSync(`${__dirname}/../__fixtures__/explorer-config.template.json`, 'utf8'));
      const dockerJson = fs.readFileSync(`${__dirname}/../../../docker/backend/explorer-config-template.json`, 'utf-8');

      function parseJson(jsonObj, root?) {
        for (const [key, value] of Object.entries(jsonObj)) {
          switch (typeof value) {
            case 'object': {
              if (Array.isArray(value)) {
                // numbers, arrays and booleans won't be enclosed by quotes
                const replaceStr = `${root ? '__' + root + '_' : '__'}${key}__`;
                expect(dockerJson).toContain(`"${key}": ${replaceStr}`);
                break;
              } else {
                //Check for top level config keys
                expect(dockerJson).toContain(`"${key}"`);
                parseJson(value, key);
                break;
              }
            }
            case 'string': {
              // strings should be enclosed by quotes
              const replaceStr = `${root ? '__' + root + '_' : '__'}${key}__`;
              expect(dockerJson).toContain(`"${key}": "${replaceStr}"`);
              break;
            }
            default: {
              // numbers, arrays and booleans won't be enclosed by quotes
              const replaceStr = `${root ? '__' + root + '_' : '__'}${key}__`;
              expect(dockerJson).toContain(`"${key}": ${replaceStr}`);
              break;
            }
          }
        }
      }
      parseJson(fixture);
    });
  });
});
