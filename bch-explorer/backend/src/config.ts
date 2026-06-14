const configFromFile = require(
  process.env.EXPLORER_CONFIG_FILE ? process.env.EXPLORER_CONFIG_FILE : '../explorer-config.json'
);

interface IConfig {
  EXPLORER: {
    ENABLED: boolean;
    OFFICIAL: boolean;
    NETWORK: 'mainnet' | 'testnet4' | 'chipnet' | 'scalenet';
    BACKEND: 'electrum' | 'none';
    HTTP_PORT: number;
    UNIX_SOCKET_PATH: string;
    SPAWN_CLUSTER_PROCS: number;
    API_URL_PREFIX: string;
    POLL_RATE_MS: number;
    CACHE_DIR: string;
    CACHE_ENABLED: boolean;
    CLEAR_PROTECTION_MINUTES: number;
    RECOMMENDED_FEE_PERCENTILE: number;
    MIN_BLOCK_SIZE_UNITS: number;
    INITIAL_BLOCKS_AMOUNT: number;
    MEMPOOL_BLOCKS_AMOUNT: number;
    INDEXING_BLOCKS_AMOUNT: number;
    BLOCKS_SUMMARIES_INDEXING: boolean;
    GOGGLES_INDEXING: boolean;
    USE_SECOND_NODE_FOR_MINFEE: boolean;
    EXTERNAL_ASSETS: string[];
    EXTERNAL_MAX_RETRY: number;
    EXTERNAL_RETRY_INTERVAL: number;
    USER_AGENT: string;
    STDOUT_LOG_MIN_PRIORITY: 'emerg' | 'alert' | 'crit' | 'err' | 'warn' | 'notice' | 'info' | 'debug';
    AUTOMATIC_POOLS_UPDATE: boolean;
    POOLS_JSON_URL: string;
    POOLS_JSON_TREE_URL: string;
    POOLS_UPDATE_DELAY: number;
    POOLS_SOURCE: 'gitlab' | 'github';
    AUDIT: boolean;
    RUST_GBT: boolean;
    LIMIT_GBT: boolean;
    MAX_BLOCKS_BULK_QUERY: number;
    DISK_CACHE_BLOCK_INTERVAL: number;
    PRICE_UPDATES_PER_HOUR: number;
    MAX_TRACKED_ADDRESSES: number;
  };
  ELECTRUM: {
    HOST: string;
    PORT: number;
    TLS_ENABLED: boolean;
  };
  CORE_RPC: {
    HOST: string;
    PORT: number;
    USERNAME: string;
    PASSWORD: string;
    TIMEOUT: number;
    COOKIE: boolean;
    COOKIE_PATH: string;
    DEBUG_LOG_PATH: string;
  };
  SECOND_CORE_RPC: {
    HOST: string;
    PORT: number;
    USERNAME: string;
    PASSWORD: string;
    TIMEOUT: number;
    COOKIE: boolean;
    COOKIE_PATH: string;
  };
  DATABASE: {
    ENABLED: boolean;
    HOST: string;
    SOCKET: string;
    PORT: number;
    DATABASE: string;
    USERNAME: string;
    PASSWORD: string;
    TIMEOUT: number;
    PID_DIR: string;
    POOL_SIZE: number;
  };
  SYSLOG: {
    ENABLED: boolean;
    HOST: string;
    PORT: number;
    MIN_PRIORITY: 'emerg' | 'alert' | 'crit' | 'err' | 'warn' | 'notice' | 'info' | 'debug';
    FACILITY: string;
  };
  STATISTICS: {
    ENABLED: boolean;
    TX_PER_SECOND_SAMPLE_PERIOD: number;
  };
  SOCKS5PROXY: {
    ENABLED: boolean;
    USE_ONION: boolean;
    HOST: string;
    PORT: number;
    USERNAME: string;
    PASSWORD: string;
  };
  EXTERNAL_DATA_SERVER: {
    EXPLORER_API: string;
    EXPLORER_ONION: string;
  };
  REPLICATION: {
    ENABLED: boolean;
    AUDIT: boolean;
    AUDIT_START_HEIGHT: number;
    STATISTICS: boolean;
    STATISTICS_START_TIME: number | string;
    SERVERS: string[];
  };
  MELROY_EXPLORER_SERVICES: {
    API: string;
  };
  VALKEY: {
    ENABLED: boolean;
    UNIX_SOCKET_PATH: string;
    BATCH_QUERY_BASE_SIZE: number;
  };
  FIAT_PRICE: {
    ENABLED: boolean;
    PAID: boolean;
    API_KEY: string;
  };
  WALLETS: {
    ENABLED: boolean;
    AUTO: boolean;
    WALLETS: string[];
  };
  STRATUM: {
    ENABLED: boolean;
    API: string;
  };
}

