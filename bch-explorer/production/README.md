# Deploying an Production Instance

These instructions are for setting up a serious production BCH Explorer for Bitcoin Cash (mainnet, testnet3).

<!-- Users should use [one of the other installation methods](../#installation-methods). -->

### Server Hardware

BCH Explorer (bchexplorer.cash) is powered by [Fulcrum v2](https://github.com/cculianu/Fulcrum), which is a beast.

I do recommend a beefy server:

- 12-core CPU (more is better)
- 32GB RAM (more is better)
- 4TB SSD (NVMe is better)

### HDD vs SSD vs NVMe

If you don't have a fast SSD or NVMe-backed disk, that's fine—go online and buy some fast new NVMe drives. When they arrive, install them, throw away your old HDDs, and then proceed with the rest of this guide.

## Ubuntu Server

The Bch Explorer (bchexplorer.cash) is running on Ubuntu Server 24.04 LTS.

Although it is possible to run the explorer on a FreeBSD with ZFS root and ARC cache as well.

### Filesystem

I'm using a Proxmox instance with 2x 1TB NVMe WD_Black SN850 (in software RAID 1) for the VM storage.

And I use a dedicated 1x 4TB SSD Crucial MX500 NVMe disk for the storage of both the Bitcoin Cash blockchain and the Fulcrum v2 database.

For maximum performance, you could use 2x 2TB NVMe SSDs in a RAID 0 using ZFS with lots of RAM for the ARC L2 cache.

Below is an example of the filesystem layout on my Proxmox instance running Debian Linux:

```sh
NAME                              FSTYPE            FSVER    LABEL       UUID                                   FSAVAIL FSUSE% MOUNTPOINTS
sda                                                                                                                            
└─sda1                            ext4              1.0                  d735981d-599b-4ebd-8818-d467567d03ee                  
sdb                                                                                                                            
├─sdb1                                                                                                                         
├─sdb2                            vfat              FAT32                5322-BE17                                             
└─sdb3                            linux_raid_member 1.2      pve:2       5206d460-2cdb-457c-03c3-1a4e90eb5787                  
  └─md2                           LVM2_member       LVM2 001             EIldm3-urYS-aNRq-M5Z9-Fq0k-7735-AjCNQ0                
    ├─pve-swap                    swap              1                    b4ae2e49-687e-401f-a330-62061abfc2a3                  [SWAP]
    └─pve-root                    ext4              1.0                  41a5882a-9e0d-495a-b426-cc25f07d28ea    700,5G    19% /
sdc                                                                                                                            
├─sdc1                                                                                                                         
├─sdc2                            vfat              FAT32                5322-BE17                              1013,2M     1% /boot/efi
└─sdc3                            linux_raid_member 1.2      pve:2       5206d460-2cdb-457c-03c3-1a4e90eb5787                  
  └─md2                           LVM2_member       LVM2 001             EIldm3-urYS-aNRq-M5Z9-Fq0k-7735-AjCNQ0                
    ├─pve-swap                    swap              1                    b4ae2e49-687e-401f-a330-62061abfc2a3                  [SWAP]
    └─pve-root                    ext4              1.0                  41a5882a-9e0d-495a-b426-cc25f07d28ea    700,5G    19% /
nvme3n1                                                                                                                        
└─nvme3n1p1                       linux_raid_member 1.2      server:data bd5fca6c-99e2-0681-47d2-d1607df645c5                  
nvme2n1                                                                                                                        
└─nvme2n1p1                       linux_raid_member 1.2      server:data bd5fca6c-99e2-0681-47d2-d1607df645c5                  
nvme0n1                                                                                                                        
└─nvme0n1p1                       linux_raid_member 1.2      pve:lvmdata 251a7c75-4e3a-62b0-eaa4-d48fcd8fd697                  
  └─md127                         LVM2_member       LVM2 001             UZRvRF-6UR3-Gd7i-2xHy-WRkv-3ahP-snteKb                
    ├─vmdata-vmstore_tmeta                                                                                                     
    │ └─vmdata-vmstore-tpool                                                                                                   
    │   ├─vmdata-vmstore                                                                                                       
    │   └─vmdata-vm--100--disk--0                                                                                              
    └─vmdata-vmstore_tdata                                                                                                     
      └─vmdata-vmstore-tpool                                                                                                   
        ├─vmdata-vmstore                                                                                                       
        └─vmdata-vm--100--disk--0                                                                                              
nvme1n1                                                                                                                        
└─nvme1n1p1                       linux_raid_member 1.2      pve:lvmdata 251a7c75-4e3a-62b0-eaa4-d48fcd8fd697                  
  └─md127                         LVM2_member       LVM2 001             UZRvRF-6UR3-Gd7i-2xHy-WRkv-3ahP-snteKb                
    ├─vmdata-vmstore_tmeta                                                                                                     
    │ └─vmdata-vmstore-tpool                                                                                                   
    │   ├─vmdata-vmstore                                                                                                       
    │   └─vmdata-vm--100--disk--0                                                                                              
    └─vmdata-vmstore_tdata                                                                                                     
      └─vmdata-vmstore-tpool                                                                                                   
        ├─vmdata-vmstore                                                                                                       
        └─vmdata-vm--100--disk--0  
```

For maximum flexibility of configuration, you could use separate partitions for each data folder, if you wish (below is an example of `show system storage` command in FreeBDS):

```sh
Filesystem                             Size    Used   Avail Capacity  Mounted on
nvm/bitcoin                          766G    648M    765G     0%    /bitcoin
nvm/bitcoin/blocks                   1.1T    375G    765G    33%    /bitcoin/blocks
nvm/bitcoin/chainstate               770G    4.5G    765G     1%    /bitcoin/chainstate
nvm/bitcoin/indexes                  799G     34G    765G     4%    /bitcoin/indexes
nvm/bitcoin/testnet3                 765G    5.0M    765G     0%    /bitcoin/testnet3
nvm/mempool                          789G     24G    765G     3%    /mempool
nvm/mysql                            766G    648M    765G     0%    /mysql
tmpfs                                1.0G    1.3M    1.0G     0%    /var/cache/angie
```

### Node.js + npm

If you wish to use BCH Explorer outside of a Docker container, you will need to install Node.js.

Use latest Node.js (LTS) from NodeSource:

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
```

Or you use `nvm` to select a pre-built version of Node.js:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | zsh
source $HOME/.zshrc
nvm install v24.14.0 --shared-zlib
nvm alias default node
```

### Tor

Optionally, you can install Tor add Bitcoin to the `_tor` group:

```sh
sudo apt-get install -y tor
sudo usermod -a -G _tor bitcoin
```

Then configure `/usr/local/etc/tor/torrc` as follows:

```sh
RunAsDaemon 1
SOCKSPort 9050
ControlPort 9051
Log notice syslog

CookieAuthentication 1
CookieAuthFileGroupReadable 1
CookieAuthFile /var/db/tor/control_auth_cookie
DataDirectory /var/db/tor
DataDirectoryGroupReadable 1

HiddenServiceDir /var/db/tor/explorer
HiddenServicePort 80 127.0.0.1:81
HiddenServiceVersion 3
```

### Bitcoin Cash Node

Download the Bitcoin Cash Node (BCHM) from the [official website](https://github.com/bitcoin-cash-node/bitcoin-cash-node/releases) or better yet use the [Ubuntu PPA](https://bitcoincashnode.org/download/ubuntu).

```sh
sudo add-apt-repository ppa:bitcoin-cash-node/ppa
sudo apt-get update
sudo apt-get install bitcoind 
```

Then see the [bitcoind.service](./bitcoind.service) file for the systemd service file, where I also set the `-datadir` parameter (see the service file for more details).

Configure your `bitcoin.conf` like this:

```sh
# Disable listening, this has nothing to do with the RPC calls.
listen=0

# Limit the number of connections to the node, this has nothing to do with the RPC calls.
maxconnections=6
# Max upload target (in MB), reducing the bandwidth usage.
# This option has nothing to do with the RPC calls.
maxuploadtarget=20

# Transaction index (full index)
txindex=1

# Enable coin stats index as well (for gettxoutsetinfo RPC calls)
coinstatsindex=1

# Enable server RPC commands
server=1

# To bind to all interfaces, use 0.0.0.0 (default)
rpcbind=0.0.0.0

# Note: you can have multiple lines of rpcallowip
# Limit to localhost ideally for security reasons
rpcallowip=127.0.0.1
# In case of Docker setup that uses IPV6 allow all IPv6 addresses
rpcallowip=::/0

#rpcport=8332 (default port)

# Setup authentication
rpcauth=username:hashedpassword

# RPC options
rpcworkqueue=1024
# Increase the number of threads to handle RPC calls
rpcthreads=10
rpcservertimeout=60

# Fulcrum options
# Set zmqpubhashblock to listen on port 8433 for better performance
zmqpubhashblock=tcp://0.0.0.0:8433

datadir=/bitcoin
server=1
txindex=1
listen=1
discover=1
par=16
dbcache=4096
maxmempool=1337
mempoolexpiry=999999
maxconnections=42
onion=127.0.0.1:9050
rpcallowip=127.0.0.1
rpcuser=foo
rpcpassword=bar

[main]
bind=127.0.0.1:8333
rpcbind=127.0.0.1:8332
whitelist=127.0.0.1

[test4]
daemon=1
bind=127.0.0.1:28333
rpcbind=127.0.0.1:28332

[scale]
daemon=1
bind=127.0.0.1:38333
rpcbind=127.0.0.1:38332

[chip]
daemon=1
bind=127.0.0.1:48333
rpcbind=127.0.0.1:48332
```

### Fulcrum

Fulcrum has a configuration file `fulcrum.conf` that you can use to configure the node.

```sh
# Database directory
datadir = /media/my_extra_drive_mount_point/fulcrum/

# Bitcoin daemon RPC host:port
rpc = 127.0.0.1:8433

# RPC Username 
rpcuser = username

# RPC Password
rpcpassword = secret

# TCP bind
tcp = 0.0.0.0:50001

# Admin RPC bind (if you wish to have admin RPC service running)
admin = 8000

# Syslog mode (optional)
syslog = true

# Peer discovery
peering = false

# BitcoinD number of clients
# See the bitcoind.conf rpcthreads option.
bitcoind_clients = 10

# Max history
# Warning: this might impact the performance of your server.
# However, recently BCH many more transactions due to CashTokens, so you might want to increase this value from the default value.
max_history = 300000

# Work queue threads
# Max. number of worker threads.
worker_threads = 8
```

### MariaDB

Prepare MariaDB (open-source fork of MySQL) for the BCH Explorer.

```sh
mysql -u root
create database explorer;
grant all on explorer.* to 'explorer'@'localhost' identified by 'explorer';

#create database explorer_testnet;
#grant all on explorer_testnet.* to 'explorer_testnet'@'localhost' identified by 'explorer_testnet';
```

### BCH Explorer

Currently I deploy the BCH backend using Docker. Using the [docker compose](../docker/docker-compose.yml).

And I deploy the frontend directly to Nginx/Angie, since the frontend is a static Angular site, which is building also [during the CI/CD process](../.gitlab-ci.yml).

<!-- After all 3 ~~electrs~~ Fulcrum instances are fully indexed, install your 3 BCH Explorer nodes:

```
./bch-explorer-install-all
./bch-explorer-upgrade-all
```

Finally, start your 3 BCH Explorer backends:

```
./bch-explorer-start-all
```
-->

### Angie / Nginx

In case you use Nginx, get an SSL certificate using `certbot`:

```sh
certbot --nginx -d bchexplorer.cash
```

However, Angie has built-in certificate management, so you can use it as well.

In case of Docker backend you can configure the upstream mainnet backend to just use: `127.0.0.1:8999`:

```conf
upstream bch-explorer-mainnet {
    server 127.0.0.1:8999 fail_timeout=10s max_fails=10 weight=99999;

    keepalive 8;
}
```

The [`keepalive`](https://en.angie.software/angie/docs/configuration/modules/http/http_upstream/#keepalive) directive is used to keep the connection open for a period of time, so that the backend can reuse the connection for multiple requests. The `weight` directive is used to assign a weight to the backend, which is used to determine the load balancing, the higher the weight, the more requests are sent to the backend (in case you run multiple backends it will round-robin the requests based on the weight).

More information see: [Upstream docs](https://en.angie.software/angie/docs/configuration/modules/stream/stream_upstream/).
