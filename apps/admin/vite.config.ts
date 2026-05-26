import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.ADMIN_PORT) || 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    port,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
