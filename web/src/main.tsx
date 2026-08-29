import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/base.css';
import { AuthProvider } from './lib/auth';
import { App } from './App';

// Register the service worker in production only. In dev it would sit between
// Vite and the browser and serve a stale shell after every edit; the build is
// also the only place the hashed asset paths it caches actually exist.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unavailable worker costs the install prompt and offline shell, not
      // the app. Nothing here should block rendering.
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
