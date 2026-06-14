const PROXY_CONFIG = [
  {
    context: ["/api/v1/services/**"],
    target: `http://localhost:9000`,
    secure: false,
    ws: true,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    context: ["/api/v1/**"],
    target: `http://localhost:8999`,
    secure: false,
    ws: true,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    context: ["/api/**"],
    target: `https://mempool.space`,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
];

export default PROXY_CONFIG;
