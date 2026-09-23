import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  // 생성된 SQL 은 `wrangler d1 migrations apply` 가 실행한다.
  // drizzle-kit 이 직접 D1 에 붙지 않으므로 자격증명이 필요 없다.
  verbose: true,
  strict: true,
});
