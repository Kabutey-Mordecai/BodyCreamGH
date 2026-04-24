import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Admin runs on port 5174 to avoid clashing with the storefront (5173).
// In production deploy this to a subdomain like admin.yourstore.com and set VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
