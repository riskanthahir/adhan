import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { appendPushClientEvent } from './lib/webPushClient';
import './index.css';

// Register our custom Service Worker (src/sw.ts) once for offline caching and iOS/Web Push delivery
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      appendPushClientEvent({
        level: 'info',
        stage: 'sw_register_startup',
        message: `Service Worker registered (${swUrl}, active=${Boolean(registration?.active)})`,
      });
    },
    onRegisterError(err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRedirectOnProxy =
        msg.includes('redirect') &&
        typeof window !== 'undefined' &&
        window.location.hostname.includes('.run.app');
      appendPushClientEvent({
        level: 'error',
        stage: 'sw_register_startup',
        message: isRedirectOnProxy
          ? `Startup Service Worker registration failed: Cloud Run preview proxy redirected the script (disallowed by W3C SW spec). For reliable PWA & Web Push testing, use the production deployment: https://adhan-khaki.vercel.app`
          : `Startup Service Worker registration failed: ${msg}`,
      });
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
