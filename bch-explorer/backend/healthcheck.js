const http = require("http");
const net = require("net");
const tls = require("tls");

const configFromFile = require(
  process.env.EXPLORER_CONFIG_FILE ? process.env.EXPLORER_CONFIG_FILE : '../explorer-config.json'
);

function checkElectrumConnection(timeoutMs = 2000) {
  const electrumHost = configFromFile.ELECTRUM.HOST;
  const electrumPort = configFromFile.ELECTRUM.PORT;
  const electrumTlsEnabled = configFromFile.ELECTRUM.TLS_ENABLED;

  return new Promise((resolve, reject) => {
    const socket = electrumTlsEnabled
      ? tls.connect({ host: electrumHost, port: electrumPort, servername: electrumHost })
      : net.connect({ host: electrumHost, port: electrumPort });

    const fail = (err) => {
      try {
        socket.destroy();
      } catch (_) {}
      reject(err);
    };

    socket.setTimeout(timeoutMs, () => fail(new Error("Electrum timeout")));
    socket.once("error", (err) => fail(new Error(`Electrum connection error: ${err.message}`)));

    let buffer = "";
    socket.once("connect", () => {
      const req = {
        jsonrpc: "2.0",
        id: 1,
        method: "server.version",
        params: ["bch-explorer-healthcheck", "1.4"],
      };
      socket.write(JSON.stringify(req) + "\n");
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx === -1) return;

      const line = buffer.slice(0, idx).trim();
      try {
        const json = JSON.parse(line);
        if (!json || json.id !== 1 || json.error) {
          throw new Error(json && json.error ? JSON.stringify(json.error) : "unexpected response");
        }
        socket.end();
        const result = Array.isArray(json.result) ? json.result : [json.result];
        resolve({
          host: electrumHost,
          port: electrumPort,
          tls: !!electrumTlsEnabled,
          server: result[0],
          protocol: result[1],
        });
      } catch (e) {
        fail(new Error(`Electrum invalid response: ${e.message}`));
      }
    });
  });
}

function checkBchnConnection(timeoutMs = 2000) {
  const bitcoindHost = configFromFile.CORE_RPC.HOST;
  const bitcoindPort = configFromFile.CORE_RPC.PORT;
  const bitcoindUsername = configFromFile.CORE_RPC.USERNAME;
  const bitcoindPassword = configFromFile.CORE_RPC.PASSWORD;
  
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${bitcoindUsername}:${bitcoindPassword}`, "utf8").toString("base64");
    const payload = JSON.stringify({
      jsonrpc: "1.0",
      id: "healthcheck",
      method: "getblockchaininfo",
      params: [],
    });

    const req = http.request(
      {
        host: bitcoindHost,
        port: bitcoindPort,
        path: "/",
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Basic ${auth}`,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`BCHN RPC HTTP ${res.statusCode}`));
          }
          try {
            const json = JSON.parse(body);
            if (!json || json.error) {
              throw new Error(json && json.error ? JSON.stringify(json.error) : "empty response");
            }
            resolve({
              host: bitcoindHost,
              port: bitcoindPort,
              chain: json.result && json.result.chain,
              blocks: json.result && json.result.blocks,
              headers: json.result && json.result.headers,
            });
          } catch (e) {
            reject(new Error(`BCHN RPC invalid response: ${e.message}`));
          }
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("BCHN RPC timeout")));
    req.on("error", (err) => reject(new Error(`BCHN RPC error: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

function checkValkeyConnection(timeoutMs = 2000) {
  const socketPath = configFromFile.VALKEY.UNIX_SOCKET_PATH;

  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: socketPath });

    const fail = (err) => {
      try {
        socket.destroy();
      } catch (_) {}
      reject(err);
    };

    socket.setTimeout(timeoutMs, () => fail(new Error("Valkey timeout")));
    socket.once("error", (err) => fail(new Error(`Valkey connection error: ${err.message}`)));

    socket.once("connect", () => {
      socket.write("PING\r\n");
    });

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\r\n")) {
        const line = buffer.trim();
        if (line === "+PONG") {
          socket.end();
          resolve({ socketPath });
        } else {
          fail(new Error(`Valkey unexpected response: ${line}`));
        }
      }
    });
  });
}

function checkBackendItself(timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const options = {
      host: "localhost",
      port: configFromFile.EXPLORER.HTTP_PORT,
      path: "/api/v1/mining/pools/24h",
      timeout: timeoutMs,
    };

    const request = http
      .request(options, (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(body);
              if (
                json &&
                json.hasOwnProperty("pools") &&
                Array.isArray(json["pools"]) &&
                json["pools"].length >= 1 &&
                json.hasOwnProperty("blockCount") &&
                json["blockCount"] >= 1 &&
                json.hasOwnProperty("lastEstimatedHashrate") &&
                json["lastEstimatedHashrate"] >= 1
              ) {
                resolve({
                  host: options.host,
                  port: options.port,
                  status: res.statusCode,
                  blockCount: json.blockCount,
                  poolsCount: json.pools.length,
                  lastEstimatedHashrate: json.lastEstimatedHashrate,
                });
              } else {
                reject(new Error("JSON object is not containing all the data we want to see."));
              }
            } catch (err) {
              reject(new Error(err.message));
            }
          } else {
            reject(new Error("Status code is NOT 200 OK."));
          }
        });
      })
      .on("error", (err) => {
        reject(new Error(err.message));
      });

    request.end();
  });
}

void (async () => {
  try {
    const timeout = 2000; // Same timeout as the --timeout=20s in docker file
    if (configFromFile.EXPLORER.BACKEND === "electrum") {
      const electrum = await checkElectrumConnection(timeout);
      console.log(
        `Electrum OK (${electrum.tls ? "TLS" : "TCP"}) ${electrum.host}:${electrum.port} server=${electrum.server} protocol=${electrum.protocol}`
      );
    }

    const bchn = await checkBchnConnection(timeout);
    console.log(
      `BCHN OK ${bchn.host}:${bchn.port} chain=${bchn.chain} blocks=${bchn.blocks} headers=${bchn.headers}`
    );

    if (configFromFile.VALKEY.ENABLED) {
      const valkey = await checkValkeyConnection(timeout);
      console.log(`Valkey OK socket=${valkey.socketPath}`);
    }

    const backend = await checkBackendItself(timeout);
    console.log(
      `Backend OK ${backend.host}:${backend.port} status=${backend.status} blocks=${backend.blockCount} pools=${backend.poolsCount} hashrate=${backend.lastEstimatedHashrate}`
    );
    process.exit(0);
  } catch (err) {
    console.log("ERROR: " + err.message);
    process.exit(1);
  }
})();

