import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { appendServerLog, initDatabase } from './server/db.ts';
import { createPushRouter } from './server/pushRoutes.ts';
import { startScheduler, stopScheduler } from './server/scheduler.ts';
import { ensureVapidConfigured } from './server/vapid.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function bootstrapServer(): Promise<void> {
  initDatabase();
  const vapid = ensureVapidConfigured();

  const app = express();
  app.set('trust proxy', 1);

  // Security headers compatible with PWA & HTTPS
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api', createPushRouter());

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith(`${path.sep}sw.js`)) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
          } else if (filePath.endsWith(`${path.sep}manifest.webmanifest`)) {
            res.setHeader('Content-Type', 'application/manifest+json');
          }
        },
      })
    );

    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production bundle not found. Run npm run build first.');
      }
    });
  }

  startScheduler();

  appendServerLog({
    level: 'info',
    category: 'server_boot',
    message: `My Adhan server started (${IS_PRODUCTION ? 'production' : 'development'}) with Web Push scheduler.`,
    meta: { port: PORT, vapidViaEnv: vapid.configuredViaEnv },
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[My Adhan] Server listening on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`
    );
  });

  const shutdown = () => {
    stopScheduler();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrapServer().catch((err) => {
  console.error('[My Adhan] Failed to start server:', err);
  process.exit(1);
});
