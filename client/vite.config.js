import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
export default defineConfig(function (_a) {
    var _b;
    var mode = _a.mode;
    var env = loadEnv(mode, '.', '');
    var apiBase = env.VITE_API_BASE || '/api';
    var proxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8080';
    var port = Number(env.VITE_DEV_PORT) || 5173;
    var useProxy = apiBase[0] === '/';
    return {
        plugins: [react()],
        server: {
            port: port,
            proxy: useProxy
                ? (_b = {},
                    _b[apiBase] = {
                        target: proxyTarget,
                        changeOrigin: true,
                    },
                    _b) : undefined,
        },
    };
});
