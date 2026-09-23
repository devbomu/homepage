// @ts-check
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.namsu.kim',

  /**
   * SSR 로 돌린다.
   *
   * 정적 생성이면 글 하나 발행할 때마다 빌드를 기다려야 하는데,
   * 그러면 DB 기반 관리자를 만든 이유가 없어진다.
   * 대신 각 페이지에서 Cache-Control 을 걸어 Cloudflare 엣지가 받아내게 한다.
   */
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),

  vite: {
    plugins: [tailwindcss()],
  },

  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },

  devToolbar: { enabled: false },
});
