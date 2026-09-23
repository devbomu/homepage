import type { Context } from 'hono';

import type { AppEnv } from '../env';

/**
 * 모든 응답은 같은 봉투를 쓴다.
 *   성공: { "data": ..., "meta"?: ... }
 *   실패: { "error": { "code", "message", "fields"? } }
 */
export interface PageMeta {
  total?: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export function ok<T>(c: Context<AppEnv>, data: T, status = 200) {
  return c.json({ data }, status as never);
}

export function paged<T>(c: Context<AppEnv>, data: T[], meta: PageMeta) {
  return c.json({ data, meta });
}

export function created<T>(c: Context<AppEnv>, data: T) {
  return c.json({ data }, 201);
}

export function noContent(c: Context<AppEnv>) {
  return c.body(null, 204);
}
