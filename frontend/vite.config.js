import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api calls to the backend during development so the browser doesn't
// hit CORS issues. In production the frontend is on Netlify and the backend is
// on DigitalOcean — set VITE_API_URL in your Netlify env vars instead.
export default defineConfig({
  plugins: [react()],
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
