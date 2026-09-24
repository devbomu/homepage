import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // toc.ts 같은 순수 함수만 본다. DOM 이 필요한 것은 e2e 로 확인한다.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: { '@lib': new URL('./src/lib', import.meta.url).pathname },
  },
});
