import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiBase = env.VITE_API_BASE || '/api';
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8080';
  const port = Number(env.VITE_DEV_PORT) || 5173;
  const useProxy = apiBase[0] === '/';

  return {
    plugins: [react()],
    server: {
      port,
      proxy: useProxy
        ? {
            [apiBase]: {
              target: proxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
  };
});
