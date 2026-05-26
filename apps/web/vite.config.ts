import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Chrome's Private Network Access (PNA) requires these headers on preflight
// responses for public origins (e.g. app.safe.global) to reach localhost.
function safeAppCors(): Plugin {
  return {
    name: 'safe-app-cors',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        next();
      });
    },
  };
}

const port = Number(process.env.WEB_PORT) || 3000;
const restPort = Number(process.env.REST_PORT) || 4000;

export default defineConfig({
  plugins: [safeAppCors(), react()],
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
});
