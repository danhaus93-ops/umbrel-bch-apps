/// <reference types="@angular/localize" />

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Old code:

    import * as domino from 'domino';

    import { join } from 'path';
    import { AppServerModule } from './src/main.server';
    import { APP_BASE_HREF } from '@angular/common';
    import { existsSync } from 'fs';

    import { ResizeObserver } from './shims';

    const commonEngine = new CommonEngine();

    const template = fs.readFileSync(path.join(process.cwd(), 'dist/explorer/browser/en-US/', 'index.html')).toString();
    const win = domino.createWindow(template);

    // @ts-ignore
    win.__env = global.__env;

    // @ts-ignore
    win.matchMedia = (media) => {
      return {
        media,
        matches: true,
      };
    };

    // @ts-ignore
    win.setTimeout = (fn) => { fn(); };
    win.document.body.scrollTo = (() => {});
    win['ResizeObserver'] = ResizeObserver;
    // @ts-ignore
    global['window'] = win;
    // @ts-ignore
    global['document'] = win.document;
    // @ts-ignore
    global['history'] = { state: { } };
    // @ts-ignore
    Object.defineProperty(global, 'navigator', {
      value: win.navigator,
      writable: true
    });

    global['localStorage'] = {
      getItem: () => '',
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => '',
    };

    // The Express app is exported so that it can be used by serverless Functions.
    export function app(locale: string): express.Express {
      const server = express();
      const distFolder = join(process.cwd(), `dist/explorer/browser/${locale}`);
      const indexHtml = join(distFolder, 'index.html');

      server.set('view engine', 'html');
      server.set('views', distFolder);

      // static file handler so we send HTTP 404 to nginx
      server.get('/**.(css|js|json|ico|webmanifest|png|jpg|jpeg|svg|mp4)*', express.static(distFolder, { maxAge: '1y', fallthrough: false }));
      // handle page routes
      server.get('*', (req, res, next) => {
        const { protocol, originalUrl, baseUrl, headers } = req;

        commonEngine
          .render({
            bootstrap: AppServerModule,
            documentFilePath: indexHtml,
            url: `${protocol}://${headers.host}${originalUrl}`,
            publicPath: distFolder,
            providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
          })
          .then((html) => res.send(html))
          .catch((err) => next(err));
      });

      return server;
    }


    // only used for development mode
    function run(): void {
      const port = process.env.PORT || 4000;

      // Start up the Node server
      const server = app('en-US');
      server.listen(port, () => {
        console.log(`Node Express server listening on port ${port}`);
      });
    }

    // Webpack will replace 'require' with '__webpack_require__'
    // '__non_webpack_require__' is a proxy to Node 'require'
    // The below code is to ensure that the server is run only when not requiring the bundle.
    declare const __non_webpack_require__: NodeRequire;
    const mainModule = __non_webpack_require__.main;
    const moduleFilename = mainModule && mainModule.filename || '';
    if (moduleFilename === __filename || moduleFilename.includes('iisnode')) {
      run();
    }
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next()
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
