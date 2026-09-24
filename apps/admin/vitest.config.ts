import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom 없이 서버 렌더만으로 충분하다.
    // 여기서 잡으려는 것은 "렌더 자체가 터지는가" 이지 DOM 동작이 아니다.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
