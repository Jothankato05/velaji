import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend talks to the velaji backend on :4100. In dev, Vite proxies
// /api and /health straight through so there's no CORS to manage and the
// client can use same-origin relative URLs everywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
      '/health': { target: 'http://localhost:4100', changeOrigin: true },
      '/webhooks': { target: 'http://localhost:4100', changeOrigin: true }
    }
  }
});
