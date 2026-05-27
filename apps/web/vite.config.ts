import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.WEB_PORT) || 3000;

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port,
  },
});
