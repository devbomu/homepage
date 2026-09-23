import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // lib/ 의 순수 함수 테스트는 Node 환경에서 돈다.
    // 바인딩이 필요한 통합 테스트는 wrangler dev 를 띄워 따로 검증한다.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
