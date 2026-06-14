# Docker Installation

This directory contains the Dockerfiles used to build and release the official images, as well as a `docker-compose.yml` to configure environment variables and other settings.

If you are looking to use these Docker images to deploy your own instance of BCH Explorer, note that they only containerize BCH Explorer's frontend and backend. You will still need to deploy and configure Bitcoin Cash Node and an Electrum Server separately, along with any other utilities specific to your use case (e.g., a reverse proxy, etc). Such configuration is mostly beyond the scope of the BCH Explorer project, so please only proceed if you know what you're doing.

See a video guide of this installation method by k3tan [on BitcoinTV.com](https://bitcointv.com/w/8fpAx6rf5CQ16mMhospwjg).

Jump to a section in this doc:

- [Configure with Bitcoin Cash Node Only](#configure-with-bitcoin-cash-node-only)
- [Configure with Bitcoin Cash Node + Electrum Server](#configure-with-bitcoin-cash-node--electrum-server)
- [Further Configuration](#further-configuration)

## Configure with Bitcoin Cash Node Only

_Note: address lookups require an Electrum Server and will not work with this configuration. [Add an Electrum Server](#configure-with-bitcoin-cash-node--electrum-server) to your backend for full functionality._

The default Docker configuration assumes you have the following configuration in your `bitcoin.conf` file:

```ini
txindex=1
server=1
rpcuser=explorer
rpcpassword=explorer
```

If you want to use different credentials, specify them in the `docker-compose.yml` file:

```yaml
api:
  environment:
    EXPLORER_BACKEND: "none"
    CORE_RPC_HOST: "172.27.0.1"
    CORE_RPC_PORT: "8332"
    CORE_RPC_USERNAME: "customuser"
    CORE_RPC_PASSWORD: "custompassword"
    CORE_RPC_TIMEOUT: "60000"
```

The IP address in the example above refers to Docker's default gateway IP address so that the container can hit the `bitcoind` instance running on the host machine. If your setup is different, update it accordingly.

Make sure `bitcoind` is running and synced.

Now, run:

```bash
docker-compose up
```

Your BCH Explorer instance should be running at http://localhost. The graphs will be populated as new transactions are detected.

## Configure with Bitcoin Cash Node + Electrum Server

First, configure `bitcoind` as specified above, and make sure your Electrum Server is running and synced. See [this FAQ](https://bchexplorer.cash/docs/faq#address-lookup-issues) if you need help picking an Electrum Server implementation.

Then, set the following variables in `docker-compose.yml` so BCH Explorer can connect to your Electrum Server:

```yaml
api:
  environment:
    EXPLORER_BACKEND: "electrum"
    ELECTRUM_HOST: "172.27.0.1"
    ELECTRUM_PORT: "50002"
    ELECTRUM_TLS_ENABLED: "false"
```

Eligible values for `EXPLORER_BACKEND`:

- "electrum" if you're using [cculianu/Fulcrum](https://github.com/cculianu/Fulcrum)
- "none" if you're not using any Electrum Server

Of course, if your Docker host IP address is different, update accordingly.

With `bitcoind` (BCHN) and Electrum Server set up, run BCH Explorer with:

```bash
docker-compose up
```

## Further Configuration

Optionally, you can override any other backend settings from `explorer-config.json`.

Below we list all settings from `explorer-config.json` and the corresponding overrides you can make in the `api` > `environment` section of `docker-compose.yml`.

<br/>

`explorer-config.json`:

```json
  "EXPLORER": {
    "NETWORK": "mainnet",
    "BACKEND": "electrum",
    "ENABLED": true,
    "HTTP_PORT": 8999,
    "SPAWN_CLUSTER_PROCS": 0,
    "API_URL_PREFIX": "/api/v1/",
    "POLL_RATE_MS": 2000,
    "CACHE_DIR": "./cache",
    "CLEAR_PROTECTION_MINUTES": 20,
    "RECOMMENDED_FEE_PERCENTILE": 50,
    "MIN_BLOCK_SIZE_UNITS": 32000000,
    "INITIAL_BLOCKS_AMOUNT": 8,
    "MEMPOOL_BLOCKS_AMOUNT": 1,
    "BLOCKS_SUMMARIES_INDEXING": false,
    "USE_SECOND_NODE_FOR_MINFEE": false,
    "EXTERNAL_ASSETS": [],
    "STDOUT_LOG_MIN_PRIORITY": "info",
    "INDEXING_BLOCKS_AMOUNT": false,
    "AUTOMATIC_POOLS_UPDATE": false,
    "POOLS_JSON_URL": "https://gitlab.melroy.org/bitcoincash/mining-pools/-/raw/main/pools-v2.json",
    "POOLS_JSON_TREE_URL": "https://gitlab.melroy.org/api/v4/projects/199/repository/tree",
    "POOLS_UPDATE_DELAY": 604800,
    "POOLS_SOURCE": "gitlab",
    "MAX_BLOCKS_BULK_QUERY": 0,
    "DISK_CACHE_BLOCK_INTERVAL": 6,
    "PRICE_UPDATES_PER_HOUR": 1
  },
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      EXPLORER_NETWORK: ""
      EXPLORER_BACKEND: ""
      BACKEND_HTTP_PORT: ""
      EXPLORER_SPAWN_CLUSTER_PROCS: ""
      EXPLORER_API_URL_PREFIX: ""
      EXPLORER_POLL_RATE_MS: ""
      EXPLORER_CACHE_DIR: ""
      EXPLORER_CLEAR_PROTECTION_MINUTES: ""
      EXPLORER_RECOMMENDED_FEE_PERCENTILE: ""
      EXPLORER_MIN_BLOCK_SIZE_UNITS: ""
      EXPLORER_INITIAL_BLOCKS_AMOUNT: ""
      EXPLORER_MEMPOOL_BLOCKS_AMOUNT: ""
      EXPLORER_BLOCKS_SUMMARIES_INDEXING: ""
      EXPLORER_USE_SECOND_NODE_FOR_MINFEE: ""
      EXPLORER_EXTERNAL_ASSETS: ""
      EXPLORER_STDOUT_LOG_MIN_PRIORITY: ""
      EXPLORER_INDEXING_BLOCKS_AMOUNT: ""
      EXPLORER_AUTOMATIC_POOLS_UPDATE: ""
      EXPLORER_POOLS_JSON_URL: ""
      EXPLORER_POOLS_JSON_TREE_URL: ""
      EXPLORER_POOLS_UPDATE_DELAY: ""
      EXPLORER_POOLS_SOURCE: ""
      EXPLORER_MAX_BLOCKS_BULK_QUERY: ""
      EXPLORER_DISK_CACHE_BLOCK_INTERVAL: ""
      EXPLORER_PRICE_UPDATES_PER_HOUR: ""
      EXPLORER_MAX_TRACKED_ADDRESSES: ""
      ...
```

<br/>

`explorer-config.json`:

```json
  "CORE_RPC": {
    "HOST": "127.0.0.1",
    "PORT": 8332,
    "USERNAME": "explorer",
    "PASSWORD": "explorer",
    "TIMEOUT": 60000,
    "COOKIE": false,
    "COOKIE_PATH": ""
  },
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      CORE_RPC_HOST: ""
      CORE_RPC_PORT: ""
      CORE_RPC_USERNAME: ""
      CORE_RPC_PASSWORD: ""
      CORE_RPC_TIMEOUT: 60000
      CORE_RPC_COOKIE: false
      CORE_RPC_COOKIE_PATH: ""
      ...
```

<br/>

`explorer-config.json`:

```json
  "ELECTRUM": {
    "HOST": "127.0.0.1",
    "PORT": 50002,
    "TLS_ENABLED": true
  },
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      ELECTRUM_HOST: ""
      ELECTRUM_PORT: ""
      ELECTRUM_TLS_ENABLED: ""
      ...
```

<br/>

`explorer-config.json`:

```json
  "SECOND_CORE_RPC": {
    "HOST": "127.0.0.1",
    "PORT": 8332,
    "USERNAME": "explorer",
    "PASSWORD": "explorer",
    "TIMEOUT": 60000,
    "COOKIE": false,
    "COOKIE_PATH": ""
  },
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      SECOND_CORE_RPC_HOST: ""
      SECOND_CORE_RPC_PORT: ""
      SECOND_CORE_RPC_USERNAME: ""
      SECOND_CORE_RPC_PASSWORD: ""
      SECOND_CORE_RPC_TIMEOUT: ""
      SECOND_CORE_RPC_COOKIE: false
      SECOND_CORE_RPC_COOKIE_PATH: ""
      ...
```

<br/>

`explorer-config.json`:

```json
  "DATABASE": {
    "ENABLED": true,
    "HOST": "127.0.0.1",
    "PORT": 3306,
    "DATABASE": "explorer",
    "USERNAME": "explorer",
    "PASSWORD": "explorer"
  },
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      DATABASE_ENABLED: ""
      DATABASE_HOST: ""
      DATABASE_PORT: ""
      DATABASE_DATABASE: ""
      DATABASE_USERNAME: ""
      DATABASE_PASSWORD: ""
      DATABASE_TIMEOUT: ""
      ...
```

<br/>

`explorer-config.json`:

```json
  "SYSLOG": {
    "ENABLED": true,
    "HOST": "127.0.0.1",
    "PORT": 514,
    "MIN_PRIORITY": "info",
    "FACILITY": "local7"
  },
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      SYSLOG_ENABLED: ""
      SYSLOG_HOST: ""
      SYSLOG_PORT: ""
      SYSLOG_MIN_PRIORITY: ""
      SYSLOG_FACILITY: ""
      ...
```

<br/>

`explorer-config.json`:

```json
  "STATISTICS": {
    "ENABLED": true,
    "TX_PER_SECOND_SAMPLE_PERIOD": 150
  },
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      STATISTICS_ENABLED: ""
      STATISTICS_TX_PER_SECOND_SAMPLE_PERIOD: ""
      ...
```

<br/>

`explorer-config.json`:

```json
  "SOCKS5PROXY": {
    "ENABLED": false,
    "HOST": "127.0.0.1",
    "PORT": "9050",
    "USERNAME": "",
    "PASSWORD": ""
  }
```

Corresponding `docker-compose.yml` overrides:

```yaml
  api:
    environment:
      SOCKS5PROXY_ENABLED: ""
      SOCKS5PROXY_HOST: ""
      SOCKS5PROXY_PORT: ""
      SOCKS5PROXY_USERNAME: ""
      SOCKS5PROXY_PASSWORD: ""
      ...
```
