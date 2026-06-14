jest.mock('./explorer-config.json', () => ({}), { virtual: true });
jest.mock('./src/logger.ts', () => ({
  emerg: jest.fn(),
  alert: jest.fn(),
  crit: jest.fn(),
  err: jest.fn(),
  warn: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  updateNetwork: jest.fn(),
  tags: {
    mining: 'mining',
    ln: 'ln',
    goggles: 'goggles',
  },
}), { virtual: true });
jest.mock('./src/api/backend-info.ts', () => ({
  default: {
    getBackendInfo: jest.fn().mockReturnValue({}),
    getShortCommitHash: jest.fn().mockReturnValue(''),
  },
}), { virtual: true });
jest.mock('./src/api/rbf-cache.ts', () => ({}), { virtual: true });
jest.mock('./src/api/mempool.ts', () => ({}), { virtual: true });
jest.mock('./src/api/memory-cache.ts', () => ({}), { virtual: true });
// Mock the electrum client (ESM module)
jest.mock('@bitcoincash/electrum-client', () => ({
  ElectrumClient: jest.fn().mockImplementation(() => ({
    initElectrum: jest.fn().mockResolvedValue(undefined),
    blockchainScripthash_getBalance: jest.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
    blockchainScripthash_getHistory: jest.fn().mockResolvedValue([]),
    blockchainScripthash_listunspent: jest.fn().mockResolvedValue([]),
    blockchainScripthash_getMempool: jest.fn().mockResolvedValue([]),
    blockchainTransaction_getMerkle: jest.fn().mockResolvedValue({}),
    request: jest.fn().mockResolvedValue([]),
  })),
}), { virtual: true });
