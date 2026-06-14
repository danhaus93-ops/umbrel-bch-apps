const PROXY_CONFIG = require("./proxy.conf");

const addApiKeyHeader = (proxyReq) => {
  if (process.env.MEMPOOL_CI_API_KEY) {
    proxyReq.setHeader("X-Mempool-Auth", process.env.MEMPOOL_CI_API_KEY);
  }
};

PROXY_CONFIG.forEach((entry) => {
  const hostname = process.env.MEMPOOL_HOSTNAME
    ? process.env.MEMPOOL_HOSTNAME
    : "bchexplorer.cash";

  entry.target = entry.target.replace("bchexplorer.cash", hostname);

  if (entry.onProxyReq) {
    const originalProxyReq = entry.onProxyReq;
    entry.onProxyReq = (proxyReq, req, res) => {
      originalProxyReq(proxyReq, req, res);
      if (process.env.MEMPOOL_CI_API_KEY) {
        proxyReq.setHeader("X-Mempool-Auth", process.env.MEMPOOL_CI_API_KEY);
      }
    };
  } else {
    entry.onProxyReq = addApiKeyHeader;
  }
});

export default PROXY_CONFIG;
