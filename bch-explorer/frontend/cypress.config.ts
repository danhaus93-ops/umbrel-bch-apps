import { defineConfig } from 'cypress';

export default defineConfig({
  projectId: 'ry4br7',
  videosFolder: 'cypress/videos',
  screenshotsFolder: 'cypress/screenshots',
  fixturesFolder: 'cypress/fixtures',
  video: false,
  retries: {
    runMode: 3,
    openMode: 0,
  },
  chromeWebSecurity: false,
  e2e: {
    setupNodeEvents(on: any, config: any) {
      const fs = require('fs');
      const CONFIG_FILE = 'explorer-frontend-config.json';
      if (fs.existsSync(CONFIG_FILE)) {
        const contents = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        config.env.BASE_MODULE = contents.BASE_MODULE ? contents.BASE_MODULE : 'explorer';
      } else {
        config.env.BASE_MODULE = 'explorer';
      }
      return config;
    },
    baseUrl: 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.{js,jsx,ts,tsx}',
  },
});
