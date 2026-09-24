import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv } from '../env';
import { ApiError } from '../lib/errors';

/**
 * 모든 에러의 마지막 관문.
 *
 * 5xx 만 원인을 로그에 남기고, 응답에는 어떤 경우에도 내부 정보를 싣지 않는다.
 * (SQL 에러 문구가 새어나가면 스키마가 노출된다.)
 */
export function handleError(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      console.error('api error', {
        code: err.code,
        message: err.message,
        cause: String(err.cause ?? ''),
        path: c.req.path,
        method: c.req.method,
        ray: c.req.header('Cf-Ray'),
      });
    }
    return c.json(
      {
        error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) },
      },
      err.status as never,
    );
  }

  if (err instanceof HTTPException) {
    return c.json(
      { error: { code: 'bad_request', message: err.message || '요청을 처리할 수 없습니다.' } },
      err.status as never,
    );
  }

  console.error('unhandled error', {
    message: err.message,
    /*
     * 원인까지 함께 남긴다. Drizzle 은 DB 오류를 "Failed query: ..." 로 감싸는데,
     * 정작 왜 실패했는지(제약 위반인지 타입 오류인지)는 cause 에만 있다.
     * 이게 없어서 500 하나를 재현하는 데 한참 걸렸다.
     */
    cause: err.cause instanceof Error ? err.cause.message : String(err.cause ?? ''),
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
    ray: c.req.header('Cf-Ray'),
  });

  return c.json({ error: { code: 'internal_error', message: '요청을 처리하지 못했습니다.' } }, 500);
}

export function handleNotFound(c: Context<AppEnv>): Response {
  return c.json({ error: { code: 'not_found', message: '없는 경로입니다.' } }, 404);
}
