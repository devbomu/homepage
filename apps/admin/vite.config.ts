import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // 로컬에서는 Worker 프록시가 없으므로 Vite 가 대신 API 로 넘긴다.
    // 운영에서는 worker/index.ts 가 같은 일을 한다.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
