import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@app': resolve(__dirname, 'src/app'),
      '@components': resolve(__dirname, 'src/app/components'),
      '@environments': resolve(__dirname, 'src/environments'),
      '@interfaces': resolve(__dirname, 'src/app/interfaces'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
  },
});
