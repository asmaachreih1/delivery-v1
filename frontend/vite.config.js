// ============================================================
// frontend/vite.config.js
// ============================================================
// Vite build tool configuration.
//
// Vite is the development server and build tool for the frontend.
// It provides:
//   - Hot Module Replacement (HMR): changes appear in the browser
//     instantly without a full page reload during development
//   - Fast builds using native ES modules
//   - Production bundling (minification, code splitting, etc.)
//
// THE PROXY:
//   During local development, the frontend runs on port 5173
//   and the backend runs on port 3001. Without the proxy, the
//   browser would block /api/* requests due to CORS restrictions
//   (different ports = different origin).
//
//   The proxy setting tells Vite's dev server: "any request to
//   /api/* — forward it to localhost:3001 as if it came from there."
//   This makes CORS irrelevant in development. The browser thinks
//   everything is on the same server.
//
//   In production on Vercel, the proxy is not needed — both
//   frontend and backend are served from the same domain, so
//   there is no cross-origin restriction.
// ============================================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(), // enables JSX transformation and React Fast Refresh
  ],
  server: {
    proxy: {
      // Forward any request starting with /api to the backend
      '/api': {
        target:       'http://localhost:3001', // backend address
        changeOrigin: true, // rewrites the Host header to match the target
      },
    },
  },
});
