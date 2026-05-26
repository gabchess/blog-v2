import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.QF_SIMULATOR_PORT) || 3003;
const restPort = Number(process.env.REST_PORT) || 4000;

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    proxy: {
      '/api': {
        target: `http://localhost:${restPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
