import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

function versionServiceWorkerPlugin() {
  return {
    name: 'version-service-worker',
    closeBundle() {
      const swDistPath = path.resolve(__dirname, 'dist/sw.js');
      if (fs.existsSync(swDistPath)) {
        let commit = '';
        try {
          commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        } catch {
          commit = crypto.randomBytes(4).toString('hex');
        }
        const buildHash = process.env.VITE_BUILD_HASH || commit || Date.now().toString(36);
        let content = fs.readFileSync(swDistPath, 'utf8');
        content = content.replace(/__BUILD_HASH__/g, buildHash);
        fs.writeFileSync(swDistPath, content, 'utf8');
      }
    },
  };
}

// Proxy /api calls to the backend during development so the browser doesn't
// hit CORS issues. In production the frontend is on Netlify and the backend is
// on DigitalOcean — set VITE_API_URL in your Netlify env vars instead.
export default defineConfig({
  plugins: [react(), versionServiceWorkerPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router')
          ) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/axios/')) {
            return 'http-vendor';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
