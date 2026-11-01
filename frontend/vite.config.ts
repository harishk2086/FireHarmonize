import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Separate, long-cacheable chunks for the big libraries.
        manualChunks: {
          charts: ['recharts'],
          map: ['leaflet', 'react-leaflet'],
        },
      },
    },
    // The charts chunk is the Recharts library itself (~160 kB gzipped); it is
    // needed on the first page and cached separately, so the default 500 kB
    // warning is raised to match.
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});