const defaults: IConfig = {
  EXPLORER: {
    ENABLED: true,
    OFFICIAL: false,
    NETWORK: 'mainnet',
    BACKEND: 'none',
    HTTP_PORT: 8999,
    UNIX_SOCKET_PATH: '',
    SPAWN_CLUSTER_PROCS: 0,
    API_URL_PREFIX: '/api/v1/',
    POLL_RATE_MS: 2000,
    CACHE_DIR: './cache',
    CACHE_ENABLED: true,
    CLEAR_PROTECTION_MINUTES: 20,
    RECOMMENDED_FEE_PERCENTILE: 50,
    MIN_BLOCK_SIZE_UNITS: 32000000,
    INITIAL_BLOCKS_AMOUNT: 8,
    MEMPOOL_BLOCKS_AMOUNT: 1,
    INDEXING_BLOCKS_AMOUNT: 11000, // 0 = disable indexing, -1 = index all blocks
    BLOCKS_SUMMARIES_INDEXING: false,
    GOGGLES_INDEXING: false,
    USE_SECOND_NODE_FOR_MINFEE: false,
    EXTERNAL_ASSETS: [],
    EXTERNAL_MAX_RETRY: 1,
    EXTERNAL_RETRY_INTERVAL: 0,
    USER_AGENT: 'explorer',
    STDOUT_LOG_MIN_PRIORITY: 'debug',
    AUTOMATIC_POOLS_UPDATE: false,
    POOLS_JSON_URL: 'https://gitlab.melroy.org/bitcoincash/mining-pools/-/raw/main/pools-v2.json',
    POOLS_JSON_TREE_URL: 'https://gitlab.melroy.org/api/v4/projects/199/repository/tree',
    POOLS_UPDATE_DELAY: 604800, // in seconds, default is one week
    POOLS_SOURCE: 'gitlab',
    AUDIT: false,
    RUST_GBT: true,
    LIMIT_GBT: false,
    MAX_BLOCKS_BULK_QUERY: 0,
    DISK_CACHE_BLOCK_INTERVAL: 6,
    PRICE_UPDATES_PER_HOUR: 1,
    MAX_TRACKED_ADDRESSES: 1,
  },
  ELECTRUM: {
    HOST: '127.0.0.1',
    PORT: 50001,
    TLS_ENABLED: false,
  },
  CORE_RPC: {
    HOST: '127.0.0.1',
    PORT: 8332,
    USERNAME: 'explorer',
    PASSWORD: 'explorer',
    TIMEOUT: 60000,
    COOKIE: false,
    COOKIE_PATH: '/bitcoin/.cookie',
    DEBUG_LOG_PATH: '',
  },
  SECOND_CORE_RPC: {
    HOST: '127.0.0.1',
    PORT: 8332,
    USERNAME: 'explorer',
    PASSWORD: 'explorer',
    TIMEOUT: 60000,
    COOKIE: false,
    COOKIE_PATH: '/bitcoin/.cookie',
  },
  DATABASE: {
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
  },
  SYSLOG: {
    ENABLED: true,
    HOST: '127.0.0.1',
    PORT: 514,
    MIN_PRIORITY: 'info',
    FACILITY: 'local7',
  },
  STATISTICS: {
    ENABLED: true,
    TX_PER_SECOND_SAMPLE_PERIOD: 150,
  },
  SOCKS5PROXY: {
    ENABLED: false,
    USE_ONION: true,
    HOST: '127.0.0.1',
    PORT: 9050,
    USERNAME: '',
    PASSWORD: '',
  },
  EXTERNAL_DATA_SERVER: {
    EXPLORER_API: 'https://bchexplorer.cash/api/v1',
    EXPLORER_ONION: 'http://upcomingtordomain.onion/api/v1',
  },
  REPLICATION: {
    ENABLED: false,
    AUDIT: false,
    AUDIT_START_HEIGHT: 774000,
    STATISTICS: false,
    STATISTICS_START_TIME: 1481932800,
    SERVERS: [],
  },
  MELROY_EXPLORER_SERVICES: {
    API: '',
  },
  VALKEY: {
    ENABLED: false,
    UNIX_SOCKET_PATH: '',
    BATCH_QUERY_BASE_SIZE: 5000,
  },
  FIAT_PRICE: {
    ENABLED: true,
    PAID: false,
    API_KEY: '',
  },
  WALLETS: {
    ENABLED: false,
    AUTO: false,
    WALLETS: [],
  },
  STRATUM: {
    ENABLED: false,
    API: 'http://localhost:1234',
  },
};

