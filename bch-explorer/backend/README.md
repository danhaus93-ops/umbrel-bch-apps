# BCH Explorer Backend

These instructions are mostly intended for developers.

If you choose to use these instructions for a production setup, be aware that you will still probably need to do additional configuration for your specific OS, environment, use-case, etc.

See other ways to set up BCH Explorer on [the main README](/../../#installation-methods).

Jump to a section in this doc:

- [Set Up the Backend](#setup)
- [Development Tips](#development-tips)

## Setup

### 1. Clone BCH Explorer Repository

Get the latest BCH Explorer code:

```sh
git clone https://gitlab.melroy.org/bitcoincash/bitcoin-cash-explorer.git
cd bitcoin-cash-explorer
```

Check out the latest release:

```sh
latestrelease=$(curl -s https://gitlab.melroy.org/latest/release/....|grep tag_name|head -1|cut -d '"' -f4)
git checkout $latestrelease
```

### 2. Configure Bitcoin Core

Turn on `txindex`, enable RPC, and set RPC credentials in `bitcoin.conf`:

```ini
txindex=1
server=1
rpcuser=explorer
rpcpassword=explorer
```

### 3. Configure Electrum Server

[Pick an Electrum Server implementation](https://bchexplorer.cash/docs/faq#address-lookup-issues), configure it, and make sure it's synced.

**This step is optional.** You can run BCH Explorer without configuring an Electrum Server for it, but address lookups will be disabled.

### 4. Configure MariaDB

_BCH Explorer needs MariaDB v10.5 or later. If you already have MySQL installed, make sure to migrate any existing databases **before** installing MariaDB._

Get MariaDB from your operating system's package manager:

```
# Debian, Ubuntu, etc.
apt install mariadb-server mariadb-client

# macOS
brew install mariadb
mysql.server start
```

Create a database and grant privileges:

```
MariaDB [(none)]> drop database explorer;
Query OK, 0 rows affected (0.00 sec)

MariaDB [(none)]> create database explorer;
Query OK, 1 row affected (0.00 sec)

MariaDB [(none)]> grant all privileges on explorer.* to 'explorer'@'%' identified by 'explorer';
Query OK, 0 rows affected (0.00 sec)
```

### 5. Prepare BCH Explorer Backend

#### Build

_Make sure to use Node.js 24.x and [pnpm 10.x or newer](https://pnpm.io/installation)_

_The build process requires [Rust](https://www.rust-lang.org/tools/install) to be installed._

Install dependencies with `pnpm`, run the preinstall script, then install and finally build the backend:

```sh
cd backend
# Run preinstall first (pnpm doesn't run it automatically for security reasons)
pnpm preinstall
pnpm install
pnpm build
```

#### Configure

In the backend folder, make a copy of the sample config file:

```sh
cp explorer-config.sample.json explorer-config.json
```

Edit `explorer-config.json` as needed.

In particular, make sure:

- the correct Bitcoin Cash Node RPC credentials are specified in `CORE_RPC`
- the correct `BACKEND` is specified in `explorer`:
  - "electrum" for [cculianu/Fulcrum](https://github.com/cculianu/Fulcrum)
  - "none" if you're not using any Electrum Server

### 6. Run BCH Explorer Backend

Run the BCH Explorer backend:

```sh
pnpm start
```

You can also set env var `EXPLORER_CONFIG_FILE` to specify a custom config file location:

```sh
EXPLORER_CONFIG_FILE=/path/to/explorer-config.json pnpm start
```

When it's running, you should see output like this:

```sh
BCH Explorer updated in 0.189 seconds
Updating BCH Explorer
BCH Explorer updated in 0.096 seconds
Updating BCH Explorer
BCH Explorer updated in 0.099 seconds
Updating BCH Explorer
Calculated fee for transaction 1 / 10
Calculated fee for transaction 2 / 10
Calculated fee for transaction 3 / 10
Calculated fee for transaction 4 / 10
Calculated fee for transaction 5 / 10
Calculated fee for transaction 6 / 10
Calculated fee for transaction 7 / 10
Calculated fee for transaction 8 / 10
Calculated fee for transaction 9 / 10
Calculated fee for transaction 10 / 10
BCH Explorer updated in 0.243 seconds
Updating BCH Explorer
```

### 7. Set Up BCH Explorer Frontend

With the backend configured and running, proceed to set up the [BCH Explorer frontend](../frontend#manual-setup).

## Development Tips

### Set Up Backend Watchers

The BCH Explorer backend is static. TypeScript scripts are compiled into the `dist` folder and served through a Node.js web server.

As a result, for development purposes, you may find it helpful to set up backend watchers to avoid the manual shutdown/recompile/restart command-line cycle.

First, install `nodemon` and `ts-node`:

```sh
pnpm install -g ts-node nodemon
```

Then, run the watcher:

```sh
nodemon src/index.ts --ignore cache/
```

`nodemon` should be in pnpm's global binary folder. If needed, you can determine where that is with `pnpm -g bin`.

### Useful Regtest Commands

Helpful link: https://gist.github.com/System-Glitch/cb4e87bf1ae3fec9925725bb3ebe223a

Run bitcoind on regtest:

```sh
bitcoind -regtest
```

Create a new wallet, if needed:

```sh
bitcoin-cli -regtest createwallet test
```

Load wallet (this command may take a while if you have a lot of UTXOs):

```sh
bitcoin-cli -regtest loadwallet test
```

Get a new address:

```sh
address=$(bitcoin-cli -regtest getnewaddress)
```

Mine blocks to the previously generated address. You need at least 101 blocks before you can spend. This will take some time to execute (~1 min):

```sh
bitcoin-cli -regtest generatetoaddress 101 $address
```

Send 0.1 BTC at 5 sat/vB to another address:

```sh
bitcoin-cli -named -regtest sendtoaddress address=$(bitcoin-cli -regtest getnewaddress) amount=0.1 fee_rate=5
```

See more example of `sendtoaddress`:

```sh
bitcoin-cli sendtoaddress # will print the help
```

Mini script to generate random network activity (random TX count with random tx fee-rate). It's slow so don't expect to use this to test BCH Explorer spam, except if you let it run for a long time, or maybe with multiple regtest nodes connected to each other.

```sh
#!/bin/bash
address=$(bitcoin-cli -regtest getnewaddress)
bitcoin-cli -regtest generatetoaddress 101 $address
for i in {1..1000000}
do
   for y in $(seq 1 "$(jot -r 1 1 1000)")
   do
      bitcoin-cli -regtest -named sendtoaddress address=$address amount=0.01 fee_rate=$(jot -r 1 1 100)
   done
   bitcoin-cli -regtest generatetoaddress 1 $address
   sleep 5
done
```

Generate block at regular interval (every 10 seconds in this example):

```sh
watch -n 10 "bitcoin-cli -regtest generatetoaddress 1 $address"
```

### Mining pools update

By default, mining pools will be not automatically updated regularly (`config.explorer.AUTOMATIC_POOLS_UPDATE` is set to `false`).

To manually update your mining pools, you can use the `--update-pools` command line flag when you run the nodejs backend. For example `pnpm start --update-pools`. This will trigger the mining pools update and automatically re-index appropriate blocks.

You can enable the automatic mining pools update by settings `config.explorer.AUTOMATIC_POOLS_UPDATE` to `true` in your `explorer-config.json`.

When a `coinbase tag` or `coinbase address` change is detected, pool assignments for all relevant blocks (tagged to that pool or the `unknown` mining pool, starting from height 130635) are updated using the new criteria.

### Re-index tables

You can manually force the nodejs backend to drop all data from a specified set of tables for future re-index. This is mostly useful for the mining dashboard.

Use the `--reindex-blocks` command to truncate the `blocks`, `hashrates`, `difficulty_adjustments`, and `pools` tables. Note that a 5 seconds delay will be observed before truncating tables in order to give you a chance to cancel (CTRL+C) in case of misuse of the command.

Usage:

```sh
pnpm start --reindex-blocks
```

Example output:

```sh
Feb 13 14:55:27 [63246] WARN: Truncating pools, blocks, hashrates and difficulty_adjustments tables for re-indexing (using '--reindex-blocks'). You can cancel this command within 5 seconds
```
