import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
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
  const httpServer = http.createServer(app);

  // Security headers compatible with PWA & HTTPS
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Ensure /sw.js is served as JavaScript in all environments if built dist exists
  app.get('/sw.js', (_req, res, next) => {
    const swDist = path.resolve(__dirname, 'dist', 'sw.js');
    if (fs.existsSync(swDist)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.sendFile(swDist);
      return;
    }
    next();
  });

  app.use('/api', createPushRouter());

  if (!IS_PRODUCTION) {
    if (!process.env.DISABLE_HMR) {
      process.env.DISABLE_HMR = 'true';
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        ws: { server: httpServer },
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
    level: vapid.configured ? 'info' : 'warn',
    category: 'server_boot',
    message: vapid.configured
      ? `My Adhan server started (${IS_PRODUCTION ? 'production' : 'development'}) with Web Push scheduler.`
      : `My Adhan server started (${IS_PRODUCTION ? 'production' : 'development'}) — VAPID not configured (${vapid.status}).`,
    meta: { port: PORT, vapidConfigured: vapid.configured, vapidStatus: vapid.status },
  });

  if (!vapid.configured) {
    console.warn(`[My Adhan] VAPID configuration incomplete (${vapid.status}): ${vapid.errorMessage}`);
    console.warn('[My Adhan] Run `npm run vapid:generate` or set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.');
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[My Adhan] Server listening on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`
    );
  });

  const shutdown = () => {
    stopScheduler();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrapServer().catch((err) => {
  console.error('[My Adhan] Failed to start server:', err);
  process.exit(1);
});