class Config implements IConfig {
  EXPLORER: IConfig['EXPLORER'];
  ELECTRUM: IConfig['ELECTRUM'];
  CORE_RPC: IConfig['CORE_RPC'];
  SECOND_CORE_RPC: IConfig['SECOND_CORE_RPC'];
  DATABASE: IConfig['DATABASE'];
  SYSLOG: IConfig['SYSLOG'];
  STATISTICS: IConfig['STATISTICS'];
  SOCKS5PROXY: IConfig['SOCKS5PROXY'];
  EXTERNAL_DATA_SERVER: IConfig['EXTERNAL_DATA_SERVER'];
  REPLICATION: IConfig['REPLICATION'];
  MELROY_EXPLORER_SERVICES: IConfig['MELROY_EXPLORER_SERVICES'];
  VALKEY: IConfig['VALKEY'];
  FIAT_PRICE: IConfig['FIAT_PRICE'];
  WALLETS: IConfig['WALLETS'];
  STRATUM: IConfig['STRATUM'];

  constructor() {
    const configs = this.merge(configFromFile, defaults);
    this.EXPLORER = configs.EXPLORER;

    this.ELECTRUM = configs.ELECTRUM;
    this.CORE_RPC = configs.CORE_RPC;
    this.SECOND_CORE_RPC = configs.SECOND_CORE_RPC;
    this.DATABASE = configs.DATABASE;
    this.SYSLOG = configs.SYSLOG;
    this.STATISTICS = configs.STATISTICS;
    this.SOCKS5PROXY = configs.SOCKS5PROXY;
    this.EXTERNAL_DATA_SERVER = configs.EXTERNAL_DATA_SERVER;
    this.REPLICATION = configs.REPLICATION;
    this.MELROY_EXPLORER_SERVICES = configs.MELROY_EXPLORER_SERVICES;
    this.VALKEY = configs.VALKEY;
    this.FIAT_PRICE = configs.FIAT_PRICE;
    this.WALLETS = configs.WALLETS;
    this.STRATUM = configs.STRATUM;
  }

  merge = (...objects: object[]): IConfig => {
    // @ts-ignore
    return objects.reduce((prev, next) => {
      Object.keys(prev).forEach((key) => {
        Object.assign(next[key], prev[key]);
      });
      return next;
    });
  };
}

export default new Config();
